# Hive

A **centralized relay server** for [Buzz](https://github.com/tristangemzon/Buzz) — the AIM/AOL-flavoured secure chat client. Hive is a standalone Electron app you host yourself. It stores end-to-end-encrypted messages, relays voice/video frames, manages presence, buddy relationships, and multi-party chat rooms, all without ever being able to read your content.

> Status: **early scaffold, fully functional.** Auth, presence, 1:1 IM, buddy management, multi-party rooms (text + voice channels), offline message delivery, and binary voice/video relay are all wired up.

---

## How it relates to Buzz

Buzz normally runs fully peer-to-peer over libp2p. When a Buzz client is configured with a Hive server URL (`wss://…`) it switches to **server mode**: libp2p is not started and all traffic flows through Hive instead. This trades pure decentralisation for reliability — clients behind symmetric NAT or mobile networks can reach each other as long as they can reach Hive.

The server is architecturally transparent to the end-to-end encryption:

- **1:1 messages** are sealed with `crypto_box_seal` (X25519/XSalsa20-Poly1305 derived from the recipient's Ed25519 key) before they leave the sender. Hive stores and forwards opaque ciphertext.
- **Room messages** are XSalsa20-Poly1305 secretbox'd with a per-room 32-byte key that Hive never sees.
- **Voice/video frames** are binary-relayed verbatim — Hive reads only the destination peer ID from the frame header.

---

## Features

### Identity & auth

- Clients authenticate with an **Ed25519 challenge-response**: Hive sends a 32-byte random nonce; the client signs `nonce_bytes ‖ peerId_utf8` and returns its Ed25519 public key + signature. Hive verifies with libsodium and rejects within 15 s or it drops the connection.
- Peer IDs are `SHA-256(ed25519_pubkey)` hex strings — no libp2p dependency needed.
- Public keys are cached and distributed to buddies on connect so clients can perform sealed-box encryption without contacting each other directly.

### Presence

- Clients publish `online` / `away` / `idle` / `invisible` / `offline` status with an optional away message.
- Hive fans presence updates out to all confirmed buddies in real time.
- On reconnect the full buddy list (with current statuses) and any pending buddy requests are pushed to the client immediately.

### 1:1 messaging

- Messages are stored with a UUID, timestamp, sender/recipient peer IDs, and sealed ciphertext.
- **Offline delivery**: if the recipient is not connected, the message is held in SQLite until they reconnect, then flushed automatically.
- Clients send an **ack** after decryption; acked messages are marked delivered.
- **History retrieval**: clients can page back through past messages by timestamp.

### Buddy management

- Add / remove / approve / deny buddy requests — only mutual buddies receive each other's presence.
- Request state is persisted across reconnects.

### Multi-party chat rooms

- **Create** a room with an initial member list, per-member sealed key envelopes, and one or more channels.
- **Invite** additional members at any time (with their key envelope).
- **Text channels** — room messages stored and delivered, with history paging.
- **Voice channels** — binary audio frames (type `0xA1`) routed by peer ID without buffering.
- **Video relay** — binary video frames (type `0xA2`) routed the same way.
- Room membership, channels, and message history are all persisted in SQLite.

### Voice/video relay

Binary WebSocket frames are routed without copying into SQLite. Frame format:

```
[1 byte type][2 LE toPeerIdLen][toPeerId utf8][2 LE callIdLen][callId utf8][payload…]
```

- `0xA1` — audio frame
- `0xA2` — video frame

### TLS

On first launch Hive auto-generates a **self-signed RSA-2048 X.509 certificate** via `openssl req -x509` and stores it at `userData/hive-cert.pem` + `hive-key.pem`. You can override both paths in Settings to point at a real certificate (e.g. from Let's Encrypt).

Buzz clients connect with `rejectUnauthorized: false` for the self-signed default; swap in a real cert and they'll verify normally.

### Dashboard

A built-in dark-themed React dashboard (served as an Electron renderer window) shows:

- Live **server stats**: connected clients, total registered users, rooms, messages stored.
- **Users panel**: screen name, peer ID, current status with colour dot.
- **Rooms panel**: name, member count, channel list.
- **Settings modal**: listen port, custom cert/key paths. Changes are applied immediately and persisted across restarts.

Auto-refreshes every 5 s via IPC.

### Security

- HTTPS + WSS only — plain HTTP/WS is not supported.
- All IPC payloads validated with **zod** schemas.
- Sandboxed renderer (`contextIsolation: true`, `sandbox: true`, no `nodeIntegration`).
- Auth timeout: connections that don't complete the challenge-response in 15 s are dropped.

---

## Run it

```bash
npm install
npm run dev
```

The dashboard window opens automatically. The WSS server starts on port **7700** by default (change it in the Settings modal).

### Configure Buzz to use Hive

In Buzz → Sign On → Settings, change **Network Mode** to **Server** and enter:

```
wss://<your-hive-host>:7700
```

Toggle **Cache locally** to control whether Buzz stores a local copy of messages in its own SQLCipher DB in addition to Hive's server-side storage.

---

## Project layout

```
src/
  main/
    db/
      schema.ts          SQLite table definitions + migration runner
      open.ts            Opens the DB in WAL mode, runs migrations
      repos.ts           Typed CRUD: users, buddies, messages, rooms, channels
    server/
      auth.ts            libsodium Ed25519 challenge-response helpers
      ws.ts              HTTPS + WSS server, connection state machine
      handlers.ts        All ClientMessage → DB + broadcast logic
    ipc/
      handlers.ts        Electron IPC bridge (stats, config, start/stop)
    cert.ts              Auto-generates self-signed TLS cert via openssl
    index.ts             App entry: lifecycle, windows, auto-start
  preload/
    index.ts             contextBridge → typed window.hiveApi
  renderer/
    dashboard/
      main.tsx           React dashboard (stats, users, rooms, settings)
    dashboard.html       Single-entry HTML shell
  shared/
    types.ts             All wire-protocol types (ServerMessage, ClientMessage, …)
    ipc.ts               IPC channel constants
```

---

## Tech stack

| Layer | Library |
|---|---|
| App shell | [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.github.io/) |
| UI | React 18 + TypeScript (strict) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (plain SQLite, WAL mode) |
| Crypto | [libsodium-wrappers-sumo](https://github.com/jedisct1/libsodium.js) |
| WebSocket server | [ws](https://github.com/websockets/ws) |
| Schema validation | [zod](https://zod.dev/) |
| Build | Vite 5 |

---

## Security notes

- Hive **cannot read messages or room content** — it stores and forwards opaque ciphertext.
- Voice/video frames are relayed as raw bytes; Hive never decodes them.
- The Ed25519 auth scheme means a compromised network path cannot impersonate a client.
- SQLite is not encrypted at rest on the server — run Hive on a machine you control and secure the filesystem accordingly. The DB contains ciphertext only; even if stolen it reveals no message content.
