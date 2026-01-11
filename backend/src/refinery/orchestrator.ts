import { Designer } from './modules/designer';
import { Validator } from './modules/validator';
import { RealValidator } from './modules/validator_real';
import { Gatekeeper } from './modules/gatekeeper';
import { db } from '../database';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import { CONFIG } from '../config';
import { IValidator, IDesigner } from '../interfaces';

interface Protein {
    id?: string;
    sequence: string;
    affinity: number;
    stability: number;
}

export class Orchestrator extends EventEmitter {
    private designer: Designer; // TODO: Interface
    private validator: IValidator;
    private gatekeeper: Gatekeeper;

    private currentParent: Protein;
    private isRunning: boolean = false;
    private generation: number = 0;

    // Phase 4: Advanced Evolution
    private stagnationCount: number = 0; // Stagnation Counter
    private paretoFrontier: Protein[] = [];
    private readonly STAGNATION_THRESHOLD = 3;

    constructor() {
        super();
        this.designer = new Designer(); // TODO: RealDesigner (Future)

        // FACTORY PATTERN: Choose Validator based on Config
        if (CONFIG.MODE === 'REAL') {
            console.log("⚠️ REFINERY STARTING IN REAL SCIENCE MODE");
            this.validator = new RealValidator();
        } else {
            console.log("ℹ️ Refinery starting in Simulation Mode");
            this.validator = new Validator();
        }

        this.gatekeeper = new Gatekeeper();

        // Initial Wild Type
        this.currentParent = {
            sequence: "MKTIIALSYIFCLVFADYKDDDDKL",
            affinity: -5.0,
            stability: -5.0
        };
        this.addToPareto(this.currentParent);
    }

    public async setInitialProtein(sequence: string, pdbPath: string) {
        // In a real app, we'd calculate initial affinity/stability here
        this.emit('log', `🔬 Validating Initial Protein: ${sequence.slice(0, 10)}...`);
        const { stability, affinity, pdbPath: validatedPath } = await this.validator.validate(sequence, pdbPath, "initial");

        this.currentParent = {
            sequence: sequence,
            affinity: affinity,
            stability: stability,
            id: 'CUSTOM_PARENT'
        };
        this.paretoFrontier = []; // Reset frontier
        this.stagnationCount = 0;
        this.addToPareto(this.currentParent);
        this.emit('log', `✅ Baseline Set: Affinity ${affinity.toFixed(2)} | Stability ${stability.toFixed(2)}`);
        this.emit('new_candidate', { ...this.currentParent, generation: 0, novelty_status: 'WILD_TYPE' });
    }

    private addToPareto(protein: Protein) {
        // Simple Pareto Logic: Keep if no other protein is better in BOTH dimensions
        // In a real system, we'd prune the list. 
        // For visualization, we'll just keep adding good ones.
        this.paretoFrontier.push(protein);
        // Only keep last 200 for UI performance
        if (this.paretoFrontier.length > 200) this.paretoFrontier.shift();
        this.emit('pareto_update', this.paretoFrontier);
    }

    public async start(generations: number = 50) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.emit('status', 'Started Protein Refinery Loop (Phase 4: Advanced)');

        for (let g = 0; g < generations; g++) {
            if (!this.isRunning) break;
            this.generation = g + 1;

            this.emit('log', `\n=== GENERATION ${this.generation} ===`);
            this.emit('log', `Parent Affinity: ${this.currentParent.affinity.toFixed(2)} | Stability: ${this.currentParent.stability.toFixed(2)}`);

            // Check Stagnation (Cached in Stagnation Counter)
            let mutationRate = 1;
            if (this.stagnationCount >= this.STAGNATION_THRESHOLD) {
                this.emit('log', `⚠️ Stagnation Detected (${this.stagnationCount} gens). Triggering MUTATION JUMP! 🚀`);
                mutationRate = 3; // Aggressive mutation
                this.stagnationCount = 0; // Reset
            }

            // 1. Design
            const candidates = await this.designer.design(this.currentParent.sequence, 5, mutationRate);

            let generationBest: Protein | null = null;
            let generationBestScore = 100; // High is bad

            // 2. Validate & Bank
            for (const seq of candidates) {
                const { isNovel, status } = this.gatekeeper.checkNovelty(seq);

                // Pass parentPDB and current ID to validate
                const id = `SYN-${uuidv4().slice(0, 8)}`;
                const { stability, affinity, pdbPath } = await this.validator.validate(seq, 'parent.pdb', id);

                const proteinCandidate: Protein = { id, sequence: seq, affinity, stability };

                await db.saveProtein({
                    id,
                    parent_id: this.generation === 1 ? 'WILD_TYPE' : 'PREV_GEN',
                    sequence: seq,
                    binding_affinity: affinity,
                    stability_score: stability,
                    generation: this.generation,
                    novelty_status: status,
                    file_path: pdbPath || `/vault/${id}.pdb`
                });

                this.emit('new_candidate', { ...proteinCandidate, generation: this.generation, novelty_status: status });
                this.addToPareto(proteinCandidate);

                // Check local best (Greedy selection for next parent)
                // We primarily optimize Affinity, but ensure Stability is decent (< -5.0)
                if (affinity < generationBestScore && stability < -4.0 && affinity != 0) {
                    generationBestScore = affinity;
                    generationBest = proteinCandidate;
                }
            }

            // 3. Evolve
            if (generationBest && generationBest.affinity < this.currentParent.affinity) {
                this.emit('log', `*** EVOLUTIONARY LEAP: ${this.currentParent.affinity.toFixed(2)} -> ${generationBest.affinity.toFixed(2)} ***`);
                this.currentParent = generationBest;
                this.emit('evolution_leap', this.currentParent);
                this.stagnationCount = 0;
            } else {
                this.emit('log', "Evolution stalled. Keeping previous parent.");
                this.stagnationCount++;
            }

            // Sleep a bit to make it visible in UI
            await new Promise(r => setTimeout(r, 1000));
        }

        this.isRunning = false;
        this.emit('status', 'Refinery Loop Completed');
    }

    public stop() {
        this.isRunning = false;
        this.emit('status', 'Stopping...');
    }
}

export const orchestrator = new Orchestrator();
