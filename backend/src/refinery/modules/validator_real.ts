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

            // 2. Validate paths and Run Tools
            // If binaries are missing, we throw error to be caught below.

            // SIMULATED EXECUTION BLOCK (Uncomment when binaries exist)
            await execAsync(`${CONFIG.PATHS.FOLDX} --command=BuildModel --pdb=${parentPdb} --mutant-file=individual_list.txt`, { cwd: workDir });

            // 2b. Run Vina
            await execAsync(`${CONFIG.PATHS.VINA} --receptor mutant.pdb --ligand ligand.pdbqt --center_x 0 --center_y 0 --center_z 0 --out mutant.pdbqt`, { cwd: workDir });

            // 3. Parse and Return Results (ACTUAL IMPLEMENTATION)

            // --- Parse FoldX Output ---
            // FoldX BuildModel outputs a file named like 'Raw_BuildModel_<pdb>_<mutant>.fx'
            // We need to find the file that starts with 'Raw_' in the workDir.
            const files = await fs.readdir(workDir);
            const foldxFile = files.find(f => f.startsWith('Raw_') && f.endsWith('.fx'));

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
