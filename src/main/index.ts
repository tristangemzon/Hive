import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openDb } from './db/open.js';
import { getCertBundle } from './cert.js';
import { HiveServer } from './server/ws.js';
import { registerHandlers } from './server/handlers.js';
import { registerIpcHandlers, updateServer, broadcastStatus } from './ipc/handlers.js';
import type { HiveConfig } from '@shared/types.js';
import * as IPC from '@shared/ipc.js';

const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let hiveServer: HiveServer | null = null;

// ── Config persistence ────────────────────────────────────────────────────────

function configPath(): string {
  return join(app.getPath('userData'), 'hive-config.json');
}

function loadConfig(): HiveConfig {
  try {
    if (existsSync(configPath())) {
      return JSON.parse(readFileSync(configPath(), 'utf8')) as HiveConfig;
    }
  } catch { /* use defaults */ }
  return { port: 7700, certPath: '', keyPath: '' };
}

function saveConfig(cfg: HiveConfig): void {
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const dbPath = join(userData, 'hive.db');
  const db = openDb(dbPath);
  const config = loadConfig();

  // Register IPC (no server yet — will be updated on start).
  registerIpcHandlers(null, db, config);

  // Override setConfig to also persist to disk and update running server.
  ipcMain.removeHandler(IPC.HiveSetConfig);
  ipcMain.handle(IPC.HiveSetConfig, (_event, cfg: HiveConfig) => {
    saveConfig(cfg);
    registerIpcHandlers(hiveServer, db, cfg);
    updateServer(hiveServer);
    hiveServer?.setMotd(cfg.motd ?? '');
    hiveServer?.setRegistrationOpen(cfg.registrationOpen ?? true);
  });

  // Start/stop server via IPC from dashboard.
  ipcMain.handle(IPC.HiveStart, async () => {
    if (hiveServer) {
      if (mainWindow) broadcastStatus(mainWindow, true);
      return;
    }
    const current = loadConfig();
    const cert = getCertBundle(current.certPath || undefined, current.keyPath || undefined);
    hiveServer = new HiveServer(db, current.port, cert);
    hiveServer.setMotd(current.motd ?? '');
    hiveServer.setRegistrationOpen(current.registrationOpen ?? true);
    registerHandlers(hiveServer, db);
    await hiveServer.start();
    updateServer(hiveServer);
    if (mainWindow) broadcastStatus(mainWindow, true);
  });

  ipcMain.handle(IPC.HiveStop, async () => {
    if (!hiveServer) return;
    await hiveServer.stop();
    hiveServer = null;
    updateServer(null);
    if (mainWindow) broadcastStatus(mainWindow, false);
  });

  // Auto-start server.
  try {
    const cert = getCertBundle(config.certPath || undefined, config.keyPath || undefined);
    hiveServer = new HiveServer(db, config.port, cert);
    hiveServer.setMotd(config.motd ?? '');
    hiveServer.setRegistrationOpen(config.registrationOpen ?? true);
    registerHandlers(hiveServer, db);
    await hiveServer.start();
    updateServer(hiveServer);
    console.log(`[hive] server listening on port ${hiveServer.listenPort}`);
  } catch (err) {
    console.error('[hive] failed to auto-start server', err);
  }

  // Open dashboard window.
  mainWindow = createDashboardWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createDashboardWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (hiveServer) {
    await hiveServer.stop();
    hiveServer = null;
  }
});

// ── Window ────────────────────────────────────────────────────────────────────

function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    title: 'Hive Dashboard',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173'}/dashboard.html`);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/dashboard.html'));
  }

  return win;
}
