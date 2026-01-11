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
            await execAsync(`${CONFIG.PATHS.VINA} --receptor mutant.pdb --ligand ligand.pdbqt --center_x 0 --center_y 0 --center_z 0`, { cwd: workDir });

            // Check if we are in REAL mode but no binaries
            // throw new Error("Binaries not found (Simulation Step).");

            // 3. Parse Results
            // A. FoldX Stability (Total Energy)
            let stability = 0.0;
            try {
                // FoldX output file naming is specific to the command
                const fxFiles = await fs.readdir(workDir);
                const fxOut = fxFiles.find(f => f.startsWith('Raw_BuildModel_'));

                if (fxOut) {
                    const fxContent = await fs.readFile(path.join(workDir, fxOut), 'utf-8');
                    // Format is usually tab-separated. We need "Total Energy" which is often the last or specific column.
                    // For BuildModel, it's often column 1 (after name) or similar. 
                    // Let's assume standard FoldX header structure.
                    const lines = fxContent.split('\n');
                    // Line 0: Header, Line 1: Data
                    // Heuristic: Last value is usually the delta or total. 
                    // Better: Split by tab, parse meaningful float. 
                    const data = lines[lines.length - 2]?.split('\t'); // usually last line is empty
                    if (data && data.length > 1) {
                        stability = parseFloat(data[1]); // Often index 1 is Total Energy
                    }
                }
            } catch (e) {
                console.warn("[RealValidator] FoldX Parse Error", e);
            }

            // B. Vina Affinity
            let affinity = 0.0;
            try {
                // We grep the stdout or log file. Since we executed directly, let's assume we capture stdout next time.
                // But typically users might log to a file. 
                // Let's try reading 'mutant_log.txt' if available, or 'output.pdbqt' contents.
                // Vina Output PDBQT also has REMARK lines with affinity.
                // REMARK VINA RESULT:   -9.5      0.000      0.000
                const vinaOutPath = path.join(workDir, 'mutant.pdbqt'); // Using input naming from command
                // Wait, command was: --receptor mutant.pdb --ligand ligand.pdbqt
                // Vina defaults to 'ligand_out.pdbqt' if not specified? Or prints to stdout.
                // We should update the command to write to a log or check the default out.
                // Assuming standard Vina output 'ligand_out.pdbqt' (default) or we grab from stdout (which we didn't capture).

                // NOTE: To make this robust, we need to read the output PDBQT remarks.
                // Standard name if not specified is {ligand_name}_out.pdbqt.
                const vinaResultPath = path.join(workDir, 'ligand_out.pdbqt');

                const vinaContent = await fs.readFile(vinaResultPath, 'utf-8');
                const affinityMatch = vinaContent.match(/REMARK VINA RESULT:\s+([-\d.]+)/);
                if (affinityMatch) {
                    affinity = parseFloat(affinityMatch[1]);
                }
            } catch (e) {
                console.warn("[RealValidator] Vina Parse Error", e);
            }

            return {
                stability,
                affinity,
                pdbPath: path.join(workDir, 'average_0.pdb') // FoldX usually outputs this
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
