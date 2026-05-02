import { ipcMain, BrowserWindow } from 'electron';
import type { Db } from '../db/open.js';
import type { HiveServer } from '../server/ws.js';
import type { HiveConfig, HiveStats, HiveUser, HiveRoom, HiveBannedUser } from '@shared/types.js';
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
    const undeliveredMessages = repos.countUndeliveredAll(db);
    const bannedUsers = repos.countBanned(db);
    return {
      running: _srv !== null,
      port: _cfg.port,
      address: `wss://0.0.0.0:${_cfg.port}`,
      connectedUsers: connected,
      totalUsers,
      totalRooms,
      totalMessages,
      undeliveredMessages,
      bannedUsers,
    };
  });

  ipcMain.handle(IPC.HiveGetUsers, (): HiveUser[] => {
    const connectedIds = new Set(_srv ? _srv.connectedPeerIds : []);
    const bannedIds = new Set(repos.listBannedUsers(db).map((b) => b.peerId));
    return repos.listUsers(db).map((u) => ({
      ...u,
      connected: connectedIds.has(u.peerId),
      banned: bannedIds.has(u.peerId),
    }));
  });

  ipcMain.handle(IPC.HiveGetRooms, (): HiveRoom[] => {
    return repos.listHiveRooms(db);
  });

  ipcMain.handle(IPC.HiveGetConfig, (): HiveConfig => _cfg);

  ipcMain.handle(IPC.HiveSetConfig, (_event, cfg: HiveConfig) => {
    _cfg = cfg;
  });

  // ── Admin actions ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.HiveKickUser, (_event, peerId: string) => {
    _srv?.kickPeer(peerId);
  });

  ipcMain.handle(IPC.HiveBanUser, (_event, peerId: string, reason = '') => {
    repos.banUser(db, peerId, reason);
    _srv?.kickPeer(peerId); // disconnect immediately if online
  });

  ipcMain.handle(IPC.HiveUnbanUser, (_event, peerId: string) => {
    repos.unbanUser(db, peerId);
  });

  ipcMain.handle(IPC.HiveDeleteUser, (_event, peerId: string) => {
    _srv?.kickPeer(peerId); // disconnect first if online
    repos.deleteUser(db, peerId);
  });

  ipcMain.handle(IPC.HiveAnnounce, (_event, text: string) => {
    _srv?.broadcastAnnouncement(text);
  });

  ipcMain.handle(IPC.HiveGetBanned, (): HiveBannedUser[] => {
    return repos.listBannedUsers(db);
  });
}

export function updateServer(srv: HiveServer | null): void {
  _srv = srv;
}

export function broadcastStatus(win: BrowserWindow, running: boolean): void {
  win.webContents.send(IPC.EvtHiveStatus, { running });
}
