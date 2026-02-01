// Orchestrator - The Evolutionary Loop Engine
// Coordinates all engines to iteratively improve protein designs

import type {
    ProteinDesign,
    EvolutionConfig,
    EvolutionState,
    GenerationResult
} from '../types';

import { foldSequence } from '../services/esmfoldService';
import { designSequences, getMutations } from '../services/proteinmpnnService';
import { scoreDesign, calculateFitness, isStable } from '../services/scoringService';
import { saveDesign, getBestDesign, generateDesignId } from '../services/vaultService';

export type LogEntry = {
    time: string;
    message: string;
    level: 'info' | 'success' | 'warning' | 'error';
};

export type EvolutionCallback = {
    onStateChange: (state: EvolutionState) => void;
    onLog: (entry: LogEntry) => void;
    onDesignComplete: (design: ProteinDesign) => void;
    onGenerationComplete: (result: GenerationResult) => void;
};

const DEFAULT_CONFIG: EvolutionConfig = {
    numVariants: 5,
    maxGenerations: 10,
    temperature: 0.1,
    stabilityThreshold: 0,
    affinityThreshold: -7,
};

export class Orchestrator {
    private config: EvolutionConfig;
    private callbacks: EvolutionCallback;
    private isRunning: boolean = false;
    private shouldStop: boolean = false;
    private currentState: EvolutionState;

    constructor(config: Partial<EvolutionConfig> = {}, callbacks: EvolutionCallback) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.callbacks = callbacks;
        this.currentState = this.getInitialState();
    }

    private getInitialState(): EvolutionState {
        return {
            isRunning: false,
            currentGeneration: 0,
            currentStep: 'idle',
            progress: 0,
            bestScore: 0,
            history: [],
        };
    }

    private log(message: string, level: LogEntry['level'] = 'info') {
        const time = new Date().toLocaleTimeString();
        this.callbacks.onLog({ time, message, level });
    }

    private updateState(updates: Partial<EvolutionState>) {
        this.currentState = { ...this.currentState, ...updates };
        this.callbacks.onStateChange(this.currentState);
    }

    async run(initialPdbData: string, initialSequence: string): Promise<void> {
        if (this.isRunning) {
            this.log('Evolution already running', 'warning');
            return;
        }

        this.isRunning = true;
        this.shouldStop = false;
        this.updateState({ isRunning: true, currentGeneration: 0 });

        this.log('🧬 Starting Evolutionary Loop', 'success');
        this.log(`Configuration: ${this.config.numVariants} variants, ${this.config.maxGenerations} generations`);

        let currentPdbData = initialPdbData;
        let parentSequence = initialSequence;
        let parentId: string | undefined = undefined;
        let bestOverallScore = Infinity;

        try {
            for (let gen = 1; gen <= this.config.maxGenerations; gen++) {
                if (this.shouldStop) {
                    this.log('⏹️ Evolution stopped by user', 'warning');
                    break;
                }

                this.updateState({
                    currentGeneration: gen,
                    progress: (gen - 1) / this.config.maxGenerations * 100
                });

                this.log(`\n═══ Generation ${gen} ═══`, 'info');

                // STEP 1: DESIGN
                this.updateState({ currentStep: 'designing' });
                this.log('🎨 Designing sequence variants...', 'info');

                const designResult = await designSequences(
                    currentPdbData,
                    this.config.numVariants,
                    this.config.temperature
                );

                if (!designResult.success || designResult.sequences.length === 0) {
                    this.log('Failed to generate sequences', 'error');
                    continue;
                }

                this.log(`Generated ${designResult.sequences.length} variants`, 'success');

                // STEP 2: FOLD
                this.updateState({ currentStep: 'folding' });
                this.log('🔬 Folding structures...', 'info');

                const designs: ProteinDesign[] = [];

                for (let i = 0; i < designResult.sequences.length; i++) {
                    if (this.shouldStop) break;

                    const sequence = designResult.sequences[i];
                    const designId = generateDesignId();

                    const design: ProteinDesign = {
                        id: designId,
                        sequence,
                        generation: gen,
                        parentId,
                        scores: { affinity: 0, stability: 0 },
                        mutations: getMutations(parentSequence, sequence),
                        timestamp: Date.now(),
                        status: 'folding',
                    };

                    try {
                        const foldResult = await foldSequence(sequence);

                        if (foldResult.success) {
                            design.pdbData = foldResult.pdbData;
                            design.scores.plddt = foldResult.plddt;
                            design.status = 'scoring';

                            this.log(`  Folded variant ${i + 1}/${designResult.sequences.length} (pLDDT: ${foldResult.plddt.toFixed(1)})`, 'info');
                        } else {
                            design.status = 'failed';
                            this.log(`  Variant ${i + 1} fold failed`, 'warning');
                        }
                    } catch (error) {
                        design.status = 'failed';
                        this.log(`  Variant ${i + 1} error: ${error}`, 'error');
                    }

                    designs.push(design);
                }

                // STEP 3: TEST
                this.updateState({ currentStep: 'scoring' });
                this.log('📊 Scoring designs...', 'info');

                for (const design of designs) {
                    if (design.status !== 'scoring' || !design.pdbData) continue;

                    const scoreResult = await scoreDesign(
                        design.pdbData,
                        design.sequence,
                        design.scores.plddt || 70
                    );

                    design.scores.affinity = scoreResult.affinity;
                    design.scores.stability = scoreResult.stability;
                    design.status = 'complete';

                    this.callbacks.onDesignComplete(design);
                }

                // STEP 4: LEARN
                this.updateState({ currentStep: 'learning' });
                this.log('💾 Saving to vault...', 'info');

                const completedDesigns = designs.filter(d => d.status === 'complete');
                const stableDesigns = completedDesigns.filter(d =>
                    isStable(d.scores.stability, this.config.stabilityThreshold)
                );

                const passRate = completedDesigns.length > 0
                    ? stableDesigns.length / completedDesigns.length
                    : 0;

                this.log(`  Pass rate: ${(passRate * 100).toFixed(0)}% (${stableDesigns.length}/${completedDesigns.length})`,
                    passRate > 0.5 ? 'success' : 'warning');

                // Save all completed designs to vault
                for (const design of completedDesigns) {
                    await saveDesign(design);
                }

                // Find best design this generation
                let bestThisGen: ProteinDesign | null = null;
                let bestScore = Infinity;

                for (const design of stableDesigns) {
                    const fitness = calculateFitness(design.scores.affinity, design.scores.stability);
                    if (fitness < bestScore) {
                        bestScore = fitness;
                        bestThisGen = design;
                    }
                }

                // Update best overall
                if (bestThisGen && bestScore < bestOverallScore) {
                    bestOverallScore = bestScore;
                    currentPdbData = bestThisGen.pdbData!;
                    parentSequence = bestThisGen.sequence;
                    parentId = bestThisGen.id;

                    this.log(`  🏆 New best: ${bestThisGen.scores.affinity.toFixed(1)} kcal/mol`, 'success');
                    this.updateState({ bestScore: bestThisGen.scores.affinity });
                } else if (bestThisGen) {
                    this.log(`  Best this gen: ${bestThisGen.scores.affinity.toFixed(1)} kcal/mol (no improvement)`, 'info');
                } else {
                    this.log('  No stable designs this generation', 'warning');
                }

                // Record generation result
                const genResult: GenerationResult = {
                    generation: gen,
                    designs: completedDesigns,
                    bestDesign: bestThisGen,
                    passRate,
                    timestamp: Date.now(),
                };

                this.currentState.history.push(genResult);
                this.callbacks.onGenerationComplete(genResult);

                // Adaptive temperature: increase if no improvement
                if (!bestThisGen || bestScore >= bestOverallScore) {
                    this.config.temperature = Math.min(0.5, this.config.temperature + 0.05);
                    this.log(`  Increasing temperature to ${this.config.temperature.toFixed(2)}`, 'info');
                }
            }

            // Final summary
            this.log('\n═══ Evolution Complete ═══', 'success');
            const bestDesign = await getBestDesign();
            if (bestDesign) {
                this.log(`Best design: ${bestDesign.scores.affinity.toFixed(1)} kcal/mol (Gen ${bestDesign.generation})`, 'success');
            }

        } catch (error) {
            this.log(`Evolution error: ${error}`, 'error');
        } finally {
            this.isRunning = false;
            this.updateState({
                isRunning: false,
                currentStep: 'idle',
                progress: 100
            });
        }
    }

    stop(): void {
        if (this.isRunning) {
            this.shouldStop = true;
            this.log('Stopping evolution...', 'warning');
        }
    }

    updateConfig(updates: Partial<EvolutionConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    getState(): EvolutionState {
        return this.currentState;
    }
}
