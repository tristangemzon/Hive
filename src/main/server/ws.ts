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
import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import type { CertBundle } from '../cert.js';
import { generateNonce, verifyAuthSignature, ensureSodium } from './auth.js';
import type { Db } from '../db/open.js';
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

    // Upsert user in DB (deferred to handler layer which imports repos).
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
}
