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

// ── AIM 5.x-style CSS ────────────────────────────────────────────────────────

const css = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --font-ui: "Lucida Grande", Tahoma, "MS Sans Serif", sans-serif;
    --c-bg: #ece9d8;
    --c-panel: #f5f4ea;
    --c-bevel-light: #ffffff;
    --c-bevel-dark: #7a7a7a;
    --c-bevel-darker: #404040;
    --c-title: #0a246a;
    --c-title-text: #ffffff;
    --c-yellow: #ffd44f;
    --c-input-bg: #ffffff;
    --c-text: #000000;
    --c-muted: #666666;
    --c-group-bg: #d6d3c1;
    --c-row-hover: #e8eef8;
    --c-selected: #316ac5;
    --c-border: #c0bfb1;
    --c-green: #2cc14a;
    --c-away: #f4b400;
    --c-offline: #888888;
  }
  html, body, #root {
    margin: 0; padding: 0; height: 100%;
    background: var(--c-bg);
    color: var(--c-text);
    font-family: var(--font-ui);
    font-size: 12px;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  .window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    border: 2px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
  }
  /* ── Title bar ── */
  .titlebar {
    background: linear-gradient(to bottom, #1a3da9 0%, #0a246a 100%);
    color: var(--c-title-text);
    padding: 3px 4px 3px 6px;
    font-weight: bold;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  .titlebar .runner {
    width: 14px; height: 14px;
    background: var(--c-yellow);
    border: 1px solid #000;
    border-radius: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    flex-shrink: 0;
  }
  .titlebar .title { flex: 1; }
  .titlebar .tb-actions {
    display: flex; gap: 4px; align-items: center;
    -webkit-app-region: no-drag;
  }
  .tb-btn {
    padding: 1px 8px; height: 18px;
    font-family: var(--font-ui); font-size: 11px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    cursor: pointer;
    color: var(--c-text);
    -webkit-app-region: no-drag;
  }
  .tb-btn:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .tb-btn.danger { color: #990000; }
  /* ── Status bar ── */
  .statusbar {
    background: var(--c-panel);
    border-top: 1px solid var(--c-border);
    padding: 3px 8px;
    font-size: 11px;
    color: var(--c-muted);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .statusbar .dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  }
  .statusbar .dot.online { background: var(--c-green); }
  .statusbar .dot.offline { background: var(--c-offline); }
  /* ── Toolbar strip below titlebar ── */
  .toolbar {
    background: var(--c-panel);
    border-bottom: 1px solid var(--c-border);
    padding: 3px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 11px;
  }
  .toolbar button {
    font-family: var(--font-ui); font-size: 11px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    padding: 2px 10px;
    cursor: pointer;
  }
  .toolbar button:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .toolbar .sep { width: 1px; height: 16px; background: var(--c-border); margin: 0 2px; }
  /* ── Scrollable body ── */
  .body { flex: 1; overflow-y: auto; background: var(--c-input-bg); }
  /* ── Group headers ── */
  .group-header {
    background: var(--c-group-bg);
    padding: 2px 6px 2px 4px;
    font-weight: bold;
    font-size: 11px;
    border-bottom: 1px solid #aaa;
    border-top: 1px solid var(--c-bevel-light);
    cursor: default;
    display: flex;
    align-items: center;
    gap: 4px;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group-header .chevron { font-size: 9px; color: #555; }
  .group-header .count { font-weight: normal; color: var(--c-muted); font-size: 10px; }
  /* ── User rows ── */
  .user-row {
    padding: 2px 8px 2px 18px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: default;
    font-size: 12px;
  }
  .user-row:hover { background: var(--c-row-hover); }
  .user-row .status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .user-row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .user-row .tag {
    font-size: 10px; color: var(--c-muted);
    font-style: italic;
  }
  /* ── Room rows ── */
  .room-row {
    padding: 3px 8px 3px 18px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: default;
    font-size: 12px;
  }
  .room-row:hover { background: var(--c-row-hover); }
  .room-row .room-icon { font-size: 11px; flex-shrink: 0; }
  .room-row .room-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .room-row .room-channels {
    font-size: 10px; color: var(--c-muted);
    white-space: nowrap;
  }
  .room-row .room-members {
    font-size: 10px; color: var(--c-muted);
    margin-left: 4px;
    white-space: nowrap;
  }
  /* ── Settings modal ── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--c-bg);
    border: 2px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    width: 340px;
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .modal-title {
    background: linear-gradient(to bottom, #1a3da9 0%, #0a246a 100%);
    color: #fff;
    font-weight: bold;
    font-size: 11px;
    padding: 3px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .modal-body { padding: 12px 14px; }
  .field { margin-bottom: 10px; }
  .field label { display: block; margin-bottom: 3px; }
  .field input {
    width: 100%;
    border: 2px solid;
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
    padding: 3px 5px;
    background: var(--c-input-bg);
    font-family: var(--font-ui);
    font-size: 12px;
    outline: none;
  }
  .modal-footer {
    padding: 6px 10px;
    background: var(--c-panel);
    border-top: 1px solid var(--c-border);
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .modal-footer button {
    font-family: var(--font-ui); font-size: 12px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    padding: 3px 16px;
    cursor: pointer;
    min-width: 64px;
  }
  .modal-footer button:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .empty-row {
    padding: 3px 18px;
    color: var(--c-muted);
    font-style: italic;
    font-size: 11px;
  }
`;

function statusDotColor(status: string, connected: boolean): string {
  if (!connected) return 'var(--c-offline)';
  switch (status) {
    case 'online': return 'var(--c-green)';
    case 'away': case 'idle': return 'var(--c-away)';
    case 'invisible': return '#aaaaaa';
    default: return 'var(--c-offline)';
  }
}

// ── Settings Modal ────────────────────────────────────────────────────────────

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
        <div className="modal-title">
          <span style={{ background: '#ffd44f', width: 12, height: 12, display: 'inline-block', border: '1px solid #000', borderRadius: 2, fontSize: 8, textAlign: 'center', lineHeight: '12px' }}>🐝</span>
          Hive — Server Settings
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Listen Port</label>
            <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="7700" />
          </div>
          <div className="field">
            <label>TLS Certificate Path <span style={{ color: 'var(--c-muted)', fontWeight: 'normal' }}>(blank = auto-generated)</span></label>
            <input value={certPath} onChange={(e) => setCertPath(e.target.value)} placeholder="/path/to/cert.pem" />
          </div>
          <div className="field">
            <label>TLS Key Path <span style={{ color: 'var(--c-muted)', fontWeight: 'normal' }}>(blank = auto-generated)</span></label>
            <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="/path/to/key.pem" />
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => { onSave({ port: parseInt(port, 10) || 7700, certPath, keyPath }); onClose(); }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

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
    return () => { clearInterval(interval); unsub(); };
  }, [refresh]);

  async function handleStart() { await window.hiveApi.start(); await refresh(); }
  async function handleStop() { await window.hiveApi.stop(); await refresh(); }
  async function handleSaveConfig(cfg: HiveConfig) {
    await window.hiveApi.setConfig(cfg);
    setConfig(cfg);
  }

  const running = stats?.running ?? false;
  const connectedUsers = users.filter((u) => u.connected);
  const offlineUsers = users.filter((u) => !u.connected);
  const port = stats?.port ?? config.port;

  return (
    <div className="window">
      <style>{css}</style>

      {/* Title bar */}
      <div className="titlebar">
        <span className="runner">🐝</span>
        <span className="title">Hive</span>
        <div className="tb-actions">
          {running
            ? <button className="tb-btn danger" onClick={handleStop}>Stop Server</button>
            : <button className="tb-btn" onClick={handleStart}>Start Server</button>
          }
          <button className="tb-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="body">

        {/* ── Online clients ── */}
        <div className="group-header">
          <span className="chevron">▼</span>
          Online
          <span className="count">({connectedUsers.length}/{users.length})</span>
        </div>
        {connectedUsers.length === 0 && (
          <div className="empty-row">No clients connected</div>
        )}
        {connectedUsers.map((u) => (
          <div className="user-row" key={u.peerId}>
            <span className="status-dot" style={{ background: statusDotColor(u.status, true) }} />
            <span className="name">{u.screenName}</span>
            {u.status !== 'online' && <span className="tag">{u.status}</span>}
          </div>
        ))}

        {/* ── Offline clients (collapsed-style) ── */}
        {offlineUsers.length > 0 && (
          <>
            <div className="group-header">
              <span className="chevron">▶</span>
              Offline
              <span className="count">({offlineUsers.length})</span>
            </div>
            {offlineUsers.map((u) => (
              <div className="user-row" key={u.peerId} style={{ color: 'var(--c-muted)' }}>
                <span className="status-dot" style={{ background: 'var(--c-offline)' }} />
                <span className="name">{u.screenName}</span>
              </div>
            ))}
          </>
        )}

        {/* ── Chat Rooms ── */}
        <div className="group-header">
          <span className="chevron">▼</span>
          Chat Rooms
          <span className="count">({rooms.length})</span>
        </div>
        {rooms.length === 0 && (
          <div className="empty-row">No rooms created yet</div>
        )}
        {rooms.map((r) => {
          const chParts: string[] = [];
          if (r.textChannels > 0) chParts.push(`${r.textChannels} text`);
          if (r.voiceChannels > 0) chParts.push(`${r.voiceChannels} voice`);
          const chLabel = chParts.length > 0 ? chParts.join(', ') : 'no channels';
          return (
            <div className="room-row" key={r.id}>
              <span className="room-icon">💬</span>
              <span className="room-name">{r.name}</span>
              <span className="room-channels">{chLabel}</span>
              <span className="room-members">· {r.memberCount} member{r.memberCount !== 1 ? 's' : ''}</span>
            </div>
          );
        })}

      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span className={`dot ${running ? 'online' : 'offline'}`} />
        {running
          ? <>Server running on :{port} &nbsp;·&nbsp; {connectedUsers.length} connected &nbsp;·&nbsp; {rooms.length} room{rooms.length !== 1 ? 's' : ''}</>
          : 'Server stopped'
        }
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
