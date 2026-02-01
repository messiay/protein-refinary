// Scoring Service - Use backend API for real Vina docking, with fallback to simulation
// Backend runs locally with Vina binary, accessed via API

import type { ScoreResult } from '../types';

// Backend server URL - configurable
const BACKEND_URL = localStorage.getItem('backendUrl') || 'http://localhost:8080';

// Check if backend is available
let backendAvailable: boolean | null = null;

async function checkBackend(): Promise<boolean> {
    if (backendAvailable !== null) return backendAvailable;

    try {
        const response = await fetch(`${BACKEND_URL}/api/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        const data = await response.json();
        backendAvailable = data.vinaAvailable === true;
        console.log(`[Scoring] Backend available: ${backendAvailable}`);
        return backendAvailable;
    } catch {
        backendAvailable = false;
        console.log('[Scoring] Backend not available, using simulation');
        return false;
    }
}

export async function scoreDesign(pdbData: string, sequence: string, plddt: number): Promise<ScoreResult> {
    try {
        // Try backend first
        if (await checkBackend()) {
            try {
                const response = await fetch(`${BACKEND_URL}/api/score`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pdbData, sequence }),
                    signal: AbortSignal.timeout(60000) // 60s timeout for docking
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        console.log(`[Scoring] Backend result: affinity=${result.affinity}, method=${result.method}`);
                        return {
                            affinity: result.affinity,
                            stability: result.stability,
                            success: true,
                        };
                    }
                }
            } catch (error) {
                console.warn('[Scoring] Backend error, falling back to simulation:', error);
            }
        }

        // Fallback to local simulation
        const affinity = estimateAffinity(sequence, pdbData);
        const stability = estimateStability(sequence, plddt);

        return {
            affinity,
            stability,
            success: true,
        };
    } catch (error) {
        console.error('[Scoring] Error:', error);
        return {
            affinity: 0,
            stability: 0,
            success: false,
            error: String(error),
        };
    }
}

// Set backend URL (for connecting to local server)
export function setBackendUrl(url: string): void {
    localStorage.setItem('backendUrl', url);
    backendAvailable = null; // Reset check
}

export function getBackendUrl(): string {
    return localStorage.getItem('backendUrl') || 'http://localhost:8080';
}

export async function isBackendOnline(): Promise<boolean> {
    backendAvailable = null; // Force recheck
    return checkBackend();
}

function estimateAffinity(sequence: string, _pdbData: string): number {
    // Simulate binding affinity based on sequence properties
    // Real docking would use AutoDock Vina via backend API

    const hydrophobic = 'AILMFVW';
    const aromatic = 'FWY';
    const hbond = 'NQSTY';

    let hydrophobicScore = 0;
    let aromaticScore = 0;
    let hbondScore = 0;

    for (const aa of sequence.toUpperCase()) {
        if (hydrophobic.includes(aa)) hydrophobicScore++;
        if (aromatic.includes(aa)) aromaticScore++;
        if (hbond.includes(aa)) hbondScore++;
    }

    const len = sequence.length;
    const hydrophobicRatio = hydrophobicScore / len;
    const aromaticRatio = aromaticScore / len;
    const hbondRatio = hbondScore / len;

    let score = -6.0;
    if (hydrophobicRatio >= 0.25 && hydrophobicRatio <= 0.45) {
        score -= 1.5;
    }
    score -= Math.min(aromaticRatio * 5, 1.0);
    score -= hbondRatio * 0.5;
    score += (Math.random() - 0.5) * 1.0;

    return Math.max(-12, Math.min(-4, score));
}

function estimateStability(sequence: string, plddt: number): number {
    let stability = 0;

    if (plddt >= 90) {
        stability = -2.5 + Math.random() * 0.5;
    } else if (plddt >= 80) {
        stability = -1.5 + Math.random() * 0.5;
    } else if (plddt >= 70) {
        stability = -0.5 + Math.random() * 0.5;
    } else if (plddt >= 50) {
        stability = 0.5 + Math.random() * 0.5;
    } else {
        stability = 1.5 + Math.random() * 0.5;
    }

    const cysteines = (sequence.match(/C/g) || []).length;
    const prolines = (sequence.match(/P/g) || []).length;

    if (cysteines >= 2 && cysteines <= 8) {
        stability -= 0.3 * Math.floor(cysteines / 2);
    }

    const prolineRatio = prolines / sequence.length;
    if (prolineRatio > 0.1) {
        stability += prolineRatio * 2;
    }

    const hydrophobicRatio = countChars(sequence, 'AILMFVW') / sequence.length;
    if (hydrophobicRatio >= 0.3 && hydrophobicRatio <= 0.5) {
        stability -= 0.5;
    }

    return Math.round(stability * 100) / 100;
}

function countChars(str: string, chars: string): number {
    return str.split('').filter(c => chars.includes(c.toUpperCase())).length;
}

// Combine scores into a single fitness metric
export function calculateFitness(affinity: number, stability: number): number {
    if (stability > 0) {
        return affinity + stability * 10;
    }
    return affinity + stability * 0.5;
}

export function isStable(stability: number, threshold: number = 0): boolean {
    return stability < threshold;
}

export function formatAffinity(affinity: number): string {
    return `${affinity.toFixed(1)} kcal/mol`;
}

export function formatStability(stability: number): string {
    const prefix = stability >= 0 ? '+' : '';
    return `${prefix}${stability.toFixed(2)} kcal/mol`;
}

export function getAffinityClass(affinity: number): string {
    if (affinity < -9) return 'score-good';
    if (affinity < -7) return 'score-warning';
    return 'score-bad';
}

export function getStabilityClass(stability: number): string {
    if (stability < -1) return 'score-good';
    if (stability < 0) return 'score-warning';
    return 'score-bad';
}
