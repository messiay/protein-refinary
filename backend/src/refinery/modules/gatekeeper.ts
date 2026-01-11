export class Gatekeeper {
    private seenSequences: Set<string> = new Set();

    public checkNovelty(sequence: string): { isNovel: boolean, status: string } {
        if (this.seenSequences.has(sequence)) {
            return { isNovel: false, status: 'DUPLICATE' };
        }
        this.seenSequences.add(sequence);
        return { isNovel: true, status: 'NOVEL' };
    }
}
