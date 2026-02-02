import { useState, useCallback, useRef, useEffect } from 'react';
import type { ProteinDesign, EvolutionState, GenerationResult, EvolutionConfig } from './types';
import { Orchestrator, LogEntry } from './engines/orchestrator';
import { getAllDesigns, clearVault, getVaultStats } from './services/vaultService';
import { formatAffinity, formatStability, getAffinityClass, getStabilityClass } from './services/scoringService';

// Declare 3Dmol from CDN
declare global {
    interface Window {
        $3Dmol: any;
    }
}

// Sample PDB data for testing
const SAMPLE_PDB = `HEADER    SAMPLE PROTEIN
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 50.00           N
ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 50.00           C
ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00 50.00           C
ATOM      4  O   ALA A   1       1.251   2.390   0.000  1.00 50.00           O
ATOM      5  N   VAL A   2       3.310   1.540   0.000  1.00 50.00           N
ATOM      6  CA  VAL A   2       3.970   2.840   0.000  1.00 50.00           C
ATOM      7  C   VAL A   2       5.480   2.680   0.000  1.00 50.00           C
ATOM      8  O   VAL A   2       6.030   1.580   0.000  1.00 50.00           O
ATOM      9  N   LEU A   3       6.130   3.830   0.000  1.00 50.00           N
ATOM     10  CA  LEU A   3       7.580   3.920   0.000  1.00 50.00           C
ATOM     11  C   LEU A   3       8.150   5.340   0.000  1.00 50.00           C
ATOM     12  O   LEU A   3       7.380   6.290   0.000  1.00 50.00           O
END`;

const SAMPLE_SEQUENCE = 'AVLKGDTFLMQESCPWYHNIRAVLKGDTFLMQESCPWYHNIRAVL';

function App() {
    // State
    const [pdbData, setPdbData] = useState<string>('');
    const [sequence, setSequence] = useState<string>('');
    const [pdbId, setPdbId] = useState<string>('');
    const [smiles, setSmiles] = useState<string>('');
    const [evolutionState, setEvolutionState] = useState<EvolutionState>({
        isRunning: false,
        currentGeneration: 0,
        currentStep: 'idle',
        progress: 0,
        bestScore: 0,
        history: [],
    });
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [designs, setDesigns] = useState<ProteinDesign[]>([]);
    const [selectedDesign, setSelectedDesign] = useState<ProteinDesign | null>(null);
    const [config, setConfig] = useState<EvolutionConfig>({
        numVariants: 5,
        maxGenerations: 5,
        temperature: 0.1,
        stabilityThreshold: 0,
        affinityThreshold: -7,
    });
    const [stats, setStats] = useState({ totalDesigns: 0, generations: 0, bestAffinity: 0, passRate: 0 });

    // Refs
    const orchestratorRef = useRef<Orchestrator | null>(null);
    const viewerRef = useRef<any>(null);
    const viewerContainerRef = useRef<HTMLDivElement>(null);

    // Initialize 3Dmol viewer
    useEffect(() => {
        if (viewerContainerRef.current && window.$3Dmol && !viewerRef.current) {
            viewerRef.current = window.$3Dmol.createViewer(viewerContainerRef.current, {
                backgroundColor: '#0a0f1a',
            });
        }
    }, []);

    // Update viewer when PDB data or selected design changes
    useEffect(() => {
        if (viewerRef.current) {
            viewerRef.current.clear();
            const pdbToShow = selectedDesign?.pdbData || pdbData;
            if (pdbToShow) {
                viewerRef.current.addModel(pdbToShow, 'pdb');
                viewerRef.current.setStyle({}, { cartoon: { color: 'spectrum' } });
                viewerRef.current.zoomTo();
                viewerRef.current.render();
            }
        }
    }, [pdbData, selectedDesign]);

    // Load vault stats on mount
    useEffect(() => {
        loadVaultData();
    }, []);

    const loadVaultData = async () => {
        const allDesigns = await getAllDesigns();
        setDesigns(allDesigns);
        const vaultStats = await getVaultStats();
        setStats(vaultStats);
    };

    const addLog = useCallback((entry: LogEntry) => {
        setLogs(prev => [...prev.slice(-100), entry]);
    }, []);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result as string;
                setPdbData(content);
                extractSequenceFromPdb(content);
            };
            reader.readAsText(file);
        }
    };

    const extractSequenceFromPdb = (pdb: string) => {
        const lines = pdb.split('\n');
        const residues: { resNum: number; aa: string }[] = [];
        const threeToOne: Record<string, string> = {
            'ALA': 'A', 'CYS': 'C', 'ASP': 'D', 'GLU': 'E', 'PHE': 'F',
            'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LYS': 'K', 'LEU': 'L',
            'MET': 'M', 'ASN': 'N', 'PRO': 'P', 'GLN': 'Q', 'ARG': 'R',
            'SER': 'S', 'THR': 'T', 'VAL': 'V', 'TRP': 'W', 'TYR': 'Y',
        };

        for (const line of lines) {
            if (line.startsWith('ATOM') && line.substring(12, 16).trim() === 'CA') {
                const resName = line.substring(17, 20).trim();
                const resNum = parseInt(line.substring(22, 26));
                const aa = threeToOne[resName] || 'X';
                if (!residues.find(r => r.resNum === resNum)) {
                    residues.push({ resNum, aa });
                }
            }
        }

        residues.sort((a, b) => a.resNum - b.resNum);
        setSequence(residues.map(r => r.aa).join(''));
    };

    const fetchFromRcsb = async () => {
        if (!pdbId.trim()) return;

        try {
            addLog({ time: new Date().toLocaleTimeString(), message: `Fetching PDB ${pdbId}...`, level: 'info' });
            const response = await fetch(`https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`);
            if (!response.ok) throw new Error('PDB not found');
            const content = await response.text();
            setPdbData(content);
            extractSequenceFromPdb(content);
            addLog({ time: new Date().toLocaleTimeString(), message: `Loaded PDB ${pdbId}`, level: 'success' });
        } catch (error) {
            addLog({ time: new Date().toLocaleTimeString(), message: `Failed to fetch PDB: ${error}`, level: 'error' });
        }
    };

    const loadSample = () => {
        setPdbData(SAMPLE_PDB);
        setSequence(SAMPLE_SEQUENCE);
        addLog({ time: new Date().toLocaleTimeString(), message: 'Loaded sample protein', level: 'info' });
    };

    const handleLigandUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            addLog({ time: new Date().toLocaleTimeString(), message: `Uploading ligand: ${file.name}`, level: 'info' });

            const formData = new FormData();
            formData.append('ligand', file);

            const response = await fetch('http://localhost:8080/api/upload-ligand', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Upload failed');

            const result = await response.json();
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `✅ Ligand uploaded: ${file.name} (will be used for docking)`,
                level: 'success'
            });
        } catch (error) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `❌ Ligand upload failed: ${error}`,
                level: 'error'
            });
        }
    };

    const handleSmilesSubmit = async () => {
        if (!smiles.trim()) return;

        try {
            addLog({ time: new Date().toLocaleTimeString(), message: `Generating ligand from SMILES: ${smiles}`, level: 'info' });

            const response = await fetch('http://localhost:8080/api/ligand/smiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ smiles: smiles.trim() }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: `Server Error ${response.status}` }));
                throw new Error(err.error || `Generation failed (${response.status})`);
            }

            const result = await response.json();
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `✅ Ligand generated from SMILES (SDF->PDBQT complete)`,
                level: 'success'
            });
            setSmiles(''); // Clear input
        } catch (error) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `❌ SMILES conversion failed: ${error}`,
                level: 'error'
            });
        }
    };

    const startEvolution = () => {
        if (!pdbData || !sequence) {
            addLog({ time: new Date().toLocaleTimeString(), message: 'Please load a protein first', level: 'error' });
            return;
        }

        orchestratorRef.current = new Orchestrator(config, {
            onStateChange: setEvolutionState,
            onLog: addLog,
            onDesignComplete: (design) => {
                setDesigns(prev => [...prev, design]);
            },
            onGenerationComplete: async () => {
                await loadVaultData();
            },
        });

        orchestratorRef.current.run(pdbData, sequence);
    };

    const stopEvolution = () => {
        orchestratorRef.current?.stop();
    };

    const clearAll = async () => {
        await clearVault();
        setDesigns([]);
        setLogs([]);
        setStats({ totalDesigns: 0, generations: 0, bestAffinity: 0, passRate: 0 });
        setSelectedDesign(null);
        addLog({ time: new Date().toLocaleTimeString(), message: 'Vault cleared', level: 'info' });
    };

    const getStepLabel = (step: string): string => {
        const labels: Record<string, string> = {
            idle: 'Ready',
            designing: 'Designing Sequences',
            folding: 'Folding Structures',
            scoring: 'Scoring Designs',
            learning: 'Saving to Vault',
        };
        return labels[step] || step;
    };

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header-content">
                    <div className="logo">
                        <div className="logo-icon">🧬</div>
                        <div>
                            <div className="logo-text">Protein Refinery</div>
                            <div className="logo-subtitle">Evolutionary Loop Engine</div>
                        </div>
                    </div>
                    <div className={`status-badge status-${evolutionState.isRunning ? 'running' : 'idle'}`}>
                        {evolutionState.isRunning && <span className="spinner">◌</span>}
                        {evolutionState.isRunning ? 'Running' : 'Idle'}
                    </div>
                </div>
            </header>

            {/* Dashboard */}
            <main className="dashboard">
                {/* Input Panel */}
                <aside className="panel input-panel">
                    <div className="panel-header">
                        <span className="panel-title">📥 Input</span>
                    </div>
                    <div className="panel-content">
                        {/* File Upload */}
                        <div className="form-group">
                            <label className="form-label">Upload PDB File</label>
                            <label className="file-upload">
                                <input type="file" accept=".pdb" onChange={handleFileUpload} style={{ display: 'none' }} />
                                <div className="file-upload-icon">📄</div>
                                <div className="file-upload-text">Click to upload or drag & drop</div>
                            </label>
                        </div>

                        {/* RCSB Fetch */}
                        <div className="form-group">
                            <label className="form-label">Or Fetch from RCSB</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g., 2GB1"
                                    value={pdbId}
                                    onChange={(e) => setPdbId(e.target.value)}
                                />
                                <button className="btn btn-secondary" onClick={fetchFromRcsb}>Fetch</button>
                            </div>
                        </div>

                        {/* Sample */}
                        <div className="form-group">
                            <button className="btn btn-secondary" onClick={loadSample} style={{ width: '100%' }}>
                                Load Sample Protein
                            </button>
                        </div>

                        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

                        {/* Ligand Upload */}
                        <div className="form-group">
                            <label className="form-label">🎯 Upload Target Ligand (Optional)</label>
                            <label className="file-upload" style={{ padding: '12px' }}>
                                <input
                                    type="file"
                                    accept=".pdbqt"
                                    onChange={handleLigandUpload}
                                    style={{ display: 'none' }}
                                />
                                <div className="file-upload-icon">💊</div>
                                <div className="file-upload-text" style={{ fontSize: '11px' }}>
                                    Upload .pdbqt ligand
                                    <br />
                                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                        (default: glucose)
                                    </span>
                                </div>
                            </label>
                        </div>

                        {/* SMILES Input */}
                        <div className="form-group" style={{ marginTop: '8px' }}>
                            <label className="form-label">Or use SMILES string</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g., CC(=O)O... (Aspirin)"
                                    value={smiles}
                                    onChange={(e) => setSmiles(e.target.value)}
                                    style={{ fontSize: '11px' }}
                                />
                                <button className="btn btn-secondary" onClick={handleSmilesSubmit} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    Generate 3D
                                </button>
                            </div>
                        </div>

                        {/* Sequence Display */}
                        {sequence && (
                            <div className="form-group">
                                <label className="form-label">Sequence ({sequence.length} aa)</label>
                                <div className="sequence-display">{sequence}</div>
                            </div>
                        )}

                        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

                        {/* Evolution Config */}
                        <div className="form-group">
                            <label className="form-label">Variants per Generation</label>
                            <input
                                type="number"
                                className="form-input"
                                value={config.numVariants}
                                onChange={(e) => setConfig({ ...config, numVariants: parseInt(e.target.value) || 5 })}
                                min={1}
                                max={20}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Max Generations</label>
                            <input
                                type="number"
                                className="form-input"
                                value={config.maxGenerations}
                                onChange={(e) => setConfig({ ...config, maxGenerations: parseInt(e.target.value) || 5 })}
                                min={1}
                                max={50}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Temperature (Mutation Rate): {config.temperature.toFixed(2)}</label>
                            <input
                                type="range"
                                className="form-input"
                                value={config.temperature}
                                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                                min={0.05}
                                max={0.5}
                                step={0.05}
                                style={{ padding: 0 }}
                            />
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                            {!evolutionState.isRunning ? (
                                <button className="btn btn-primary" onClick={startEvolution} disabled={!pdbData} style={{ flex: 1 }}>
                                    ▶ Start Evolution
                                </button>
                            ) : (
                                <button className="btn btn-danger" onClick={stopEvolution} style={{ flex: 1 }}>
                                    ⏹ Stop
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={clearAll}>Clear</button>
                        </div>
                    </div>
                </aside>

                {/* Evolution Panel */}
                <section className="panel evolution-panel">
                    <div className="panel-header">
                        <span className="panel-title">🔄 Evolution Progress</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            Generation {evolutionState.currentGeneration}
                        </span>
                    </div>
                    <div className="panel-content">
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-value">{evolutionState.currentGeneration}</div>
                                <div className="stat-label">Generation</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{stats.totalDesigns}</div>
                                <div className="stat-label">Total Designs</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{stats.bestAffinity ? stats.bestAffinity.toFixed(1) : '-'}</div>
                                <div className="stat-label">Best Affinity</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{(stats.passRate * 100).toFixed(0)}%</div>
                                <div className="stat-label">Pass Rate</div>
                            </div>
                        </div>

                        <div style={{ marginTop: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    {getStepLabel(evolutionState.currentStep)}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    {evolutionState.progress.toFixed(0)}%
                                </span>
                            </div>
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${evolutionState.progress}%` }} />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Viewer Panel */}
                <section className="panel viewer-panel">
                    <div className="panel-header">
                        <span className="panel-title">🔬 Structure Viewer</span>
                        {selectedDesign && (
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {selectedDesign.id.slice(0, 15)}...
                            </span>
                        )}
                    </div>
                    <div className="panel-content">
                        <div className="viewer-container" ref={viewerContainerRef}>
                            {!pdbData && !selectedDesign && (
                                <div className="empty-state" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                    <div className="empty-state-icon">🧪</div>
                                    <div className="empty-state-text">Load a protein to view</div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Results Panel */}
                <aside className="panel results-panel">
                    <div className="panel-header">
                        <span className="panel-title">📊 Results ({designs.length})</span>
                    </div>
                    <div className="panel-content" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        {designs.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">📋</div>
                                <div className="empty-state-text">No designs yet</div>
                            </div>
                        ) : (
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th>Gen</th>
                                        <th>Affinity</th>
                                        <th>Stability</th>
                                        <th>Mutations</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {designs.slice().reverse().slice(0, 50).map(design => (
                                        <tr
                                            key={design.id}
                                            onClick={() => setSelectedDesign(design)}
                                            style={{ cursor: 'pointer', background: selectedDesign?.id === design.id ? 'var(--bg-hover)' : undefined }}
                                        >
                                            <td>{design.generation}</td>
                                            <td className={getAffinityClass(design.scores.affinity)}>
                                                {design.scores.affinity.toFixed(1)}
                                            </td>
                                            <td className={getStabilityClass(design.scores.stability)}>
                                                {design.scores.stability > 0 ? '+' : ''}{design.scores.stability.toFixed(2)}
                                            </td>
                                            <td>{design.mutations.length}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Selected Design Details */}
                    {selectedDesign && (
                        <div className="panel-content" style={{ borderTop: '1px solid var(--border-color)' }}>
                            <div className="form-label">Selected Design</div>
                            <div style={{ fontSize: '12px', marginBottom: '8px', color: 'var(--text-muted)' }}>
                                Generation {selectedDesign.generation} • {selectedDesign.mutations.length} mutations
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                                <span className={getAffinityClass(selectedDesign.scores.affinity)} style={{ marginRight: '16px' }}>
                                    Affinity: {formatAffinity(selectedDesign.scores.affinity)}
                                </span>
                                <span className={getStabilityClass(selectedDesign.scores.stability)}>
                                    ΔG: {formatStability(selectedDesign.scores.stability)}
                                </span>
                            </div>
                            <div>
                                <div className="stat-label">Mutations</div>
                                <div className="stat-value" style={{ fontSize: '12px', wordBreak: 'break-all' }}>
                                    {selectedDesign.mutations.join(', ') || 'None (Parent)'}
                                </div>
                            </div>

                            <div style={{ marginTop: '15px' }}>
                                <button className="btn btn-primary" onClick={() => {
                                    const blob = new Blob([selectedDesign.pdbData || ''], { type: 'text/plain' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `evolved_${selectedDesign.id}.pdb`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                }} style={{ width: '100%', fontSize: '12px' }}>
                                    ⬇️ Download PDB
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Log */}
                    <div className="panel-content" style={{ borderTop: '1px solid var(--border-color)' }}>
                        <div className="form-label">Activity Log</div>
                        <div className="log-container">
                            {logs.slice(-20).map((log, i) => (
                                <div key={i} className="log-entry">
                                    <span className="log-time">{log.time}</span>
                                    <span className={`log-${log.level}`}>{log.message}</span>
                                </div>
                            ))}
                            {logs.length === 0 && (
                                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    No activity yet
                                </div>
                            )}
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    );
}

export default App;
