import type { Db } from './open.js';
import type { UserStatus, BuddyEntry, BuddyRequest, RoomEntry, ChannelEntry, HiveUser, HiveRoom } from '@shared/types.js';

// ── Users ────────────────────────────────────────────────────────────────────

export function upsertUser(
  db: Db,
  peerId: string,
  screenName: string,
  pubKeyB64: string,
): void {
  db.prepare(`
    INSERT INTO users (peer_id, screen_name, pub_key_b64, last_seen, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(peer_id) DO UPDATE SET
      screen_name = excluded.screen_name,
      pub_key_b64 = excluded.pub_key_b64,
      last_seen   = excluded.last_seen
  `).run(peerId, screenName, pubKeyB64, Date.now(), Date.now());
}

export function getUser(db: Db, peerId: string): { peerId: string; screenName: string; pubKeyB64: string; status: UserStatus; awayMessage: string | null } | null {
  const row = db.prepare('SELECT peer_id, screen_name, pub_key_b64, status, away_message FROM users WHERE peer_id = ?').get(peerId) as { peer_id: string; screen_name: string; pub_key_b64: string; status: string; away_message: string | null } | undefined;
  if (!row) return null;
  return { peerId: row.peer_id, screenName: row.screen_name, pubKeyB64: row.pub_key_b64, status: row.status as UserStatus, awayMessage: row.away_message };
}

export function setUserStatus(db: Db, peerId: string, status: UserStatus, awayMessage?: string): void {
  db.prepare('UPDATE users SET status = ?, away_message = ?, last_seen = ? WHERE peer_id = ?')
    .run(status, awayMessage ?? null, Date.now(), peerId);
}

export function listUsers(db: Db): HiveUser[] {
  const rows = db.prepare('SELECT peer_id, screen_name, status, last_seen FROM users ORDER BY last_seen DESC').all() as Array<{ peer_id: string; screen_name: string; status: string; last_seen: number }>;
  return rows.map((r) => ({
    peerId: r.peer_id,
    screenName: r.screen_name,
    status: r.status as UserStatus,
    connected: false, // filled in by caller
    lastSeen: r.last_seen,
  }));
}

export function getPubKey(db: Db, peerId: string): string | null {
  const row = db.prepare('SELECT pub_key_b64 FROM users WHERE peer_id = ?').get(peerId) as { pub_key_b64: string } | undefined;
  return row?.pub_key_b64 ?? null;
}

// ── Buddy relationships ──────────────────────────────────────────────────────

export function addBuddyRelationship(db: Db, peerA: string, peerB: string): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO buddy_relationships (peer_id_a, peer_id_b) VALUES (?, ?)');
  stmt.run(peerA, peerB);
  stmt.run(peerB, peerA);
}

export function removeBuddyRelationship(db: Db, peerA: string, peerB: string): void {
  const stmt = db.prepare('DELETE FROM buddy_relationships WHERE (peer_id_a = ? AND peer_id_b = ?) OR (peer_id_a = ? AND peer_id_b = ?)');
  stmt.run(peerA, peerB, peerB, peerA);
}

export function areBuddies(db: Db, peerA: string, peerB: string): boolean {
  return !!db.prepare('SELECT 1 FROM buddy_relationships WHERE peer_id_a = ? AND peer_id_b = ?').get(peerA, peerB);
}

export function listBuddyPeerIds(db: Db, peerId: string): string[] {
  const rows = db.prepare('SELECT peer_id_b FROM buddy_relationships WHERE peer_id_a = ?').all(peerId) as Array<{ peer_id_b: string }>;
  return rows.map((r) => r.peer_id_b);
}

export function listBuddyEntries(db: Db, peerId: string): BuddyEntry[] {
  const rows = db.prepare(`
    SELECT u.peer_id, u.screen_name, u.status, u.away_message
    FROM buddy_relationships br
    JOIN users u ON u.peer_id = br.peer_id_b
    WHERE br.peer_id_a = ?
  `).all(peerId) as Array<{ peer_id: string; screen_name: string; status: string; away_message: string | null }>;
  return rows.map((r) => ({
    peerId: r.peer_id,
    screenName: r.screen_name,
    status: r.status as UserStatus,
    awayMessage: r.away_message ?? undefined,
  }));
}

// ── Buddy requests ───────────────────────────────────────────────────────────

export function insertBuddyRequest(db: Db, fromPeerId: string, toPeerId: string): void {
  db.prepare('INSERT OR IGNORE INTO buddy_requests (from_peer_id, to_peer_id, created_at) VALUES (?, ?, ?)')
    .run(fromPeerId, toPeerId, Date.now());
}

export function deleteBuddyRequest(db: Db, fromPeerId: string, toPeerId: string): void {
  db.prepare('DELETE FROM buddy_requests WHERE from_peer_id = ? AND to_peer_id = ?').run(fromPeerId, toPeerId);
}

export function listBuddyRequests(db: Db, peerId: string): BuddyRequest[] {
  const incoming = db.prepare(`
    SELECT br.from_peer_id, u.screen_name, br.created_at FROM buddy_requests br
    JOIN users u ON u.peer_id = br.from_peer_id
    WHERE br.to_peer_id = ?
  `).all(peerId) as Array<{ from_peer_id: string; screen_name: string; created_at: number }>;
  const outgoing = db.prepare(`
    SELECT br.to_peer_id, u.screen_name, br.created_at FROM buddy_requests br
    JOIN users u ON u.peer_id = br.to_peer_id
    WHERE br.from_peer_id = ?
  `).all(peerId) as Array<{ to_peer_id: string; screen_name: string; created_at: number }>;

  return [
    ...incoming.map((r) => ({ peerId: r.from_peer_id, screenName: r.screen_name, direction: 'in' as const, createdAt: r.created_at })),
    ...outgoing.map((r) => ({ peerId: r.to_peer_id, screenName: r.screen_name, direction: 'out' as const, createdAt: r.created_at })),
  ];
}

export function hasBuddyRequest(db: Db, fromPeerId: string, toPeerId: string): boolean {
  return !!db.prepare('SELECT 1 FROM buddy_requests WHERE from_peer_id = ? AND to_peer_id = ?').get(fromPeerId, toPeerId);
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function insertMessage(
  db: Db,
  msgId: string,
  fromPeerId: string,
  toPeerId: string,
  ts: number,
  cipherB64: string,
  delivered: boolean,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO messages (msg_id, from_peer_id, to_peer_id, ts, cipher_b64, delivered, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, fromPeerId, toPeerId, ts, cipherB64, delivered ? 1 : 0, Date.now());
}

export function markMessageDelivered(db: Db, msgId: string): void {
  db.prepare('UPDATE messages SET delivered = 1 WHERE msg_id = ?').run(msgId);
}

export function listUndelivered(db: Db, toPeerId: string): Array<{ msgId: string; from: string; ts: number; cipherB64: string }> {
  const rows = db.prepare('SELECT msg_id, from_peer_id, ts, cipher_b64 FROM messages WHERE to_peer_id = ? AND delivered = 0 ORDER BY ts ASC')
    .all(toPeerId) as Array<{ msg_id: string; from_peer_id: string; ts: number; cipher_b64: string }>;
  return rows.map((r) => ({ msgId: r.msg_id, from: r.from_peer_id, ts: r.ts, cipherB64: r.cipher_b64 }));
}

export function listHistory(
  db: Db,
  peerA: string,
  peerB: string,
  before?: number,
  limit = 50,
): Array<{ msgId: string; from: string; ts: number; cipherB64: string }> {
  const rows = before
    ? db.prepare(`SELECT msg_id, from_peer_id, ts, cipher_b64 FROM messages
        WHERE ((from_peer_id = ? AND to_peer_id = ?) OR (from_peer_id = ? AND to_peer_id = ?))
        AND ts < ? ORDER BY ts DESC LIMIT ?`).all(peerA, peerB, peerB, peerA, before, limit)
    : db.prepare(`SELECT msg_id, from_peer_id, ts, cipher_b64 FROM messages
        WHERE ((from_peer_id = ? AND to_peer_id = ?) OR (from_peer_id = ? AND to_peer_id = ?))
        ORDER BY ts DESC LIMIT ?`).all(peerA, peerB, peerB, peerA, limit);
  return (rows as Array<{ msg_id: string; from_peer_id: string; ts: number; cipher_b64: string }>)
    .map((r) => ({ msgId: r.msg_id, from: r.from_peer_id, ts: r.ts, cipherB64: r.cipher_b64 }));
}

export function countMessages(db: Db): number {
  return (db.prepare('SELECT COUNT(*) as n FROM messages').get() as { n: number }).n;
}

// ── Rooms ────────────────────────────────────────────────────────────────────

export function createRoom(db: Db, id: string, name: string, createdBy: string): void {
  db.prepare('INSERT OR IGNORE INTO rooms (id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, createdBy, Date.now());
}

export function getRoom(db: Db, id: string): { id: string; name: string } | null {
  const row = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(id) as { id: string; name: string } | undefined;
  return row ?? null;
}

export function addRoomMember(db: Db, roomId: string, peerId: string, keyEnvelopeB64: string): void {
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, peer_id, key_envelope_b64, joined_at) VALUES (?, ?, ?, ?)')
    .run(roomId, peerId, keyEnvelopeB64, Date.now());
}

export function listRoomMembers(db: Db, roomId: string): Array<{ peerId: string; keyEnvelopeB64: string }> {
  const rows = db.prepare('SELECT peer_id, key_envelope_b64 FROM room_members WHERE room_id = ?').all(roomId) as Array<{ peer_id: string; key_envelope_b64: string }>;
  return rows.map((r) => ({ peerId: r.peer_id, keyEnvelopeB64: r.key_envelope_b64 }));
}

export function isRoomMember(db: Db, roomId: string, peerId: string): boolean {
  return !!db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND peer_id = ?').get(roomId, peerId);
}

export function getRoomKeyEnvelope(db: Db, roomId: string, peerId: string): string | null {
  const row = db.prepare('SELECT key_envelope_b64 FROM room_members WHERE room_id = ? AND peer_id = ?').get(roomId, peerId) as { key_envelope_b64: string } | undefined;
  return row?.key_envelope_b64 ?? null;
}

export function addRoomChannel(db: Db, id: string, roomId: string, name: string, kind: 'text' | 'voice'): void {
  db.prepare('INSERT OR IGNORE INTO room_channels (id, room_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, roomId, name, kind, Date.now());
}

export function listRoomChannels(db: Db, roomId: string): ChannelEntry[] {
  const rows = db.prepare('SELECT id, name, kind FROM room_channels WHERE room_id = ? ORDER BY created_at ASC').all(roomId) as Array<{ id: string; name: string; kind: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as 'text' | 'voice' }));
}

export function listRoomEntriesForPeer(db: Db, peerId: string): RoomEntry[] {
  const rooms = db.prepare(`
    SELECT r.id, r.name FROM rooms r
    JOIN room_members rm ON rm.room_id = r.id
    WHERE rm.peer_id = ?
  `).all(peerId) as Array<{ id: string; name: string }>;
  return rooms.map((r) => ({
    id: r.id,
    name: r.name,
    members: listRoomMembers(db, r.id).map((m) => m.peerId),
    channels: listRoomChannels(db, r.id),
  }));
}

export function insertRoomMessage(
  db: Db,
  msgId: string,
  roomId: string,
  channelId: string,
  fromPeer: string,
  ts: number,
  cipherB64: string,
): void {
  db.prepare('INSERT OR IGNORE INTO room_messages (msg_id, room_id, channel_id, from_peer, ts, cipher_b64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, roomId, channelId, fromPeer, ts, cipherB64, Date.now());
}

export function listRoomHistory(
  db: Db,
  roomId: string,
  channelId: string,
  before?: number,
  limit = 50,
): Array<{ msgId: string; from: string; ts: number; cipherB64: string }> {
  const rows = before
    ? db.prepare('SELECT msg_id, from_peer, ts, cipher_b64 FROM room_messages WHERE room_id = ? AND channel_id = ? AND ts < ? ORDER BY ts DESC LIMIT ?').all(roomId, channelId, before, limit)
    : db.prepare('SELECT msg_id, from_peer, ts, cipher_b64 FROM room_messages WHERE room_id = ? AND channel_id = ? ORDER BY ts DESC LIMIT ?').all(roomId, channelId, limit);
  return (rows as Array<{ msg_id: string; from_peer: string; ts: number; cipher_b64: string }>)
    .map((r) => ({ msgId: r.msg_id, from: r.from_peer, ts: r.ts, cipherB64: r.cipher_b64 }));
}

export function listHiveRooms(db: Db): HiveRoom[] {
  const rows = db.prepare('SELECT id, name FROM rooms').all() as Array<{ id: string; name: string }>;
  return rows.map((r) => {
    const memberCount = (db.prepare('SELECT COUNT(*) as n FROM room_members WHERE room_id = ?').get(r.id) as { n: number }).n;
    const messageCount = (db.prepare('SELECT COUNT(*) as n FROM room_messages WHERE room_id = ?').get(r.id) as { n: number }).n;
    const textChannels = (db.prepare("SELECT COUNT(*) as n FROM room_channels WHERE room_id = ? AND kind = 'text'").get(r.id) as { n: number }).n;
    const voiceChannels = (db.prepare("SELECT COUNT(*) as n FROM room_channels WHERE room_id = ? AND kind = 'voice'").get(r.id) as { n: number }).n;
    return { id: r.id, name: r.name, memberCount, messageCount, textChannels, voiceChannels };
  });
}
