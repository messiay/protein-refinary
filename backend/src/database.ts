import sqlite3 from 'sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '../../protein_vault.db');

export class Database {
    private db: sqlite3.Database;

    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Could not connect to database', err);
            } else {
                console.log('Connected to SQLite database');
                this.initSchema();
            }
        });
    }

    private initSchema() {
        const sql = `
            CREATE TABLE IF NOT EXISTS protein_bank (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                sequence TEXT,
                binding_affinity REAL,
                stability_score REAL,
                generation INTEGER,
                novelty_status TEXT,
                file_path TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        this.db.run(sql);
    }

    public async saveProtein(protein: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO protein_bank (id, parent_id, sequence, binding_affinity, stability_score, generation, novelty_status, file_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            this.db.run(sql, [
                protein.id,
                protein.parent_id,
                protein.sequence,
                protein.binding_affinity,
                protein.stability_score,
                protein.generation,
                protein.novelty_status,
                protein.file_path
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public async getRecentProteins(limit: number = 50): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM protein_bank ORDER BY timestamp DESC LIMIT ?', [limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    public async getBestProtein(): Promise<any> {
        return new Promise((resolve, reject) => {
            // Lower binding affinity is better (usually negative kcal/mol)
            this.db.get('SELECT * FROM protein_bank ORDER BY binding_affinity ASC LIMIT 1', (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

export const db = new Database();
