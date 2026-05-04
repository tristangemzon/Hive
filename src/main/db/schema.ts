// Hive database schema — plain SQLite (no encryption; server admin controls machine).
// Messages and room messages store only opaque E2E-encrypted ciphertext (base64).
// The server never has access to the plaintext.

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

-- Registered users. Pubkey is their ed25519 public key (base64).
-- encrypted_keystore: the client's keystore.bin blob stored as base64.
--   Only the user can decrypt it (passphrase-encrypted); server can't read it.
-- registered_at: set on account creation via POST /api/register.
--   NULL means the row was created by legacy upsertUser before registration
--   was enforced; those rows cannot authenticate via WebSocket.
CREATE TABLE IF NOT EXISTS users (
  peer_id              TEXT PRIMARY KEY,
  screen_name          TEXT NOT NULL,
  pub_key_b64          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'offline',
  away_message         TEXT,
  last_seen            INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  encrypted_keystore   TEXT,
  registered_at        INTEGER
);

-- Unique index on screen_name (case-sensitive) so no two accounts share a name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_screen_name ON users(screen_name);

-- Buddy relationships. Symmetric: (a→b) + (b→a) both present when approved.
CREATE TABLE IF NOT EXISTS buddy_relationships (
  peer_id_a     TEXT NOT NULL,
  peer_id_b     TEXT NOT NULL,
  PRIMARY KEY (peer_id_a, peer_id_b)
);

-- Pending buddy add requests.
CREATE TABLE IF NOT EXISTS buddy_requests (
  from_peer_id  TEXT NOT NULL,
  to_peer_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (from_peer_id, to_peer_id)
);

-- 1:1 IM history. cipher_b64 is sealed_box ciphertext only the recipient can open.
-- delivered = 1 once the message has been dispatched to an online recipient.
CREATE TABLE IF NOT EXISTS messages (
  msg_id        TEXT PRIMARY KEY,
  from_peer_id  TEXT NOT NULL,
  to_peer_id    TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  cipher_b64    TEXT NOT NULL,
  delivered     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_peer_id, delivered, ts);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_peer_id, to_peer_id, ts DESC);

-- Chat rooms.
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Room membership.
CREATE TABLE IF NOT EXISTS room_members (
  room_id    TEXT NOT NULL,
  peer_id    TEXT NOT NULL,
  -- key_envelope_b64: room key sealed to this member's X25519 pubkey.
  -- Server stores it so it can re-send on reconnect (member loses local state).
  key_envelope_b64 TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_peer ON room_members(peer_id);

-- Room channels (text or voice).
CREATE TABLE IF NOT EXISTS room_channels (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice')),
  category   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_channels_room ON room_channels(room_id);

-- Room messages. cipher_b64 is secretbox ciphertext only room members (with the room key) can open.
CREATE TABLE IF NOT EXISTS room_messages (
  msg_id     TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  from_peer  TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  cipher_b64 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_messages_channel ON room_messages(room_id, channel_id, ts DESC);

-- Banned users. Banned peers are rejected at WebSocket auth time.
CREATE TABLE IF NOT EXISTS banned_users (
  peer_id    TEXT PRIMARY KEY,
  banned_at  INTEGER NOT NULL,
  reason     TEXT
);

-- 1:1 reaction history. Stored for offline delivery.
-- removed = 1 means the reaction was taken back.
-- delivered = 1 once relayed to the target peer.
CREATE TABLE IF NOT EXISTS reactions (
  msg_id       TEXT NOT NULL,
  from_peer_id TEXT NOT NULL,
  to_peer_id   TEXT NOT NULL,
  emoji        TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  removed      INTEGER NOT NULL DEFAULT 0,
  delivered    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (msg_id, from_peer_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_to ON reactions(to_peer_id, delivered, removed);
`;

export const CURRENT_VERSION = 5;
