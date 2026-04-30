/**
 * Hive message dispatcher.
 *
 * Wires together the WS server, the DB repos, and the business logic for
 * every client→server message type. The HiveServer emits 'message' events
 * here; this module dispatches them and calls srv.send() / srv.broadcastToMany()
 * to reply.
 *
 * Binary voice/video relay is handled separately in handleBinaryFrame().
 */
import type { HiveServer } from './ws.js';
import type { Db } from '../db/open.js';
import type { ClientMessage, ServerMessage } from '@shared/types.js';
import * as repos from '../db/repos.js';

export function registerHandlers(srv: HiveServer, db: Db): void {
  srv.on('message', (peerId: string, msg: ClientMessage) => {
    try {
      dispatch(srv, db, peerId, msg);
    } catch (err) {
      console.error('[hive] handler error', err);
    }
  });

  srv.on('binaryFrame', (buf: Buffer) => {
    handleBinaryFrame(srv, buf);
  });

  srv.on('disconnected', (peerId: string) => {
    handleDisconnect(srv, db, peerId);
  });
}

function dispatch(srv: HiveServer, db: Db, peerId: string, msg: ClientMessage): void {
  switch (msg.type) {
    case 'auth':            return handleAuth(srv, db, peerId, msg);
    case 'setStatus':       return handleSetStatus(srv, db, peerId, msg);
    case 'im':              return handleIm(srv, db, peerId, msg);
    case 'ack':             return handleAck(srv, db, peerId, msg);
    case 'buddyAdd':        return handleBuddyAdd(srv, db, peerId, msg);
    case 'buddyRemove':     return handleBuddyRemove(srv, db, peerId, msg);
    case 'buddyApprove':    return handleBuddyApprove(srv, db, peerId, msg);
    case 'buddyDeny':       return handleBuddyDeny(srv, db, peerId, msg);
    case 'roomCreate':      return handleRoomCreate(srv, db, peerId, msg);
    case 'roomInvite':      return handleRoomInvite(srv, db, peerId, msg);
    case 'roomMsg':         return handleRoomMsg(srv, db, peerId, msg);
    case 'roomChannelAdd':  return handleRoomChannelAdd(srv, db, peerId, msg);
    case 'getHistory':      return handleGetHistory(srv, db, peerId, msg);
    case 'getRoomHistory':  return handleGetRoomHistory(srv, db, peerId, msg);
    case 'talkSignal':      return handleTalkSignal(srv, peerId, msg);
    case 'gameSignal':      return handleGameSignal(srv, peerId, msg);
    default:
      // Exhaustiveness guard — unknown message type, ignore silently.
      break;
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function handleAuth(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliAuth,
): void {
  repos.upsertUser(db, peerId, msg.screenName, msg.pubKeyB64);
  repos.setUserStatus(db, peerId, 'online');

  const buddies = repos.listBuddyEntries(db, peerId);
  const pendingRequests = repos.listBuddyRequests(db, peerId);

  // Collect pubkeys for all buddies so client can seal messages.
  const pubKeys: Record<string, string> = {};
  for (const b of buddies) {
    const pk = repos.getPubKey(db, b.peerId);
    if (pk) pubKeys[b.peerId] = pk;
  }

  srv.send(peerId, {
    type: 'authed',
    peerId,
    buddyList: buddies,
    pendingRequests,
    pubKeys,
  });

  // Deliver unread messages.
  const undelivered = repos.listUndelivered(db, peerId);
  for (const m of undelivered) {
    srv.send(peerId, {
      type: 'im',
      from: m.from,
      msgId: m.msgId,
      ts: m.ts,
      cipherB64: m.cipherB64,
    });
  }

  // Notify buddies that this peer came online.
  const buddyIds = repos.listBuddyPeerIds(db, peerId);
  srv.broadcastToMany(buddyIds, {
    type: 'presenceUpdate',
    peerId,
    status: 'online',
  });
}

// ── Presence ──────────────────────────────────────────────────────────────────

function handleSetStatus(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliSetStatus,
): void {
  repos.setUserStatus(db, peerId, msg.status, msg.awayMessage);
  const buddyIds = repos.listBuddyPeerIds(db, peerId);
  srv.broadcastToMany(buddyIds, {
    type: 'presenceUpdate',
    peerId,
    status: msg.status,
    awayMessage: msg.awayMessage,
  });
}

function handleDisconnect(srv: HiveServer, db: Db, peerId: string): void {
  repos.setUserStatus(db, peerId, 'offline');
  const buddyIds = repos.listBuddyPeerIds(db, peerId);
  srv.broadcastToMany(buddyIds, { type: 'presenceUpdate', peerId, status: 'offline' });
}

// ── 1:1 IM ───────────────────────────────────────────────────────────────────

function handleIm(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliIm,
): void {
  const isOnline = srv.connectedPeerIds.includes(msg.to);
  repos.insertMessage(db, msg.msgId, peerId, msg.to, msg.ts, msg.cipherB64, isOnline);

  if (isOnline) {
    srv.send(msg.to, {
      type: 'im',
      from: peerId,
      msgId: msg.msgId,
      ts: msg.ts,
      cipherB64: msg.cipherB64,
    });
  }
}

function handleAck(
  srv: HiveServer,
  db: Db,
  _peerId: string,
  msg: import('@shared/types.js').CliAck,
): void {
  repos.markMessageDelivered(db, msg.msgId);
}

// ── Buddy management ──────────────────────────────────────────────────────────

function handleBuddyAdd(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliBuddyAdd,
): void {
  if (repos.areBuddies(db, peerId, msg.targetPeerId)) return;

  // If the other peer already sent us a request — auto-approve.
  if (repos.hasBuddyRequest(db, msg.targetPeerId, peerId)) {
    repos.deleteBuddyRequest(db, msg.targetPeerId, peerId);
    repos.addBuddyRelationship(db, peerId, msg.targetPeerId);

    const selfUser = repos.getUser(db, peerId);
    const targetUser = repos.getUser(db, msg.targetPeerId);

    // Tell both parties about each other.
    if (selfUser && targetUser) {
      srv.send(peerId, {
        type: 'buddyResponse',
        peerId: msg.targetPeerId,
        accepted: true,
        screenName: targetUser.screenName,
      });
      srv.send(msg.targetPeerId, {
        type: 'buddyResponse',
        peerId,
        accepted: true,
        screenName: selfUser.screenName,
      });
    }
    return;
  }

  // Otherwise record a pending request.
  repos.insertBuddyRequest(db, peerId, msg.targetPeerId);

  const selfUser = repos.getUser(db, peerId);
  if (selfUser) {
    srv.send(msg.targetPeerId, {
      type: 'buddyRequest',
      from: peerId,
      screenName: selfUser.screenName,
    });
  }
}

function handleBuddyApprove(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliBuddyApprove,
): void {
  if (!repos.hasBuddyRequest(db, msg.targetPeerId, peerId)) return;

  repos.deleteBuddyRequest(db, msg.targetPeerId, peerId);
  repos.addBuddyRelationship(db, peerId, msg.targetPeerId);

  const selfUser = repos.getUser(db, peerId);
  const targetUser = repos.getUser(db, msg.targetPeerId);

  if (selfUser) {
    srv.send(msg.targetPeerId, {
      type: 'buddyResponse',
      peerId,
      accepted: true,
      screenName: selfUser.screenName,
    });
  }
  if (targetUser) {
    srv.send(peerId, {
      type: 'buddyResponse',
      peerId: msg.targetPeerId,
      accepted: true,
      screenName: targetUser.screenName,
    });
  }
}

function handleBuddyDeny(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliBuddyDeny,
): void {
  repos.deleteBuddyRequest(db, msg.targetPeerId, peerId);
  srv.send(msg.targetPeerId, {
    type: 'buddyResponse',
    peerId,
    accepted: false,
    screenName: '',
  });
}

function handleBuddyRemove(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliBuddyRemove,
): void {
  repos.removeBuddyRelationship(db, peerId, msg.targetPeerId);
}

// ── Room management ───────────────────────────────────────────────────────────

function handleRoomCreate(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliRoomCreate,
): void {
  repos.createRoom(db, msg.roomId, msg.name, peerId);

  // Default #general channel.
  const defaultChannelId = `${msg.roomId}:general`;
  repos.addRoomChannel(db, defaultChannelId, msg.roomId, 'general', 'text');

  // Add all founding members with their key envelopes.
  for (const env of msg.keyEnvelopes) {
    repos.addRoomMember(db, msg.roomId, env.peerId, env.cipherB64);
  }

  const channels = repos.listRoomChannels(db, msg.roomId);
  const allMemberIds = msg.keyEnvelopes.map((e) => e.peerId);

  // Send room invite to every member (including creator).
  for (const env of msg.keyEnvelopes) {
    srv.send(env.peerId, {
      type: 'roomInvite',
      roomId: msg.roomId,
      name: msg.name,
      from: peerId,
      keyEnvelopeB64: env.cipherB64,
      channels,
      members: allMemberIds,
    });
  }
}

function handleRoomInvite(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliRoomInvite,
): void {
  if (!repos.isRoomMember(db, msg.roomId, peerId)) return;
  if (repos.isRoomMember(db, msg.roomId, msg.targetPeerId)) return;

  repos.addRoomMember(db, msg.roomId, msg.targetPeerId, msg.keyEnvelopeB64);

  const room = repos.getRoom(db, msg.roomId);
  const channels = repos.listRoomChannels(db, msg.roomId);
  const allMemberIds = repos.listRoomMembers(db, msg.roomId).map((m) => m.peerId);

  if (room) {
    srv.send(msg.targetPeerId, {
      type: 'roomInvite',
      roomId: msg.roomId,
      name: room.name,
      from: peerId,
      keyEnvelopeB64: msg.keyEnvelopeB64,
      channels,
      members: allMemberIds,
    });
  }

  // Notify existing members about the new member.
  const inviterUser = repos.getUser(db, msg.targetPeerId);
  const existingIds = allMemberIds.filter((id) => id !== msg.targetPeerId);
  if (inviterUser) {
    srv.broadcastToMany(existingIds, {
      type: 'roomMemberJoin',
      roomId: msg.roomId,
      peerId: msg.targetPeerId,
      screenName: inviterUser.screenName,
    });
  }
}

function handleRoomMsg(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliRoomMsg,
): void {
  if (!repos.isRoomMember(db, msg.roomId, peerId)) return;

  repos.insertRoomMessage(db, msg.msgId, msg.roomId, msg.channelId, peerId, msg.ts, msg.cipherB64);

  const memberIds = repos.listRoomMembers(db, msg.roomId).map((m) => m.peerId);
  srv.broadcastToMany(memberIds, {
    type: 'roomMsg',
    roomId: msg.roomId,
    channelId: msg.channelId,
    from: peerId,
    msgId: msg.msgId,
    ts: msg.ts,
    cipherB64: msg.cipherB64,
  });
}

function handleRoomChannelAdd(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliRoomChannelAdd,
): void {
  if (!repos.isRoomMember(db, msg.roomId, peerId)) return;
  repos.addRoomChannel(db, msg.channelId, msg.roomId, msg.name, msg.kind);
}

// ── History ───────────────────────────────────────────────────────────────────

function handleGetHistory(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliGetHistory,
): void {
  const messages = repos.listHistory(db, peerId, msg.peerId, msg.before, msg.limit);
  srv.send(peerId, { type: 'history', peerId: msg.peerId, messages });
}

function handleGetRoomHistory(
  srv: HiveServer,
  db: Db,
  peerId: string,
  msg: import('@shared/types.js').CliGetRoomHistory,
): void {
  if (!repos.isRoomMember(db, msg.roomId, peerId)) return;
  const messages = repos.listRoomHistory(db, msg.roomId, msg.channelId, msg.before, msg.limit);
  srv.send(peerId, { type: 'roomHistory', roomId: msg.roomId, channelId: msg.channelId, messages });
}

// ── Talk signalling ──────────────────────────────────────────────────────────

function handleTalkSignal(
  srv: HiveServer,
  peerId: string,
  msg: import('@shared/types.js').CliTalkSignal,
): void {
  srv.send(msg.to, {
    type: 'talkSignal',
    from: peerId,
    callId: msg.callId,
    signal: msg.signal,
    payload: msg.payload,
  });
}

function handleGameSignal(
  srv: HiveServer,
  peerId: string,
  msg: import('@shared/types.js').CliGameSignal,
): void {
  srv.send(msg.to, {
    type: 'gameSignal',
    from: peerId,
    action: msg.action,
    kind: msg.kind,
    ...(msg.path ? { path: msg.path } : {}),
  });
}

/**
 * Binary voice/video relay.
 *
 * Frame format:
 *   [1 byte type: 0xA1=audio, 0xA2=video]
 *   [2 bytes LE: toPeerId length]
 *   [toPeerId UTF-8]
 *   [2 bytes LE: callId length]
 *   [callId UTF-8]
 *   [remaining bytes: encrypted media payload]
 */
function handleBinaryFrame(srv: HiveServer, buf: Buffer): void {
  if (buf.length < 3) return;
  const type = buf[0];
  if (type !== 0xa1 && type !== 0xa2) return;

  let offset = 1;
  if (buf.length < offset + 2) return;
  const peerIdLen = buf.readUInt16LE(offset);
  offset += 2;
  if (buf.length < offset + peerIdLen) return;
  const toPeerId = buf.subarray(offset, offset + peerIdLen).toString('utf8');
  offset += peerIdLen;

  if (buf.length < offset + 2) return;
  const callIdLen = buf.readUInt16LE(offset);
  offset += 2;
  if (buf.length < offset + callIdLen) return;
  offset += callIdLen;

  // Relay the entire original buffer to the target (includes type + routing header +
  // encrypted payload). The recipient's HiveClient will parse it the same way.
  srv.sendBinary(toPeerId, buf);
}
