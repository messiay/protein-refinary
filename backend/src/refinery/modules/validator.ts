export class Validator {
    // Mock FoldX & Vina
    // Returns [stability, affinity]
    // Stability: Lower is better (negative)
    // Affinity: Lower is better (negative)

    public async validate(sequence: string): Promise<{ stability: number, affinity: number }> {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 200));

        // Generate random scores centered around a "wild type" baseline
        // Baseline: Stability -5.0, Affinity -6.0

        // Add some noise based on sequence "hash" or random to simulate different proteins
        const randomFactor = Math.random();

        // 10% chance of a significant improvement (Evolutionary Leap)
        const isLeap = randomFactor > 0.9;

        const stabilityBase = -5.0;
        const affinityBase = -6.0;

        const stability = stabilityBase + (Math.random() * 4 - 2) - (isLeap ? 1.5 : 0);
        const affinity = affinityBase + (Math.random() * 4 - 2) - (isLeap ? 1.5 : 0);

        return {
            stability: parseFloat(stability.toFixed(2)),
            affinity: parseFloat(affinity.toFixed(2))
        };
    }
}
