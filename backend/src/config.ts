import path from 'path';

export const CONFIG = {
    // 'SIMULATION' | 'REAL'
    MODE: process.env.REFINERY_MODE || 'SIMULATION',

    // Paths to external tools (User must provide these for REAL mode)
    PATHS: {
        FOLDX: path.join(__dirname, '../../bin/foldx.exe'),
        VINA: path.join(__dirname, '../../bin/vina.exe'),
        PDB_DIR: path.join(__dirname, '../../vault'),
        WORK_DIR: path.join(__dirname, '../../workspace')
    },

    // Simulation Parameters
    SIMULATION: {
        MUTATION_RATE: 1,
        STAGNATION_THRESHOLD: 3
    }
};
