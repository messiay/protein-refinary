import React, { useEffect, useState, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, Dna, Play, Square, Box, BarChart2 } from 'lucide-react';
import { StructureViewer } from './StructureViewer';
import { ParetoChart } from './ParetoChart';

interface Candidate {
  id: string;
  binding_affinity: number;
  stability_score: number;
  generation: number;
  sequence: string;
  novelty_status: string;
}

interface LogEntry {
  message: string;
  type: string;
  timestamp: string;
}

const API_URL = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

function App() {
  const [stats, setStats] = useState({ bestAffinity: 0, currentGeneration: 0 });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // For Chart
  const [history, setHistory] = useState<{ gen: number, affinity: number }[]>([]);
  const [paretoData, setParetoData] = useState<{ affinity: number, stability: number }[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchInitialData();
    connectWebSocket();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const statsRes = await fetch(`${API_URL}/stats`);
      const statsData = await statsRes.json();
      setStats(statsData);

      const candRes = await fetch(`${API_URL}/candidates`);
      const candData = await candRes.json();
      setCandidates(candData);
    } catch (err) {
      console.error("Failed to fetch initial data", err);
    }
  };

  const connectWebSocket = () => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const { type, data } = payload;

      if (type === 'log') {
        addLog(data, 'info');
      } else if (type === 'new_candidate') {
        const newCand = data as Candidate;
        setCandidates(prev => [newCand, ...prev].slice(0, 50));
      } else if (type === 'evolution_leap') {
        const best = data;
        setStats(prev => ({ ...prev, bestAffinity: best.affinity }));
        addLog(`>>> EVOLUTIONARY LEAP: New Best ${best.affinity} <<<`, 'success');
        setHistory(prev => [...prev, { gen: stats.currentGeneration + 1, affinity: best.affinity }]);
      } else if (type === 'pareto_update') {
        setParetoData(data);
      } else if (type === 'status') {
        addLog(`[STATUS] ${data}`, 'info');
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
  };

  const addLog = (msg: string, type: 'info' | 'success') => {
    setLogs(prev => [{ message: msg, type, timestamp: new Date().toLocaleTimeString() }, ...prev].slice(0, 100));
  };

  const handleStart = async () => {
    await fetch(`${API_URL}/start`, { method: 'POST' });
    setIsRunning(true);
  };

  const handleStop = async () => {
    await fetch(`${API_URL}/stop`, { method: 'POST' });
    setIsRunning(false);
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Protein Refinery</h1>
          <div style={{ color: 'var(--text-muted)' }}>Autonomous Evolutionary Architect</div>
        </div>
        <div>
          {!isRunning ? (
            <button className="btn" onClick={handleStart}><Play size={16} style={{ marginRight: 8 }} /> Start Evolution</button>
          ) : (
            <button className="btn btn-danger" onClick={handleStop}><Square size={16} style={{ marginRight: 8 }} /> Stop</button>
          )}
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid-cols-3">
        <div className="glass-panel stat-card">
          <div className="stat-label"><Dna size={16} /> Best Affinity</div>
          <div className="stat-value">{stats.bestAffinity.toFixed(2)} <span style={{ fontSize: '1rem' }}>kcal/mol</span></div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-label"><Activity size={16} /> Generation</div>
          <div className="stat-value">{stats.currentGeneration}</div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-label"><Zap size={16} /> Candidates Banked</div>
          <div className="stat-value">{candidates.length}</div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid-cols-2">

        {/* Left Column: Structure & Chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div className="glass-panel" style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center' }}><Box size={16} style={{ marginRight: 8 }} /> Live Structure</h3>
            {/* Pass a dummy ID or the best candidate ID. Since we mock the PDB, any ID works */}
            <div style={{ flex: 1, position: 'relative' }}>
              <StructureViewer pdbId={candidates[0]?.id || 'init'} />
            </div>
          </div>

          <div className="glass-panel" style={{ height: '300px' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Evolutionary Trajectory</h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="gen" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }} />
                <Line type="monotone" dataKey="affinity" stroke="#00f0ff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Candidates & Logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel">
            <h3 style={{ margin: '0 0 1rem 0' }}>Live Candidates</h3>
            <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Affinity</th>
                    <th>Stability</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'monospace' }}>{c.id.split('-')[1]}...</td>
                      <td style={{ color: c.binding_affinity < -6 ? 'var(--success)' : 'inherit' }}>
                        {c.binding_affinity.toFixed(2)}
                      </td>
                      <td>{c.stability_score.toFixed(2)}</td>
                      <td>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: c.novelty_status === 'NOVEL' ? 'rgba(0, 255, 157, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          color: c.novelty_status === 'NOVEL' ? 'var(--success)' : 'var(--text-muted)',
                          fontSize: '0.8rem'
                        }}>
                          {c.novelty_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-panel" style={{ height: '300px' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center' }}><BarChart2 size={16} style={{ marginRight: 8 }} /> Pareto Landscape</h3>
            <ParetoChart data={paretoData} />
          </div>

          <div className="glass-panel">
            <h3 style={{ margin: '0 0 1rem 0' }}>System Logs</h3>
            <div className="log-viewer" style={{ height: '200px' }}>
              {logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.message.includes('LEAP') ? 'highlight' : ''}`}>
                  <span style={{ opacity: 0.5, marginRight: 10 }}>[{log.timestamp}]</span>
                  {log.message}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
