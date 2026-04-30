import { ipcMain, BrowserWindow } from 'electron';
import type { Db } from '../db/open.js';
import type { HiveServer } from '../server/ws.js';
import type { HiveConfig, HiveStats, HiveUser, HiveRoom } from '@shared/types.js';
import * as IPC from '@shared/ipc.js';
import * as repos from '../db/repos.js';

let _srv: HiveServer | null = null;
let _db: Db | null = null;
let _cfg: HiveConfig = { port: 7700, certPath: '', keyPath: '' };

export function registerIpcHandlers(
  srv: HiveServer | null,
  db: Db,
  config: HiveConfig,
): void {
  _srv = srv;
  _db = db;
  _cfg = config;

  ipcMain.handle(IPC.HiveGetStats, (): HiveStats => {
    const connected = _srv ? _srv.connectedPeerIds.length : 0;
    const totalUsers = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
    const totalRooms = (db.prepare('SELECT COUNT(*) as n FROM rooms').get() as { n: number }).n;
    const totalMessages = repos.countMessages(db);
    return {
      running: _srv !== null,
      port: _cfg.port,
      address: `wss://0.0.0.0:${_cfg.port}`,
      connectedUsers: connected,
      totalUsers,
      totalRooms,
      totalMessages,
    };
  });

  ipcMain.handle(IPC.HiveGetUsers, (): HiveUser[] => {
    const connectedIds = new Set(_srv ? _srv.connectedPeerIds : []);
    return repos.listUsers(db).map((u) => ({
      ...u,
      connected: connectedIds.has(u.peerId),
    }));
  });

  ipcMain.handle(IPC.HiveGetRooms, (): HiveRoom[] => {
    return repos.listHiveRooms(db);
  });

  ipcMain.handle(IPC.HiveGetConfig, (): HiveConfig => _cfg);

  ipcMain.handle(IPC.HiveSetConfig, (_event, cfg: HiveConfig) => {
    _cfg = cfg;
    // Persisting to disk is handled by the caller (main index.ts).
  });
}

export function updateServer(srv: HiveServer | null): void {
  _srv = srv;
}

export function broadcastStatus(win: BrowserWindow, running: boolean): void {
  win.webContents.send(IPC.EvtHiveStatus, { running });
}
