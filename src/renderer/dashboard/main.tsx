import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { HiveStats, HiveUser, HiveRoom, HiveConfig } from '@shared/types';

// ── Type augmentation ────────────────────────────────────────────────────────

declare global {
  interface Window {
    hiveApi: {
      getStats: () => Promise<HiveStats>;
      getUsers: () => Promise<HiveUser[]>;
      getRooms: () => Promise<HiveRoom[]>;
      getConfig: () => Promise<HiveConfig>;
      setConfig: (cfg: HiveConfig) => Promise<void>;
      start: () => Promise<void>;
      stop: () => Promise<void>;
      onStatus: (cb: (running: boolean) => void) => () => void;
    };
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const css = `
  :root {
    --bg: #1a1a2e;
    --surface: #16213e;
    --accent: #0f3460;
    --green: #4caf50;
    --red: #f44336;
    --text: #e0e0e0;
    --muted: #888;
    --border: #2a2a4e;
  }
  body { background: var(--bg); color: var(--text); }
  .dashboard { display: flex; flex-direction: column; height: 100vh; }
  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; letter-spacing: 1px; color: #e040fb; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; }
  .status-dot.online { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .status-dot.offline { background: var(--red); }
  .header-actions { margin-left: auto; display: flex; gap: 8px; }
  .btn { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
  .btn-start { background: var(--green); color: #fff; }
  .btn-stop { background: var(--red); color: #fff; }
  .btn-settings { background: var(--accent); color: #fff; }
  .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); border-bottom: 1px solid var(--border); }
  .stat { background: var(--surface); padding: 12px 16px; }
  .stat-value { font-size: 22px; font-weight: 700; color: #e040fb; }
  .stat-label { font-size: 11px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  .content { display: grid; grid-template-columns: 1fr 1fr; gap: 0; flex: 1; overflow: hidden; }
  .panel { padding: 16px; overflow-y: auto; border-right: 1px solid var(--border); }
  .panel h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 12px; }
  .user-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; margin-bottom: 4px; background: var(--surface); }
  .user-row .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .user-name { font-size: 13px; font-weight: 500; }
  .user-id { font-size: 10px; color: var(--muted); margin-left: auto; font-family: monospace; }
  .room-row { padding: 8px 10px; border-radius: 6px; margin-bottom: 4px; background: var(--surface); }
  .room-name { font-size: 13px; font-weight: 500; }
  .room-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .empty { color: var(--muted); font-size: 12px; padding: 8px 0; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 24px; width: 380px; }
  .modal h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .field input { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 13px; outline: none; }
  .field input:focus { border-color: #e040fb; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .btn-cancel { background: var(--accent); color: #fff; }
  .btn-save { background: #e040fb; color: #fff; }
`;

function statusColor(status: string): string {
  switch (status) {
    case 'online': return '#4caf50';
    case 'away': case 'idle': return '#ff9800';
    case 'invisible': return '#9e9e9e';
    default: return '#555';
  }
}

// ── Components ────────────────────────────────────────────────────────────────

function SettingsModal({ config, onSave, onClose }: {
  config: HiveConfig;
  onSave: (cfg: HiveConfig) => void;
  onClose: () => void;
}) {
  const [port, setPort] = useState(String(config.port));
  const [certPath, setCertPath] = useState(config.certPath);
  const [keyPath, setKeyPath] = useState(config.keyPath);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Server Settings</h2>
        <div className="field">
          <label>Port</label>
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="7700" />
        </div>
        <div className="field">
          <label>TLS Cert Path (leave blank for auto-generated)</label>
          <input value={certPath} onChange={(e) => setCertPath(e.target.value)} placeholder="/path/to/cert.pem" />
        </div>
        <div className="field">
          <label>TLS Key Path (leave blank for auto-generated)</label>
          <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="/path/to/key.pem" />
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-save" onClick={() => {
            onSave({ port: parseInt(port, 10) || 7700, certPath, keyPath });
            onClose();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<HiveStats | null>(null);
  const [users, setUsers] = useState<HiveUser[]>([]);
  const [rooms, setRooms] = useState<HiveRoom[]>([]);
  const [config, setConfig] = useState<HiveConfig>({ port: 7700, certPath: '', keyPath: '' });
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    const [s, u, r, c] = await Promise.all([
      window.hiveApi.getStats(),
      window.hiveApi.getUsers(),
      window.hiveApi.getRooms(),
      window.hiveApi.getConfig(),
    ]);
    setStats(s);
    setUsers(u);
    setRooms(r);
    setConfig(c);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    const unsub = window.hiveApi.onStatus((running) => {
      setStats((prev) => prev ? { ...prev, running } : null);
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [refresh]);

  async function handleStart() {
    await window.hiveApi.start();
    await refresh();
  }
  async function handleStop() {
    await window.hiveApi.stop();
    await refresh();
  }
  async function handleSaveConfig(cfg: HiveConfig) {
    await window.hiveApi.setConfig(cfg);
    setConfig(cfg);
  }

  const running = stats?.running ?? false;

  return (
    <div className="dashboard">
      <style>{css}</style>
      <header className="header">
        <h1>🐝 HIVE</h1>
        <span className={`status-dot ${running ? 'online' : 'offline'}`} />
        <span style={{ fontSize: 12, color: running ? '#4caf50' : '#f44336' }}>
          {running ? `Running on :${stats?.port ?? config.port}` : 'Stopped'}
        </span>
        <div className="header-actions">
          {running
            ? <button className="btn btn-stop" onClick={handleStop}>Stop</button>
            : <button className="btn btn-start" onClick={handleStart}>Start</button>
          }
          <button className="btn btn-settings" onClick={() => setShowSettings(true)}>⚙ Settings</button>
        </div>
      </header>

      <div className="stats-bar">
        <div className="stat">
          <div className="stat-value">{stats?.connectedUsers ?? 0}</div>
          <div className="stat-label">Connected</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats?.totalUsers ?? 0}</div>
          <div className="stat-label">Total Users</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats?.totalRooms ?? 0}</div>
          <div className="stat-label">Rooms</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats?.totalMessages ?? 0}</div>
          <div className="stat-label">Messages</div>
        </div>
      </div>

      <div className="content">
        <div className="panel">
          <h2>Users ({users.length})</h2>
          {users.length === 0 && <div className="empty">No users registered yet.</div>}
          {users.map((u) => (
            <div className="user-row" key={u.peerId}>
              <span className="dot" style={{ background: u.connected ? statusColor(u.status) : '#555' }} />
              <span className="user-name">{u.screenName}</span>
              <span className="user-id">{u.peerId.slice(0, 16)}…</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Rooms ({rooms.length})</h2>
          {rooms.length === 0 && <div className="empty">No rooms created yet.</div>}
          {rooms.map((r) => (
            <div className="room-row" key={r.id}>
              <div className="room-name">{r.name}</div>
              <div className="room-meta">{r.memberCount} members · {r.messageCount} messages</div>
            </div>
          ))}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={config}
          onSave={handleSaveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!;
createRoot(root).render(<Dashboard />);
