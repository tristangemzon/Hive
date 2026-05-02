/**
 * Hive WebSocket server.
 *
 * Transport: WSS (WebSocket over HTTPS/TLS).
 * Protocol: JSON for control/chat messages, binary for voice/video relay.
 *
 * Binary frame format for audio/video relay:
 *   [1 byte type: 0xA1=audio, 0xA2=video]
 *   [2 bytes LE: toPeerId length]
 *   [toPeerId UTF-8]
 *   [2 bytes LE: callId length]
 *   [callId UTF-8]
 *   [remaining bytes: encrypted media payload]
 */
import * as https from 'node:https';
import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import type { CertBundle } from '../cert.js';
import { generateNonce, verifyAuthSignature, ensureSodium } from './auth.js';
import type { Db } from '../db/open.js';
import * as repos from '../db/repos.js';
import type { ClientMessage, ServerMessage } from '@shared/types.js';

// How long (ms) a connection has to complete auth before being dropped.
const AUTH_TIMEOUT_MS = 15_000;

export type ConnectionState =
  | { phase: 'challenge'; nonce: string; timeout: NodeJS.Timeout }
  | { phase: 'authed'; peerId: string };

export interface HiveServerEvents {
  message: (peerId: string, msg: ClientMessage) => void;
  binaryFrame: (buf: Buffer) => void;
  connected: (peerId: string) => void;
  disconnected: (peerId: string) => void;
  error: (err: Error) => void;
}

export class HiveServer extends EventEmitter {
  private httpsServer: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private sockets = new Map<WebSocket, ConnectionState>();
  /** peerId → socket (only authed) */
  private peers = new Map<string, WebSocket>();
  private db: Db;
  private port: number;
  private cert: CertBundle;

  /** Message of the day — sent as SrvAnnounce immediately after a client auths. */
  motd = '';
  /** When false, POST /api/register is rejected with 403. */
  registrationOpen = true;

  constructor(db: Db, port: number, cert: CertBundle) {
    super();
    this.db = db;
    this.port = port;
    this.cert = cert;
  }

  async start(): Promise<void> {
    await ensureSodium();

    this.httpsServer = https.createServer({
      cert: this.cert.certPem,
      key: this.cert.keyPem,
    });

    // Handle REST API requests before WebSocket upgrades.
    this.httpsServer.on('request', (req, res) => this.handleHttpRequest(req, res));

    this.wss = new WebSocketServer({ server: this.httpsServer });

    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.wss.on('error', (err) => this.emit('error', err));

    await new Promise<void>((resolve, reject) => {
      this.httpsServer!.listen(this.port, '0.0.0.0', () => resolve());
      this.httpsServer!.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
    await new Promise<void>((resolve) => {
      if (this.httpsServer) {
        this.httpsServer.close(() => resolve());
      } else {
        resolve();
      }
    });
    this.sockets.clear();
    this.peers.clear();
  }

  get connectedPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  get listenPort(): number {
    const addr = this.httpsServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.port;
  }

  // ── Send helpers ───────────────────────────────────────────────────────────

  send(toPeerId: string, msg: ServerMessage): void {
    const ws = this.peers.get(toPeerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  sendBinary(toPeerId: string, buf: Buffer): void {
    const ws = this.peers.get(toPeerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
    }
  }

  broadcastToMany(peerIds: string[], msg: ServerMessage): void {
    const json = JSON.stringify(msg);
    for (const id of peerIds) {
      const ws = this.peers.get(id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      }
    }
  }

  /** Disconnect a specific peer. Returns true if the peer was connected. */
  kickPeer(peerId: string): boolean {
    const ws = this.peers.get(peerId);
    if (!ws) return false;
    ws.close(4009, 'kicked');
    return true;
  }

  /** Send an announce message to every currently connected peer. */
  broadcastAnnouncement(text: string): void {
    const msg = JSON.stringify({ type: 'announce', text, ts: Date.now() } satisfies ServerMessage);
    for (const ws of this.peers.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  setMotd(motd: string): void { this.motd = motd; }
  setRegistrationOpen(open: boolean): void { this.registrationOpen = open; }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  private onConnection(ws: WebSocket): void {
    const nonce = generateNonce();
    const timeout = setTimeout(() => {
      // Auth timeout — drop the connection.
      ws.close(4008, 'auth-timeout');
    }, AUTH_TIMEOUT_MS);

    this.sockets.set(ws, { phase: 'challenge', nonce, timeout });

    // Send challenge immediately.
    ws.send(JSON.stringify({ type: 'challenge', nonce } satisfies ServerMessage));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.onBinaryFrame(ws, data as Buffer);
      } else {
        this.onTextFrame(ws, data.toString('utf8'));
      }
    });

    ws.on('close', () => this.onClose(ws));
    ws.on('error', (err) => this.emit('error', err));
  }

  private onTextFrame(ws: WebSocket, text: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      ws.close(4003, 'bad-json');
      return;
    }

    const state = this.sockets.get(ws);
    if (!state) return;

    if (state.phase === 'challenge') {
      if (msg.type !== 'auth') {
        ws.close(4001, 'expected-auth');
        return;
      }
      clearTimeout(state.timeout);
      this.handleAuth(ws, msg, state.nonce);
    } else if (state.phase === 'authed') {
      if (msg.type === 'auth') return; // ignore duplicate auth
      this.emit('message', state.peerId, msg);
    }
  }

  private handleAuth(ws: WebSocket, msg: import('@shared/types.js').CliAuth, nonce: string): void {
    const { peerId, screenName, pubKeyB64, sigB64 } = msg;

    // Basic field validation.
    if (!peerId || !screenName || !pubKeyB64 || !sigB64) {
      ws.close(4002, 'auth-missing-fields');
      return;
    }

    // Reject if another connection with same peerId is already authed.
    // (They may reconnect — drop old connection first.)
    const existing = this.peers.get(peerId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(4010, 'replaced');
      this.peers.delete(peerId);
    }

    // Verify signature.
    if (!verifyAuthSignature(pubKeyB64, nonce, peerId, sigB64)) {
      ws.close(4003, 'auth-invalid-sig');
      return;
    }

    // Ensure the peer has a registered account. Unregistered peers must call
    // POST /api/register via the HTTP API before they can connect over WS.
    if (!repos.isUserRegistered(this.db, peerId)) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'not_registered',
        message: 'Account not found on this server. Please register first.',
      } satisfies ServerMessage));
      ws.close(4011, 'not-registered');
      return;
    }

    // Reject banned users.
    if (repos.isBanned(this.db, peerId)) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'banned',
        message: 'Your account has been banned from this server.',
      } satisfies ServerMessage));
      ws.close(4010, 'banned');
      return;
    }

    this.sockets.set(ws, { phase: 'authed', peerId });
    this.peers.set(peerId, ws);

    this.emit('connected', peerId);
    // The message handler layer will send the 'authed' response with buddy list etc.
    this.emit('message', peerId, msg);
  }

  private onBinaryFrame(ws: WebSocket, buf: Buffer): void {
    const state = this.sockets.get(ws);
    if (!state || state.phase !== 'authed') return;
    // Relay is handled by the handler layer; we just surface the raw buffer.
    this.emit('binaryFrame', buf);
  }

  private onClose(ws: WebSocket): void {
    const state = this.sockets.get(ws);
    if (state?.phase === 'challenge') {
      clearTimeout(state.timeout);
    } else if (state?.phase === 'authed') {
      this.peers.delete(state.peerId);
      this.emit('disconnected', state.peerId);
    }
    this.sockets.delete(ws);
  }

  // ── HTTP REST API ──────────────────────────────────────────────────────────

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    // CORS headers — allow cross-origin fetches from the Buzz app.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /api/server-info
    if (method === 'GET' && url === '/api/server-info') {
      res.writeHead(200);
      res.end(JSON.stringify({ serverName: 'Hive', version: '1', registrationOpen: this.registrationOpen }));
      return;
    }

    // GET /api/users — list all registered accounts
    if (method === 'GET' && url === '/api/users') {
      res.writeHead(200);
      res.end(JSON.stringify(repos.listRegisteredUsers(this.db)));
      return;
    }

    // GET /api/users/:screenName/keystore — download encrypted keystore
    const keystoreMatch = url.match(/^\/api\/users\/([^/]+)\/keystore$/);
    if (method === 'GET' && keystoreMatch) {
      const screenName = decodeURIComponent(keystoreMatch[1]!);
      const blob = repos.getEncryptedKeystore(this.db, screenName);
      if (!blob) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not_found', message: 'User not found.' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ encryptedKeystoreB64: blob }));
      return;
    }

    // POST /api/register — create a new account
    if (method === 'POST' && url === '/api/register') {
      if (!this.registrationOpen) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'registration_closed', message: 'Registration is closed on this server.' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += (chunk as Buffer).toString('utf8'); });
      req.on('end', () => {
        try {
          const { screenName, peerId, pubKeyB64, encryptedKeystoreB64 } =
            JSON.parse(body) as Record<string, string>;

          if (!screenName || !peerId || !pubKeyB64 || !encryptedKeystoreB64) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'missing_fields', message: 'screenName, peerId, pubKeyB64, and encryptedKeystoreB64 are required.' }));
            return;
          }
          if (screenName.length > 64) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'invalid_screen_name', message: 'Screen name must be 64 characters or fewer.' }));
            return;
          }
          if (repos.isScreenNameTaken(this.db, screenName)) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: 'screen_name_taken', message: 'That screen name is already taken.' }));
            return;
          }
          repos.registerUser(this.db, peerId, screenName, pubKeyB64, encryptedKeystoreB64);
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error('[hive] POST /api/register error', err);
          // Duplicate peer_id (same device re-registering) surfaces as UNIQUE constraint.
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('UNIQUE')) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: 'already_registered', message: 'This identity is already registered.' }));
          } else {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'internal', message: 'Internal server error.' }));
          }
        }
      });
      return;
    }

    // 404 for everything else.
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not_found' }));
  }
}
