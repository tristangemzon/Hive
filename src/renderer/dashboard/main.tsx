import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { HiveStats, HiveUser, HiveRoom, HiveConfig, HiveBannedUser } from '@shared/types';

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
      kickUser: (peerId: string) => Promise<void>;
      banUser: (peerId: string, reason?: string) => Promise<void>;
      unbanUser: (peerId: string) => Promise<void>;
      deleteUser: (peerId: string) => Promise<void>;
      announce: (text: string) => Promise<void>;
      getBanned: () => Promise<HiveBannedUser[]>;
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
    --c-danger: #cc0000;
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
  /* ── Tab bar ── */
  .tabbar {
    background: var(--c-panel);
    border-bottom: 2px solid var(--c-bevel-darker);
    padding: 3px 6px 0;
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .tab-btn {
    font-family: var(--font-ui); font-size: 11px;
    background: var(--c-bg);
    border: 1px solid var(--c-bevel-dark);
    border-bottom: none;
    padding: 2px 12px 3px;
    cursor: pointer;
    color: var(--c-text);
    position: relative;
    bottom: -1px;
  }
  .tab-btn.active {
    background: var(--c-input-bg);
    border-color: var(--c-bevel-darker);
    border-bottom: 2px solid var(--c-input-bg);
    font-weight: bold;
    z-index: 1;
  }
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
    position: relative;
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
  .user-row .lastseen {
    font-size: 10px; color: var(--c-muted);
    white-space: nowrap;
  }
  /* ── Action buttons on rows ── */
  .row-actions {
    display: none;
    gap: 3px;
    align-items: center;
    flex-shrink: 0;
  }
  .user-row:hover .row-actions { display: flex; }
  .room-row:hover .row-actions { display: flex; }
  .action-btn {
    font-family: var(--font-ui); font-size: 10px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    padding: 1px 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .action-btn:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .action-btn.danger { color: var(--c-danger); }
  .action-btn.confirm { background: #fff0f0; color: var(--c-danger); font-weight: bold; }
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
  .room-row .room-meta {
    font-size: 10px; color: var(--c-muted);
    white-space: nowrap;
  }
  /* ── Stats tab ── */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 12px 14px;
  }
  .stat-card {
    background: var(--c-panel);
    border: 1px solid var(--c-border);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat-card .stat-value {
    font-size: 20px;
    font-weight: bold;
    color: var(--c-title);
    line-height: 1.1;
  }
  .stat-card .stat-label {
    font-size: 10px;
    color: var(--c-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat-card.warn .stat-value { color: #b05a00; }
  .stat-card.danger .stat-value { color: var(--c-danger); }
  /* ── Announce panel ── */
  .announce-panel {
    padding: 10px 14px;
    border-top: 1px solid var(--c-border);
  }
  .announce-panel .section-title {
    font-weight: bold; font-size: 11px;
    margin-bottom: 6px;
    color: var(--c-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .announce-panel textarea {
    width: 100%;
    height: 52px;
    resize: vertical;
    border: 2px solid;
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
    padding: 4px 6px;
    font-family: var(--font-ui);
    font-size: 12px;
    background: var(--c-input-bg);
    outline: none;
    display: block;
    margin-bottom: 5px;
    user-select: text;
  }
  .announce-panel .btn-row {
    display: flex; justify-content: flex-end; gap: 6px; align-items: center;
  }
  .announce-panel .sent-note {
    font-size: 11px; color: #1a7a1a;
  }
  /* ── Broadcast button ── */
  .btn {
    font-family: var(--font-ui); font-size: 12px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    padding: 3px 16px;
    cursor: pointer;
    min-width: 64px;
  }
  .btn:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .btn:disabled { color: var(--c-muted); cursor: default; }
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
    width: 360px;
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
  .field input[type=text], .field input[type=number], .field textarea {
    width: 100%;
    border: 2px solid;
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
    padding: 3px 5px;
    background: var(--c-input-bg);
    font-family: var(--font-ui);
    font-size: 12px;
    outline: none;
    user-select: text;
  }
  .field textarea { resize: vertical; height: 52px; }
  .field.checkbox-field {
    display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
  }
  .field.checkbox-field label { margin-bottom: 0; }
  .modal-section-title {
    font-weight: bold; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--c-muted);
    margin: 10px 0 6px;
    border-bottom: 1px solid var(--c-border);
    padding-bottom: 3px;
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
  /* ── Connect URL strip ── */
  .url-strip {
    background: var(--c-panel);
    border-bottom: 1px solid var(--c-border);
    padding: 3px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 11px;
  }
  .url-strip label { color: var(--c-muted); white-space: nowrap; }
  .url-strip .url-box {
    flex: 1;
    border: 2px solid;
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
    background: var(--c-input-bg);
    padding: 1px 5px;
    font-family: monospace;
    font-size: 11px;
    color: var(--c-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
  .url-strip .copy-btn {
    font-family: var(--font-ui); font-size: 11px;
    background: var(--c-panel);
    border: 1px solid;
    border-color: var(--c-bevel-light) var(--c-bevel-darker) var(--c-bevel-darker) var(--c-bevel-light);
    padding: 1px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .url-strip .copy-btn:active {
    border-color: var(--c-bevel-darker) var(--c-bevel-light) var(--c-bevel-light) var(--c-bevel-darker);
  }
  .url-strip .copy-btn.copied { color: #1a7a1a; }
  /* ── Banned row ── */
  .banned-row {
    padding: 2px 8px 2px 18px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: default;
    font-size: 12px;
    color: var(--c-danger);
  }
  .banned-row:hover { background: var(--c-row-hover); }
  .banned-row .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .banned-row .ban-meta { font-size: 10px; color: var(--c-muted); white-space: nowrap; }
`;


// ── Helpers ──────────────────────────────────────────────────────────────────

function statusDotColor(status: string, connected: boolean): string {
  if (!connected) return 'var(--c-offline)';
  switch (status) {
    case 'online': return 'var(--c-green)';
    case 'away': case 'idle': return 'var(--c-away)';
    default: return 'var(--c-offline)';
  }
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Settings modal ────────────────────────────────────────────────────────────

interface SettingsModalProps {
  config: HiveConfig;
  onSave: (cfg: HiveConfig) => void;
  onClose: () => void;
}

function SettingsModal({ config, onSave, onClose }: SettingsModalProps) {
  const [port, setPort] = React.useState(String(config.port ?? 7443));
  const [certPath, setCertPath] = React.useState(config.certPath ?? '');
  const [keyPath, setKeyPath] = React.useState(config.keyPath ?? '');
  const [motd, setMotd] = React.useState(config.motd ?? '');
  const [registrationOpen, setRegistrationOpen] = React.useState(config.registrationOpen !== false);

  function handleSave() {
    onSave({
      ...config,
      port: parseInt(port, 10) || 7443,
      certPath,
      keyPath,
      motd,
      registrationOpen,
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <span className="runner">H</span>
          Hive Server Settings
        </div>
        <div className="modal-body">
          <div className="modal-section-title">Network</div>
          <div className="field">
            <label>Port</label>
            <input type="number" value={port} onChange={e => setPort(e.target.value)} />
          </div>
          <div className="field">
            <label>TLS Certificate Path</label>
            <input type="text" value={certPath} onChange={e => setCertPath(e.target.value)} placeholder="/path/to/cert.pem" />
          </div>
          <div className="field">
            <label>TLS Key Path</label>
            <input type="text" value={keyPath} onChange={e => setKeyPath(e.target.value)} placeholder="/path/to/key.pem" />
          </div>
          <div className="modal-section-title">Server</div>
          <div className="field">
            <label>Message of the Day (shown to users on sign-in)</label>
            <textarea value={motd} onChange={e => setMotd(e.target.value)} placeholder="Welcome to the server!" />
          </div>
          <div className="field checkbox-field">
            <input
              id="reg-open"
              type="checkbox"
              checked={registrationOpen}
              onChange={e => setRegistrationOpen(e.target.checked)}
            />
            <label htmlFor="reg-open">Allow new user registration</label>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

function Dashboard() {
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<HiveStats | null>(null);
  const [users, setUsers] = useState<HiveUser[]>([]);
  const [rooms, setRooms] = useState<HiveRoom[]>([]);
  const [config, setConfig] = useState<HiveConfig>({ port: 7443, certPath: '', keyPath: '' });
  const [banned, setBanned] = useState<HiveBannedUser[]>([]);
  const [tab, setTab] = useState<'users' | 'rooms' | 'server'>('users');
  const [showSettings, setShowSettings] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [announceSent, setAnnounceSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<Record<string, string>>({});
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, u, r, b] = await Promise.all([
        window.hiveApi.getStats(),
        window.hiveApi.getUsers(),
        window.hiveApi.getRooms(),
        window.hiveApi.getBanned(),
      ]);
      setStats(s);
      setRunning(s.running);
      setUsers(u);
      setRooms(r);
      setBanned(b);
    } catch {}
  }, []);

  useEffect(() => {
    const unsub = window.hiveApi.onStatus(r => setRunning(r));
    window.hiveApi.getConfig().then(setConfig).catch(() => {});
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { clearInterval(t); unsub(); };
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
    setConfig(cfg);
    await window.hiveApi.setConfig(cfg);
    setShowSettings(false);
  }

  async function handleKick(peerId: string) {
    await window.hiveApi.kickUser(peerId);
    clearConfirm(peerId);
    await refresh();
  }
  async function handleBan(peerId: string) {
    await window.hiveApi.banUser(peerId);
    clearConfirm(peerId);
    await refresh();
  }
  async function handleUnban(peerId: string) {
    await window.hiveApi.unbanUser(peerId);
    await refresh();
  }
  async function handleDelete(peerId: string) {
    await window.hiveApi.deleteUser(peerId);
    clearConfirm(peerId);
    await refresh();
  }
  async function handleAnnounce() {
    if (!announceText.trim()) return;
    await window.hiveApi.announce(announceText.trim());
    setAnnounceText('');
    setAnnounceSent(true);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounceSent(false), 3000);
  }

  function setConfirmFor(peerId: string, action: string) {
    setConfirmAction(prev => ({ ...prev, [peerId]: action }));
    setTimeout(() => clearConfirm(peerId), 3000);
  }
  function clearConfirm(peerId: string) {
    setConfirmAction(prev => { const n = { ...prev }; delete n[peerId]; return n; });
  }

  function copyUrl() {
    const url = `wss://localhost:${config.port}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const onlineUsers = users.filter(u => u.connected);
  const offlineUsers = users.filter(u => !u.connected && !u.banned);
  const serverUrl = `wss://localhost:${config.port}`;

  function renderOnlineRow(u: HiveUser) {
    const dotColor = statusDotColor(u.status, true);
    const confirm = confirmAction[u.peerId];
    return (
      <div key={u.peerId} className="user-row">
        <span className="status-dot" style={{ background: dotColor }} />
        <span className="name">{u.screenName}</span>
        {u.status === 'away' && <span className="tag">away</span>}
        <div className="row-actions">
          {confirm === 'kick'
            ? <button className="action-btn confirm" onClick={() => handleKick(u.peerId)}>Kick?</button>
            : <button className="action-btn" onClick={() => setConfirmFor(u.peerId, 'kick')}>Kick</button>
          }
          {confirm === 'ban'
            ? <button className="action-btn confirm danger" onClick={() => handleBan(u.peerId)}>Ban?</button>
            : <button className="action-btn danger" onClick={() => setConfirmFor(u.peerId, 'ban')}>Ban</button>
          }
        </div>
      </div>
    );
  }

  function renderOfflineRow(u: HiveUser) {
    const confirm = confirmAction[u.peerId];
    return (
      <div key={u.peerId} className="user-row">
        <span className="status-dot" style={{ background: 'var(--c-offline)' }} />
        <span className="name">{u.screenName}</span>
        <span className="lastseen">{u.lastSeen ? fmtDate(u.lastSeen) : ''}</span>
        <div className="row-actions">
          {confirm === 'ban'
            ? <button className="action-btn confirm danger" onClick={() => handleBan(u.peerId)}>Ban?</button>
            : <button className="action-btn danger" onClick={() => setConfirmFor(u.peerId, 'ban')}>Ban</button>
          }
          {confirm === 'delete'
            ? <button className="action-btn confirm danger" onClick={() => handleDelete(u.peerId)}>Delete?</button>
            : <button className="action-btn danger" onClick={() => setConfirmFor(u.peerId, 'delete')}>Delete</button>
          }
        </div>
      </div>
    );
  }

  return (
    <div className="window">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* Title bar */}
      <div className="titlebar">
        <span className="runner">H</span>
        <span className="title">Hive Admin</span>
        <div className="tb-actions">
          <button className="tb-btn" onClick={() => setShowSettings(true)}>Settings</button>
          {running
            ? <button className="tb-btn danger" onClick={handleStop}>Stop</button>
            : <button className="tb-btn" onClick={handleStart}>Start</button>
          }
        </div>
      </div>

      {/* Server URL strip */}
      <div className="url-strip">
        <label>Server:</label>
        <span className="url-box">{serverUrl}</span>
        <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={copyUrl}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="tabbar">
        {(['users', 'rooms', 'server'] as const).map(t => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'users' ? `Users (${users.length})` : t === 'rooms' ? `Rooms (${rooms.length})` : 'Server'}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="body">

        {/* Users tab */}
        {tab === 'users' && <>
          <div className="group-header">
            <span className="chevron">&#9660;</span>
            Online
            <span className="count">({onlineUsers.length})</span>
          </div>
          {onlineUsers.length === 0
            ? <div className="empty-row">No users online</div>
            : onlineUsers.map(renderOnlineRow)
          }

          <div className="group-header">
            <span className="chevron">&#9660;</span>
            Registered
            <span className="count">({offlineUsers.length})</span>
          </div>
          {offlineUsers.length === 0
            ? <div className="empty-row">No offline users</div>
            : offlineUsers.map(renderOfflineRow)
          }

          {banned.length > 0 && <>
            <div className="group-header">
              <span className="chevron">&#9660;</span>
              Banned
              <span className="count">({banned.length})</span>
            </div>
            {banned.map(b => (
              <div key={b.peerId} className="banned-row">
                <span className="name">{b.screenName || b.peerId.slice(0, 12) + '...'}</span>
                {b.reason && <span className="ban-meta" title={b.reason}>{b.reason.slice(0, 28)}</span>}
                <span className="ban-meta">{fmtDate(b.bannedAt)}</span>
                <div className="row-actions" style={{ display: 'flex' }}>
                  <button className="action-btn" onClick={() => handleUnban(b.peerId)}>Unban</button>
                </div>
              </div>
            ))}
          </>}
        </>}

        {/* Rooms tab */}
        {tab === 'rooms' && <>
          <div className="group-header">
            <span className="chevron">&#9660;</span>
            Chat Rooms
            <span className="count">({rooms.length})</span>
          </div>
          {rooms.length === 0
            ? <div className="empty-row">No rooms</div>
            : rooms.map(r => (
                <div key={r.id} className="room-row">
                  <span className="room-icon">&#128172;</span>
                  <span className="room-name">{r.name}</span>
                  <span className="room-meta">{r.memberCount} member{r.memberCount !== 1 ? 's' : ''}</span>
                </div>
              ))
          }
        </>}

        {/* Server tab */}
        {tab === 'server' && <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-value">{stats?.connectedUsers ?? 0}</span>
              <span className="stat-label">Online Now</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats?.totalUsers ?? 0}</span>
              <span className="stat-label">Registered Users</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats?.totalRooms ?? 0}</span>
              <span className="stat-label">Rooms</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats?.totalMessages ?? 0}</span>
              <span className="stat-label">Messages Stored</span>
            </div>
            <div className={`stat-card${(stats?.undeliveredMessages ?? 0) > 0 ? ' warn' : ''}`}>
              <span className="stat-value">{stats?.undeliveredMessages ?? 0}</span>
              <span className="stat-label">Undelivered</span>
            </div>
            <div className={`stat-card${(stats?.bannedUsers ?? 0) > 0 ? ' danger' : ''}`}>
              <span className="stat-value">{stats?.bannedUsers ?? 0}</span>
              <span className="stat-label">Banned Users</span>
            </div>
          </div>

          <div className="announce-panel">
            <div className="section-title">Broadcast Announcement</div>
            <textarea
              value={announceText}
              onChange={e => setAnnounceText(e.target.value)}
              placeholder="Send a message to all connected users..."
            />
            <div className="btn-row">
              {announceSent && <span className="sent-note">Sent!</span>}
              <button
                className="btn"
                onClick={handleAnnounce}
                disabled={!running || !announceText.trim()}
              >
                Broadcast
              </button>
            </div>
          </div>
        </>}

      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span className={`dot ${running ? 'online' : 'offline'}`} />
        {running ? `Running on port ${config.port}` : 'Stopped'}
        {stats && running && (
          <span style={{ marginLeft: 'auto' }}>
            {stats.connectedUsers} online &bull; {stats.totalUsers} registered
          </span>
        )}
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

// ── Bootstrap ────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!;
createRoot(root).render(<Dashboard />);
