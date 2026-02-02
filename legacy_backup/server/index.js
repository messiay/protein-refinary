// Protein Refinery Backend Server
// Runs Vina docking and FoldX stability analysis locally

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn } from 'child_process';
import { writeFile, unlink, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// CORS - Allow requests from any origin (for cloud frontend)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));

// Multer for file uploads
const upload = multer({ dest: 'temp/' });

// Paths to binaries
const VINA_PATH = join(__dirname, 'bin', 'vina.exe');
const FOLDX_PATH = join(__dirname, 'bin', 'foldx.exe');
const TEMP_DIR = join(__dirname, 'temp');
const LIGAND_DIR = join(__dirname, 'ligands');

// Ensure directories exist
async function ensureDirs() {
    for (const dir of [TEMP_DIR, LIGAND_DIR]) {
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        vinaAvailable: existsSync(VINA_PATH),
        foldxAvailable: existsSync(FOLDX_PATH),
        timestamp: new Date().toISOString()
    });
});

// Get server info
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Protein Refinery Backend',
        version: '1.1.0',
        capabilities: {
            vina: existsSync(VINA_PATH),
            foldx: existsSync(FOLDX_PATH)
        },
        endpoints: [
            'POST /api/dock - Run Vina docking',
            'POST /api/stability - Run FoldX stability analysis',
            'POST /api/score - Combined scoring',
            'GET /api/health - Health check'
        ]
    });
});

// Run Vina docking
app.post('/api/dock', async (req, res) => {
    const { receptorPdb, ligandPdbqt, centerX, centerY, centerZ, sizeX, sizeY, sizeZ, exhaustiveness } = req.body;

    if (!receptorPdb) {
        return res.status(400).json({ error: 'receptorPdb is required' });
    }

    const jobId = `dock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const receptorPath = join(TEMP_DIR, `${jobId}_receptor.pdb`);
    const receptorPdbqtPath = join(TEMP_DIR, `${jobId}_receptor.pdbqt`);
    const ligandPath = join(TEMP_DIR, `${jobId}_ligand.pdbqt`);
    const outputPath = join(TEMP_DIR, `${jobId}_output.pdbqt`);
    const logPath = join(TEMP_DIR, `${jobId}_log.txt`);

    try {
        await ensureDirs();

        // Write receptor PDB
        await writeFile(receptorPath, receptorPdb);

        // Simple PDB to PDBQT conversion
        const pdbqtContent = convertPdbToPdbqt(receptorPdb);
        await writeFile(receptorPdbqtPath, pdbqtContent);

        // Use provided ligand or default
        let ligandContent = ligandPdbqt;
        if (!ligandContent) {
            const defaultLigand = join(LIGAND_DIR, 'default.pdbqt');
            if (existsSync(defaultLigand)) {
                ligandContent = await readFile(defaultLigand, 'utf-8');
            } else {
                ligandContent = generateSimpleLigand();
            }
        }
        await writeFile(ligandPath, ligandContent);

        // Calculate box center
        const center = {
            x: centerX ?? 0,
            y: centerY ?? 0,
            z: centerZ ?? 0
        };

        if (!centerX || !centerY || !centerZ) {
            const autoCenter = calculateProteinCenter(receptorPdb);
            center.x = autoCenter.x;
            center.y = autoCenter.y;
            center.z = autoCenter.z;
        }

        // Vina arguments
        const args = [
            '--receptor', receptorPdbqtPath,
            '--ligand', ligandPath,
            '--out', outputPath,
            '--log', logPath,
            '--center_x', center.x.toString(),
            '--center_y', center.y.toString(),
            '--center_z', center.z.toString(),
            '--size_x', (sizeX || 20).toString(),
            '--size_y', (sizeY || 20).toString(),
            '--size_z', (sizeZ || 20).toString(),
            '--exhaustiveness', (exhaustiveness || 8).toString()
        ];

        console.log(`[Vina] Starting docking job ${jobId}`);

        // Run Vina
        await runProcess(VINA_PATH, args);

        // Parse results
        let logContent = '';
        if (existsSync(logPath)) {
            logContent = await readFile(logPath, 'utf-8');
        }

        // Extract affinity from log
        const affinityMatch = logContent.match(/^\s*1\s+([-\d.]+)/m);
        const affinity = affinityMatch ? parseFloat(affinityMatch[1]) : null;

        console.log(`[Vina] Job ${jobId} complete. Affinity: ${affinity}`);

        // Cleanup
        await cleanupFiles([receptorPath, receptorPdbqtPath, ligandPath, outputPath, logPath]);

        res.json({
            success: true,
            jobId,
            affinity,
            log: logContent
        });

    } catch (error) {
        console.error(`[Vina] Job ${jobId} failed:`, error);
        await cleanupFiles([receptorPath, receptorPdbqtPath, ligandPath, outputPath, logPath]);

        res.status(500).json({
            success: false,
            error: error.message || 'Docking failed'
        });
    }
});

// Run FoldX stability analysis
app.post('/api/stability', async (req, res) => {
    const { pdbData } = req.body;

    if (!pdbData) {
        return res.status(400).json({ error: 'pdbData is required' });
    }

    if (!existsSync(FOLDX_PATH)) {
        // Fall back to estimation if FoldX not available
        const sequence = extractSequenceFromPdb(pdbData);
        return res.json({
            success: true,
            stability: estimateStability(sequence),
            method: 'estimation'
        });
    }

    const jobId = `foldx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workDir = join(TEMP_DIR, jobId);
    const pdbPath = join(workDir, 'protein.pdb');

    try {
        await mkdir(workDir, { recursive: true });
        await writeFile(pdbPath, pdbData);

        // FoldX Stability command
        const args = [
            '--command=Stability',
            '--pdb=protein.pdb',
            '--output-dir=' + workDir
        ];

        console.log(`[FoldX] Starting stability analysis ${jobId}`);

        // Robost Fix: Copy rotabase.txt to workDir
        try {
            const rotabaseSource = join(__dirname, 'bin', 'rotabase.txt'); // Check bin first
            const rotabaseDest = join(workDir, 'rotabase.txt');
            if (existsSync(rotabaseSource)) {
                await readFile(rotabaseSource).then(content => writeFile(rotabaseDest, content));
            } else {
                // Try root
                const rotabaseRoot = join(__dirname, '..', 'rotabase.txt');
                if (existsSync(rotabaseRoot)) {
                    await readFile(rotabaseRoot).then(content => writeFile(rotabaseDest, content));
                }
            }
        } catch (e) { console.warn('[FoldX] Failed to copy rotabase:', e); }

        await runProcess(FOLDX_PATH, args, workDir);

        // Parse FoldX output
        const outputFile = join(workDir, 'protein_Stability.txt');
        let stability = 0;

        if (existsSync(outputFile)) {
            const content = await readFile(outputFile, 'utf-8');
            // Parse total energy from FoldX output
            const match = content.match(/Total\s*=\s*([-\d.]+)/);
            if (match) {
                stability = parseFloat(match[1]);
            }
        }

        console.log(`[FoldX] Job ${jobId} complete. Stability: ${stability}`);

        // Cleanup
        await cleanupDir(workDir);

        res.json({
            success: true,
            stability,
            method: 'foldx'
        });

    } catch (error) {
        console.error(`[FoldX] Job ${jobId} failed:`, error);
        await cleanupDir(workDir);

        // Fall back to estimation on error
        const sequence = extractSequenceFromPdb(pdbData);
        res.json({
            success: true,
            stability: estimateStability(sequence),
            method: 'estimation',
            note: 'FoldX failed, using estimation'
        });
    }
});

// Combined score endpoint
app.post('/api/score', async (req, res) => {
    const { pdbData, sequence } = req.body;

    if (!pdbData && !sequence) {
        return res.status(400).json({ error: 'pdbData or sequence is required' });
    }

    try {
        // Run Vina + FoldX in parallel
        // If one fails, we still want the other if possible
        // But for "fitness", we need both.

        // Parallel execution
        const [vinaRes, foldxRes] = await Promise.allSettled([
            fetch(`http://localhost:${PORT}/api/dock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdbData })
            }).then(r => r.json()),
            fetch(`http://localhost:${PORT}/api/stability`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdbData })
            }).then(r => r.json())
        ]);

        const affinity = vinaRes.status === 'fulfilled' && vinaRes.value.success ? vinaRes.value.affinity : -5.0; // Fallback
        const stability = foldxRes.status === 'fulfilled' && foldxRes.value.success ? foldxRes.value.stability : 0.0;

        const method = (vinaRes.status === 'fulfilled' && vinaRes.value.method === 'vina') ? 'vina' : 'estimation';

        res.json({
            success: true,
            affinity,
            stability,
            method
        });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Upload custom ligand
app.post('/api/upload-ligand', upload.single('ligand'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const content = await readFile(req.file.path, 'utf-8');
        const ligandPath = join(LIGAND_DIR, 'default.pdbqt');
        await writeFile(ligandPath, content);
        await unlink(req.file.path);

        res.json({ success: true, message: 'Ligand uploaded successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate ligand from SMILES
app.post('/api/ligand/smiles', async (req, res) => {
    const { smiles } = req.body;
    if (!smiles) return res.status(400).json({ error: 'SMILES string required' });

    try {
        console.log(`[Ligand] Fetching 3D structure for SMILES: ${smiles}`);

        // Strategy 1: NCI Cactus (Simpler, returns PDB)
        let pdbContent = null;
        try {
            console.log('[Ligand] Trying Cactus API...');
            const url = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/pdb?get3d=true`;
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); // 5s timeout
            if (response.ok) {
                const text = await response.text();
                if (!text.includes('Page not found') && text.length > 10) {
                    pdbContent = text;
                    console.log('[Ligand] Cactus success');
                }
            }
        } catch (e) {
            console.warn('[Ligand] Cactus failed:', e.message);
        }

        // Strategy 2: PubChem (Robust, returns SDF -> convert to PDB/PDBQT)
        // PubChem doesn't return PDB directly easily, but we can get SDF with 3D
        if (!pdbContent) {
            console.log('[Ligand] Trying PubChem API (3D)...');
            try {
                // 1. Get CID from SMILES
                const cidRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`);
                if (cidRes.ok) {
                    const cidData = await cidRes.json();
                    const cid = cidData.IdentifierList?.CID?.[0];

                    if (cid) {
                        // 2. Get 3D SDF for CID
                        const sdfRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/record/SDF/?record_type=3d&response_type=save&params=overwrite_3d`);
                        if (sdfRes.ok) {
                            const sdfText = await sdfRes.json().catch(() => sdfRes.text()); // fetch might act weird
                            // Actually PubChem returns text/plain for SDF
                            if (typeof sdfText === 'string' && sdfText.includes('$$$$')) {
                                // We have SDF. Convert simple SDF atoms to PDBQT "style" (Simulated conversion)
                                // Since we don't have a real SDF parser, we'll try a third fallback or mock if this is complex.
                                // Actually, let's use a specialized service or just use the generated simple ligand if fails.

                                // Better: Use Opsin/Chemicalize? No.
                                // Let's rely on simple conversion if we can parse the SDF.
                                // OR: Just assume if Cactus fails, we'll use a "template" ligand scaling to molecular weight? 
                                // No, that's fake.

                                // Real fallback: Use PUG View to get JSON 3D coordinates
                                const json3dRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/JSON?record_type=3d`);
                                if (json3dRes.ok) {
                                    const jsonData = await json3dRes.json();
                                    pdbContent = convertPubChemJsonToPdb(jsonData);
                                    console.log('[Ligand] PubChem success');
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Ligand] PubChem failed:', e.message);
            }
        }

        if (!pdbContent) {
            throw new Error('Could not generate 3D structure from SMILES (Both Cactus and PubChem failed)');
        }

        // Convert PDB to PDBQT
        const pdbqtContent = convertPdbToPdbqt(pdbContent);

        // Save
        const ligandPath = join(LIGAND_DIR, 'default.pdbqt');
        await writeFile(ligandPath, pdbqtContent);

        res.json({ success: true, message: 'Ligand generated (3D Structure)' });

    } catch (error) {
        console.error('[Ligand] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper: Convert PubChem JSON to PDB format
function convertPubChemJsonToPdb(data) {
    // Navigate PubChem JSON schema to find coords
    try {
        const atomIds = data.PC_Compounds[0].atoms.aid;
        const elements = data.PC_Compounds[0].atoms.element;
        const conformer = data.PC_Compounds[0].coords[0].conformers[0];
        const x = conformer.x;
        const y = conformer.y;
        const z = conformer.z;

        let pdb = '';
        const elementMap = { 6: 'C', 8: 'O', 7: 'N', 1: 'H', 16: 'S', 9: 'F', 17: 'Cl', 35: 'Br', 53: 'I', 15: 'P' }; // Basic map

        for (let i = 0; i < atomIds.length; i++) {
            const elNum = elements[i];
            const name = (elementMap[elNum] || 'X').padEnd(3);
            const xPos = x[i].toFixed(3).padStart(8);
            const yPos = y[i].toFixed(3).padStart(8);
            const zPos = z[i].toFixed(3).padStart(8);

            pdb += `ATOM  ${(i + 1).toString().padStart(5)} ${name}  LIG     1    ${xPos}${yPos}${zPos}  1.00  0.00           ${name.trim()}\n`;
        }
        return pdb;
    } catch (e) {
        throw new Error('Failed to parse PubChem JSON');
    }
}

// Helper: Run subprocess
function runProcess(path, args, cwd = undefined) {
    return new Promise((resolve, reject) => {
        const options = cwd ? { cwd } : {};
        const proc = spawn(path, args, options);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Process exited with code ${code}: ${stderr}`));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            proc.kill();
            reject(new Error('Process timeout'));
        }, 5 * 60 * 1000);
    });
}

// Helper: Quick docking with minimal exhaustiveness
async function runQuickDocking(pdbData) {
    const jobId = `quick_${Date.now()}`;
    const receptorPath = join(TEMP_DIR, `${jobId}_receptor.pdbqt`);
    const ligandPath = join(TEMP_DIR, `${jobId}_ligand.pdbqt`);
    const outputPath = join(TEMP_DIR, `${jobId}_output.pdbqt`);
    const logPath = join(TEMP_DIR, `${jobId}_log.txt`);

    await ensureDirs();

    const pdbqtContent = convertPdbToPdbqt(pdbData);
    await writeFile(receptorPath, pdbqtContent);

    const defaultLigand = join(LIGAND_DIR, 'default.pdbqt');
    let ligandContent = existsSync(defaultLigand)
        ? await readFile(defaultLigand, 'utf-8')
        : generateSimpleLigand();
    await writeFile(ligandPath, ligandContent);

    const center = calculateProteinCenter(pdbData);

    const args = [
        '--receptor', receptorPath,
        '--ligand', ligandPath,
        '--out', outputPath,
        '--log', logPath,
        '--center_x', center.x.toString(),
        '--center_y', center.y.toString(),
        '--center_z', center.z.toString(),
        '--size_x', '15',
        '--size_y', '15',
        '--size_z', '15',
        '--exhaustiveness', '4'
    ];

    await runProcess(VINA_PATH, args);

    const logContent = existsSync(logPath) ? await readFile(logPath, 'utf-8') : '';
    const affinityMatch = logContent.match(/^\s*1\s+([-\d.]+)/m);
    const affinity = affinityMatch ? parseFloat(affinityMatch[1]) : -6.0;

    await cleanupFiles([receptorPath, ligandPath, outputPath, logPath]);

    return { affinity };
}

// Helper: Quick stability with FoldX
async function runQuickStability(pdbData) {
    const jobId = `stab_${Date.now()}`;
    const workDir = join(TEMP_DIR, jobId);
    const pdbPath = join(workDir, 'protein.pdb');

    await mkdir(workDir, { recursive: true });
    await writeFile(pdbPath, pdbData);

    const args = [
        '--command=Stability',
        '--pdb=protein.pdb',
        '--output-dir=' + workDir
    ];

    await runProcess(FOLDX_PATH, args, workDir);

    const outputFile = join(workDir, 'protein_Stability.txt');
    let stability = 0;

    if (existsSync(outputFile)) {
        const content = await readFile(outputFile, 'utf-8');
        const match = content.match(/Total\s*=\s*([-\d.]+)/);
        if (match) {
            stability = parseFloat(match[1]);
        }
    }

    await cleanupDir(workDir);

    return { stability };
}

// Helper: Convert PDB to PDBQT (Strict Formatting)
function convertPdbToPdbqt(pdb) {
    const lines = pdb.split('\n');
    const pdbqtLines = [];

    for (const line of lines) {
        if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
            // Clean up basic PDB columns 1-66
            let newLine = line.substring(0, 66);
            if (newLine.length < 66) newLine = newLine.padEnd(66, ' ');

            // Columns 67-70: Empty
            newLine = newLine.padEnd(70, ' ');

            // Columns 71-76: Charge (Default 0.00, 6 chars)
            newLine += ' +0.00';

            // Columns 77-78: Space? Or Element start?
            // Vina expects Atom Type at end. Standard PDBQT puts it at 78-79 roughly.
            // Let's ensure a space at 77 then type at 78-79.

            newLine += ' '; // Col 77

            // Columns 78-79: Atom Type
            let info = line.substring(12, 16).trim();
            let element = info.replace(/[0-9]/g, '').substring(0, 1); // Simplistic one-letter
            // Try to match standard PDB element column if available
            if (line.length >= 78) {
                const pdbElem = line.substring(76, 78).trim();
                if (pdbElem) element = pdbElem;
            }
            // AutoDock atom types (simplified map)
            const type = element.toUpperCase().padEnd(2);

            newLine += type;

            pdbqtLines.push(newLine);
        } else if (line.startsWith('END') || line.startsWith('TER') || line.startsWith('ROOT') || line.startsWith('BRANCH') || line.startsWith('TORSDOF')) {
            pdbqtLines.push(line);
        }
    }

    return pdbqtLines.join('\n');
}

// Helper: Calculate protein center of mass
function calculateProteinCenter(pdb) {
    const lines = pdb.split('\n');
    let sumX = 0, sumY = 0, sumZ = 0, count = 0;

    for (const line of lines) {
        if (line.startsWith('ATOM') && line.substring(12, 16).trim() === 'CA') {
            const x = parseFloat(line.substring(30, 38));
            const y = parseFloat(line.substring(38, 46));
            const z = parseFloat(line.substring(46, 54));

            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                sumX += x;
                sumY += y;
                sumZ += z;
                count++;
            }
        }
    }

    if (count === 0) return { x: 0, y: 0, z: 0 };

    return {
        x: Math.round(sumX / count * 100) / 100,
        y: Math.round(sumY / count * 100) / 100,
        z: Math.round(sumZ / count * 100) / 100
    };
}

// Helper: Extract sequence from PDB
function extractSequenceFromPdb(pdb) {
    const threeToOne = {
        'ALA': 'A', 'CYS': 'C', 'ASP': 'D', 'GLU': 'E', 'PHE': 'F',
        'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LYS': 'K', 'LEU': 'L',
        'MET': 'M', 'ASN': 'N', 'PRO': 'P', 'GLN': 'Q', 'ARG': 'R',
        'SER': 'S', 'THR': 'T', 'VAL': 'V', 'TRP': 'W', 'TYR': 'Y'
    };

    const lines = pdb.split('\n');
    const residues = new Map();

    for (const line of lines) {
        if (line.startsWith('ATOM') && line.substring(12, 16).trim() === 'CA') {
            const resName = line.substring(17, 20).trim();
            const resNum = parseInt(line.substring(22, 26));
            const aa = threeToOne[resName] || 'X';
            residues.set(resNum, aa);
        }
    }

    return Array.from(residues.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, aa]) => aa)
        .join('');
}

// Helper: Run subprocess
function runProcess(path, args, cwd = undefined) {
    return new Promise((resolve, reject) => {
        const process = spawn(path, args, { cwd, shell: true });

        // Capture stderr for debugging
        let stderr = '';
        process.stderr.on('data', d => stderr += d.toString());

        process.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Process exited with code ${code}: ${stderr}`));
        });

        process.on('error', (err) => reject(err));
    });
}

// Helper: Extract sequence from PDB (Simple stub)
function extractSequenceFromPdb(pdb) {
    try {
        const lines = pdb.split('\n');
        const residues = new Map();
        const threeToOne = {
            'ALA': 'A', 'CYS': 'C', 'ASP': 'D', 'GLU': 'E', 'PHE': 'F',
            'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LYS': 'K', 'LEU': 'L',
            'MET': 'M', 'ASN': 'N', 'PRO': 'P', 'GLN': 'Q', 'ARG': 'R',
            'SER': 'S', 'THR': 'T', 'VAL': 'V', 'TRP': 'W', 'TYR': 'Y'
        };

        for (const line of lines) {
            if (line.startsWith('ATOM') && line.substring(13, 15) === 'CA') {
                const resName = line.substring(17, 20).trim();
                const resNum = parseInt(line.substring(22, 26));
                const aa = threeToOne[resName] || 'X';
                residues.set(resNum, aa);
            }
        }
        return Array.from(residues.keys()).sort((a, b) => a - b).map(k => residues.get(k)).join('');
    } catch (e) { return 'A'.repeat(50); }
}

// Helper: Convert PDB to PDBQT (Strict Formatting - ATOM ONLY)
function convertPdbToPdbqt(pdb) {
    const lines = pdb.split('\n');
    const pdbqtLines = [];

    for (const line of lines) {
        if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
            // Clean up basic PDB columns 1-66
            let newLine = line.substring(0, 66);
            if (newLine.length < 66) newLine = newLine.padEnd(66, ' ');

            // Columns 67-70: Empty
            newLine = newLine.padEnd(70, ' ');

            // Columns 71-76: Charge (Default 0.00, 6 chars)
            newLine += ' +0.00';

            // Columns 77-78: Space? Or Element start?
            newLine += ' '; // Col 77

            // Columns 78-79: Atom Type
            let info = line.substring(12, 16).trim();
            let element = info.replace(/[0-9]/g, '').substring(0, 1);
            if (line.length >= 78) {
                const pdbElem = line.substring(76, 78).trim();
                if (pdbElem) element = pdbElem;
            }
            const type = element.toUpperCase().padEnd(2);

            newLine += type;

            pdbqtLines.push(newLine);
        }
        // IGNORE ALL OTHER LINES (END, TER, HEADER) to prevent "Unknown or inappropriate tag" errors
    }

    return pdbqtLines.join('\n');
}

// Helper: Estimate affinity from sequence (fallback)
function estimateAffinity(sequence) {
    const hydrophobic = 'AILMFVW';
    let score = -6.0;

    for (const aa of sequence.toUpperCase()) {
        if (hydrophobic.includes(aa)) score -= 0.01;
    }

    return Math.max(-12, Math.min(-4, score + (Math.random() - 0.5)));
}

// Helper: Estimate stability (fallback)
function estimateStability(sequence) {
    const cysteines = (sequence.match(/C/gi) || []).length;
    let stability = -0.5;

    if (cysteines >= 2) stability -= cysteines * 0.1;

    return Math.round((stability + (Math.random() - 0.5) * 0.5) * 100) / 100;
}

// Helper: Generate simple ligand
function generateSimpleLigand() {
    return `REMARK  Simple test ligand
ATOM      1  C1  LIG     1       0.000   1.400   0.000  1.00  0.00    +0.000 C
ATOM      2  C2  LIG     1       1.212   0.700   0.000  1.00  0.00    +0.000 C
ATOM      3  C3  LIG     1       1.212  -0.700   0.000  1.00  0.00    +0.000 C
ATOM      4  C4  LIG     1       0.000  -1.400   0.000  1.00  0.00    +0.000 C
ATOM      5  C5  LIG     1      -1.212  -0.700   0.000  1.00  0.00    +0.000 C
ATOM      6  C6  LIG     1      -1.212   0.700   0.000  1.00  0.00    +0.000 C
END`;
}

// Helper: Cleanup temp files
async function cleanupFiles(paths) {
    for (const p of paths) {
        try {
            if (existsSync(p)) await unlink(p);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

// Helper: Cleanup directory
async function cleanupDir(dir) {
    try {
        const { rm } = await import('fs/promises');
        if (existsSync(dir)) {
            await rm(dir, { recursive: true, force: true });
        }
    } catch (e) {
        // Ignore cleanup errors
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║          PROTEIN REFINERY BACKEND SERVER                       ║
╠════════════════════════════════════════════════════════════════╣
║  Status:  🟢 Running                                           ║
║  Port:    ${PORT}                                                   ║
║  Vina:    ${existsSync(VINA_PATH) ? '✅ Available' : '❌ Not found'}                                        ║
║  FoldX:   ${existsSync(FOLDX_PATH) ? '✅ Available' : '❌ Not found'}                                        ║
╠════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                    ║
║    GET  /api/health    - Health check                         ║
║    GET  /api/info      - Server info                          ║
║    POST /api/dock      - Run Vina docking                     ║
║    POST /api/stability - Run FoldX stability                  ║
║    POST /api/score     - Combined scoring                     ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
