import { contextBridge, ipcRenderer } from 'electron';
import type { HiveConfig, HiveStats, HiveUser, HiveRoom, HiveBannedUser } from '@shared/types.js';
import * as IPC from '@shared/ipc.js';

contextBridge.exposeInMainWorld('hiveApi', {
  getStats: (): Promise<HiveStats> => ipcRenderer.invoke(IPC.HiveGetStats),
  getUsers: (): Promise<HiveUser[]> => ipcRenderer.invoke(IPC.HiveGetUsers),
  getRooms: (): Promise<HiveRoom[]> => ipcRenderer.invoke(IPC.HiveGetRooms),
  getConfig: (): Promise<HiveConfig> => ipcRenderer.invoke(IPC.HiveGetConfig),
  setConfig: (cfg: HiveConfig): Promise<void> => ipcRenderer.invoke(IPC.HiveSetConfig, cfg),
  start: (): Promise<void> => ipcRenderer.invoke(IPC.HiveStart),
  stop: (): Promise<void> => ipcRenderer.invoke(IPC.HiveStop),
  onStatus: (cb: (running: boolean) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { running: boolean }) => cb(payload.running);
    ipcRenderer.on(IPC.EvtHiveStatus, listener);
    return () => ipcRenderer.removeListener(IPC.EvtHiveStatus, listener);
  },
  // Admin actions
  kickUser:   (peerId: string): Promise<void>            => ipcRenderer.invoke(IPC.HiveKickUser, peerId),
  banUser:    (peerId: string, reason?: string): Promise<void> => ipcRenderer.invoke(IPC.HiveBanUser, peerId, reason ?? ''),
  unbanUser:  (peerId: string): Promise<void>            => ipcRenderer.invoke(IPC.HiveUnbanUser, peerId),
  deleteUser: (peerId: string): Promise<void>            => ipcRenderer.invoke(IPC.HiveDeleteUser, peerId),
  announce:   (text: string): Promise<void>              => ipcRenderer.invoke(IPC.HiveAnnounce, text),
  getBanned:  (): Promise<HiveBannedUser[]>              => ipcRenderer.invoke(IPC.HiveGetBanned),
});
