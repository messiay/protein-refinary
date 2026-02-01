// Type definitions for Protein Refinery

export interface ProteinDesign {
    id: string;
    sequence: string;
    pdbData?: string;
    generation: number;
    parentId?: string;
    scores: {
        affinity: number;
        stability: number;
        plddt?: number;
    };
    mutations: string[];
    timestamp: number;
    status: 'pending' | 'folding' | 'scoring' | 'complete' | 'failed';
}

export interface EvolutionConfig {
    numVariants: number;
    maxGenerations: number;
    temperature: number;
    stabilityThreshold: number;
    affinityThreshold: number;
}

export interface GenerationResult {
    generation: number;
    designs: ProteinDesign[];
    bestDesign: ProteinDesign | null;
    passRate: number;
    timestamp: number;
}

export interface VaultEntry {
    id: string;
    design: ProteinDesign;
    createdAt: number;
    updatedAt: number;
}

export interface FoldResult {
    pdbData: string;
    plddt: number;
    success: boolean;
    error?: string;
}

export interface DesignResult {
    sequences: string[];
    success: boolean;
    error?: string;
}

export interface ScoreResult {
    affinity: number;
    stability: number;
    success: boolean;
    error?: string;
}

export interface EvolutionState {
    isRunning: boolean;
    currentGeneration: number;
    currentStep: 'idle' | 'designing' | 'folding' | 'scoring' | 'learning';
    progress: number;
    bestScore: number;
    history: GenerationResult[];
}
