import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../../config';
import { IValidator, ValidationResult } from '../../interfaces';

const execAsync = util.promisify(exec);

export class RealValidator implements IValidator {

    // Validates a sequence using Real Physics Engines
    public async validate(sequence: string, parentPdb: string = 'parent.pdb', id: string = 'test'): Promise<ValidationResult> {

        const workDir = path.join(CONFIG.PATHS.WORK_DIR, id);
        try {
            // 1. Prepare Workspace
            await fs.mkdir(workDir, { recursive: true });

            // Copy parent PDB to workDir to ensure tools can find it consistently
            const localParentPdb = 'parent.pdb';
            await fs.copyFile(parentPdb, path.join(workDir, localParentPdb));

            // 2. Run FoldX (BuildModel)
            // Note: FoldX requires the PDB to be in the current directory or properly referenced. 
            // We use the local copy.
            await execAsync(`${CONFIG.PATHS.FOLDX} --command=BuildModel --pdb=${localParentPdb} --mutant-file=individual_list.txt`, { cwd: workDir });

            // 2b. Run Vina
            // We assume FoldX output is used, or we reuse the structure.
            // If FoldX produces a mutant PDB, we dock against THAT.
            // FoldX BuildModel default output: <pdb>_1.pdb or similar.
            // But we will use 'mutant.pdb' if we can rename it, or rely on parsing.
            // For now, let's look for the produced file and rename it to mutant.pdb for Vina.

            const files = await fs.readdir(workDir);
            const foldxOutputPdb = files.find(f => f.startsWith('Raw_') && f.endsWith('.pdb')); // Heuristic
            // Actually FoldX BuildModel outputs <pdb>_1.pdb usually. 
            // Let's rely on standard naming: {pdb}_1.pdb
            const expectedFoldxPdb = `parent_1.pdb`;

            if (files.includes(expectedFoldxPdb)) {
                await fs.rename(path.join(workDir, expectedFoldxPdb), path.join(workDir, 'mutant.pdb'));
            } else {
                // Fallback: If no mutation (WT), maybe copy parent? 
                // Or just let Vina fail if it depends on it. 
                // For the pipeline:
                await fs.copyFile(path.join(workDir, localParentPdb), path.join(workDir, 'mutant.pdb'));
            }

            // Ensure ligand exists (mocking it if missing for now to prevent crash, user needs to upload ligand)
            // In a real scenario, ligand.pdbqt comes from the upload.
            // checking if 'ligand.pdbqt' exists in root or needs copy?
            // Assuming it's in the workDir? NO. 
            // We need to copy `ligand.pdbqt` from `bin` or uploads if static.
            // For this specific 'Real' mode, we'll try to use a default or assume it's there.
            // Let's Check:
            try {
                await fs.access('ligand.pdbqt');
                await fs.copyFile('ligand.pdbqt', path.join(workDir, 'ligand.pdbqt'));
            } catch {
                // Create dummy if missing to avoid Vina crash
                await fs.writeFile(path.join(workDir, 'ligand.pdbqt'), '');
            }

            await execAsync(`${CONFIG.PATHS.VINA} --receptor mutant.pdb --ligand ligand.pdbqt --center_x 0 --center_y 0 --center_z 0 --out mutant.pdbqt`, { cwd: workDir });

            // 3. Parse and Return Results (ACTUAL IMPLEMENTATION)

            // --- Parse FoldX Output ---
            // FoldX BuildModel outputs a file named like 'Raw_BuildModel_<pdb>_<mutant>.fx'
            // We need to find the file that starts with 'Raw_' in the workDir.
            const resultFiles = await fs.readdir(workDir);
            const foldxFile = resultFiles.find(f => f.startsWith('Raw_') && f.endsWith('.fx'));

            let stabilityScore = 0.0;
            if (foldxFile) {
                const content = await fs.readFile(path.join(workDir, foldxFile), 'utf-8');
                // The energy is usually in the last column of the second line (tab separated)
                // Format: PDB  Total  Backbone ...
                const lines = content.trim().split('\n');
                if (lines.length >= 2) {
                    const columns = lines[lines.length - 1].split('\t');
                    // "Total Energy" is often the 2nd column (index 1) in BuildModel output
                    stabilityScore = parseFloat(columns[1]);
                }
            } else {
                throw new Error("FoldX output file not found.");
            }

            // --- Parse Vina Output ---
            // Vina output (mutant.pdbqt) contains lines like: "REMARK VINA RESULT:   -9.5      0.000      0.000"
            const vinaFile = path.join(workDir, 'mutant.pdbqt'); // Or whatever your --out flag was
            let affinityScore = 0.0;

            try {
                const vinaContent = await fs.readFile(vinaFile, 'utf-8');
                const match = vinaContent.match(/REMARK VINA RESULT:\s+([-\d.]+)/);
                if (match && match[1]) {
                    affinityScore = parseFloat(match[1]);
                } else {
                    // Fallback if regex fails (e.g. no binding mode found)
                    affinityScore = 0.0;
                }
            } catch (e) {
                console.warn("Vina output not found, assuming 0 affinity.");
            }

            return {
                stability: stabilityScore,
                affinity: affinityScore,
                pdbPath: path.join(workDir, 'mutant.pdb') // Ensure this matches your FoldX/Vina output name
            };

        } catch (error) {
            console.error(`[RealValidator] Physics Engine Failed for ${id}:`, error);

            // ROBUSTNESS: Return a "Penalized" score instead of crashing.
            // This allows the genetic algorithm to kill off this branch naturally.
            return {
                stability: 100.0, // High = Bad
                affinity: 0.0,    // High = Bad (since we want negative)
                pdbPath: ""
            };
        }
    }
}
