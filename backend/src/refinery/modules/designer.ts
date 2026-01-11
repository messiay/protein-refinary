export class Designer {
    // Mock ProteinMPNN: Mutates the sequence slightly
    public async design(parentSequence: string, count: number = 5, mutationRate: number = 1): Promise<string[]> {
        const candidates: string[] = [];
        for (let i = 0; i < count; i++) {
            candidates.push(this.mutate(parentSequence, mutationRate));
        }
        return candidates;
    }

    private mutate(seq: string, rate: number): string {
        // Simple mock mutation: change random characters
        const aminoAcids = 'ACDEFGHIKLMNPQRSTVWY';
        const chars = seq.split('');

        // Mutate 'rate' number of times
        for (let i = 0; i < rate; i++) {
            const idx = Math.floor(Math.random() * chars.length);
            const newAA = aminoAcids[Math.floor(Math.random() * aminoAcids.length)];
            chars[idx] = newAA;
        }
        return chars.join('');
    }
}
