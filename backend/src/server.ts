import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { db } from './database';
import { orchestrator } from './refinery/orchestrator';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- API Endpoints ---

app.get('/api/stats', async (req, res) => {
    try {
        const best = await db.getBestProtein();
        const recent = await db.getRecentProteins(1);
        const currentGen = recent[0]?.generation || 0;
        res.json({
            bestAffinity: best?.binding_affinity || 0,
            currentGeneration: currentGen,
            totalCandidates: 0 // TODO: Count query if needed
        });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const rows = await db.getRecentProteins(20);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

// Mock PDB Serving
app.get('/api/pdb/:id', (req, res) => {
    // In a real app, we would read the file at `row.file_path`
    // For this demo, we return a hardcoded small protein (Crambin - 1CRN) as a placeholder for ALL generated proteins
    // so the viewer has something to show.
    const samplePDB = `HEADER    PLANT PROTEIN                           30-APR-81   1CRN      
ATOM      1  N   THR A   1      17.047  14.099   3.625  1.00 13.79           N  
ATOM      2  CA  THR A   1      16.967  12.784   4.338  1.00 10.80           C  
ATOM      3  C   THR A   1      15.685  12.755   5.133  1.00  9.19           C  
ATOM      4  O   THR A   1      15.268  13.825   5.594  1.00  9.85           O  
ATOM      5  CB  THR A   1      18.170  12.703   5.337  1.00 13.02           C  
ATOM      6  OG1 THR A   1      19.334  12.829   4.463  1.00 15.06           O  
ATOM      7  CG2 THR A   1      18.150  11.546   6.304  1.00 14.23           C  
ATOM      8  N   THR A   2      15.115  11.555   5.265  1.00  7.81           N  
ATOM      9  CA  THR A   2      13.856  11.469   6.066  1.00  8.31           C  
ATOM     10  C   THR A   2      14.164  10.740   7.379  1.00  5.80           C  
ATOM     11  O   THR A   2      14.993  11.218   8.196  1.00  6.94           O  
ATOM     12  CB  THR A   2      12.732  10.711   5.261  1.00 10.32           C  
ATOM     13  OG1 THR A   2      13.308   9.438   4.926  1.00 12.81           O  
ATOM     14  CG2 THR A   2      12.484  11.442   3.895  1.00 11.23           C  
ATOM     15  N   CYS A   3      13.561   9.559   7.514  1.00  5.49           N  
ATOM     16  CA  CYS A   3      13.798   8.825   8.761  1.00  5.23           C  
ATOM     17  C   CYS A   3      14.509   7.485   8.547  1.00  5.52           C  
ATOM     18  O   CYS A   3      14.053   6.467   9.083  1.00  6.44           O  
ATOM     19  CB  CYS A   3      12.438   8.618   9.447  1.00  5.43           C  
ATOM     20  SG  CYS A   3      12.352   7.327  10.655  1.00  6.55           S  
ATOM     21  N   CYS A   4      15.539   7.458   7.701  1.00  6.86           N  
ATOM     22  CA  CYS A   4      16.327   6.252   7.420  1.00  7.33           C  
ATOM     23  C   CYS A   4      16.364   6.048   5.889  1.00  7.84           C  
ATOM     24  O   CYS A   4      16.331   7.017   5.154  1.00  6.99           O  
ATOM     25  CB  CYS A   4      17.760   6.402   7.935  1.00  7.32           C  
ATOM     26  SG  CYS A   4      18.730   4.883   7.760  1.00  7.79           S  
END`;
    res.send(samplePDB);
});

app.post('/api/start', (req, res) => {
    orchestrator.start();
    res.json({ status: 'started' });
});

app.post('/api/stop', (req, res) => {
    orchestrator.stop();
    res.json({ status: 'stopped' });
});

// --- Server Start ---

const server = app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});

// --- WebSocket ---

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'log', message: 'Connected to Refinery Stream' }));
});

// Broadcast helper
function broadcast(type: string, data: any) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type, data }));
        }
    });
}

// Hook into Orchestrator events
orchestrator.on('log', (msg) => broadcast('log', msg));
orchestrator.on('status', (msg) => broadcast('status', msg));
orchestrator.on('new_candidate', (cand) => broadcast('new_candidate', cand));
orchestrator.on('evolution_leap', (best) => broadcast('evolution_leap', best));
orchestrator.on('pareto_update', (frontier) => broadcast('pareto_update', frontier));
