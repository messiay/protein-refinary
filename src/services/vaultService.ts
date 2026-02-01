// Vault Service - IndexedDB-based protein design storage
// Persists across browser sessions without needing a server

import type { ProteinDesign, VaultEntry } from '../types';

const DB_NAME = 'protein-refinery-vault';
const DB_VERSION = 1;
const STORE_NAME = 'designs';

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[Vault] IndexedDB error:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('generation', 'design.generation', { unique: false });
                store.createIndex('affinity', 'design.scores.affinity', { unique: false });
                store.createIndex('timestamp', 'createdAt', { unique: false });
            }
        };
    });
}

export async function saveDesign(design: ProteinDesign): Promise<void> {
    const database = await getDB();
    const now = Date.now();

    const entry: VaultEntry = {
        id: design.id,
        design,
        createdAt: now,
        updatedAt: now,
    };

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getDesign(id: string): Promise<ProteinDesign | null> {
    const database = await getDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            const entry = request.result as VaultEntry | undefined;
            resolve(entry?.design || null);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getAllDesigns(): Promise<ProteinDesign[]> {
    const database = await getDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const entries = request.result as VaultEntry[];
            const designs = entries.map(e => e.design);
            resolve(designs);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getDesignsByGeneration(generation: number): Promise<ProteinDesign[]> {
    const database = await getDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('generation');
        const request = index.getAll(generation);

        request.onsuccess = () => {
            const entries = request.result as VaultEntry[];
            resolve(entries.map(e => e.design));
        };
        request.onerror = () => reject(request.error);
    });
}

export async function getBestDesign(): Promise<ProteinDesign | null> {
    const designs = await getAllDesigns();

    // Filter stable designs and sort by affinity
    const stableDesigns = designs.filter(d =>
        d.status === 'complete' && d.scores.stability < 0
    );

    if (stableDesigns.length === 0) {
        // If no stable designs, return the one with best affinity anyway
        return designs.sort((a, b) => a.scores.affinity - b.scores.affinity)[0] || null;
    }

    // Sort by affinity (lower is better)
    stableDesigns.sort((a, b) => a.scores.affinity - b.scores.affinity);
    return stableDesigns[0];
}

export async function deleteDesign(id: string): Promise<void> {
    const database = await getDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function clearVault(): Promise<void> {
    const database = await getDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getVaultStats(): Promise<{
    totalDesigns: number;
    generations: number;
    bestAffinity: number;
    passRate: number;
}> {
    const designs = await getAllDesigns();

    if (designs.length === 0) {
        return { totalDesigns: 0, generations: 0, bestAffinity: 0, passRate: 0 };
    }

    const generations = Math.max(...designs.map(d => d.generation), 0);
    const stableCount = designs.filter(d => d.scores.stability < 0).length;
    const bestAffinity = Math.min(...designs.map(d => d.scores.affinity));

    return {
        totalDesigns: designs.length,
        generations,
        bestAffinity,
        passRate: stableCount / designs.length,
    };
}

export function generateDesignId(): string {
    return `design_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
