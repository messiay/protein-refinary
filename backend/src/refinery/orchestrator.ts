import { Designer } from './modules/designer';
import { Validator } from './modules/validator';
import { Gatekeeper } from './modules/gatekeeper';
import { db } from '../database';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';

interface Protein {
    id?: string;
    sequence: string;
    affinity: number;
    stability: number;
}

export class Orchestrator extends EventEmitter {
    private designer: Designer;
    private validator: Validator;
    private gatekeeper: Gatekeeper;

    private currentParent: Protein;
    private isRunning: boolean = false;
    private generation: number = 0;

    // Phase 4: Advanced Evolution
    private stagnationCount: number = 0;
    private paretoFrontier: Protein[] = [];
    private readonly STAGNATION_THRESHOLD = 3;

    constructor() {
        super();
        this.designer = new Designer();
        this.validator = new Validator();
        this.gatekeeper = new Gatekeeper();

        // Initial Wild Type
        this.currentParent = {
            sequence: "MKTIIALSYIFCLVFADYKDDDDKL",
            affinity: -5.0,
            stability: -5.0
        };
        this.addToPareto(this.currentParent);
    }

    private addToPareto(protein: Protein) {
        // Simple Pareto Logic: Keep if no other protein is better in BOTH dimensions
        // In a real system, we'd prune the list. 
        // For visualization, we'll just keep adding good ones.
        this.paretoFrontier.push(protein);
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

            // Check Stagnation
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
                const { stability, affinity } = await this.validator.validate(seq);

                const id = `SYN-${uuidv4().slice(0, 8)}`;

                const proteinCandidate: Protein = { id, sequence: seq, affinity, stability };

                await db.saveProtein({
                    id,
                    parent_id: this.generation === 1 ? 'WILD_TYPE' : 'PREV_GEN',
                    sequence: seq,
                    binding_affinity: affinity,
                    stability_score: stability,
                    generation: this.generation,
                    novelty_status: status,
                    file_path: `/vault/${id}.pdb`
                });

                this.emit('new_candidate', { ...proteinCandidate, generation: this.generation, novelty_status: status });
                this.addToPareto(proteinCandidate);

                // Check local best (Greedy selection for next parent)
                // We primarily optimize Affinity, but ensure Stability is decent (< -5.0)
                if (affinity < generationBestScore && stability < -4.0) {
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
