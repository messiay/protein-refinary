export interface ValidationResult {
    stability: number;
    affinity: number;
    pdbPath: string;
}

export interface IValidator {
    validate(sequence: string, parentPdb?: string, id?: string): Promise<ValidationResult>;
}

export interface IDesigner {
    design(parentSequence: string, count: number, mutationRate: number): Promise<string[]>;
}
