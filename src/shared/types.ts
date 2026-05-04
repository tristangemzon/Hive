// Shared protocol types between Hive main process and the renderer dashboard.
// Also used by the Buzz HiveClient to serialize/deserialize messages.

// ── Server → Client messages ────────────────────────────────────────────────

export type SrvChallenge = { type: 'challenge'; nonce: string };
export type SrvAuthed = {
  type: 'authed';
  peerId: string;
  buddyList: BuddyEntry[];
  pendingRequests: BuddyRequest[];
  // pubkeys for all buddies (needed by client for sealing messages)
  pubKeys: Record<string, string>; // peerId → base64 ed25519 pubkey
};
export type SrvPresenceUpdate = { type: 'presenceUpdate'; peerId: string; status: UserStatus; awayMessage?: string };
export type SrvIm = { type: 'im'; from: string; msgId: string; ts: number; cipherB64: string };
export type SrvBuddyRequest = { type: 'buddyRequest'; from: string; screenName: string };
export type SrvBuddyResponse = { type: 'buddyResponse'; peerId: string; accepted: boolean; screenName: string };
export type SrvRoomInvite = {
  type: 'roomInvite';
  roomId: string;
  name: string;
  from: string;
  keyEnvelopeB64: string; // room key sealed to recipient's X25519 pubkey
  channels: ChannelEntry[];
  members: string[];
  ownerPeerId?: string; // v0.6.0: peerId of the room owner for role enforcement
};
export type SrvRoomMsg = {
  type: 'roomMsg';
  roomId: string;
  channelId: string;
  from: string;
  msgId: string;
  ts: number;
  cipherB64: string;
  // v0.6.0: metadata relayed alongside the encrypted body
  fromName?: string;
  replyToId?: string;
  mentions?: string[];
};
export type SrvHistory = {
  type: 'history';
  peerId: string;
  messages: Array<{ msgId: string; from: string; ts: number; cipherB64: string }>;
};
export type SrvRoomHistory = {
  type: 'roomHistory';
  roomId: string;
  channelId: string;
  messages: Array<{ msgId: string; from: string; ts: number; cipherB64: string }>;
};
export type SrvBuddyList = {
  type: 'buddyList';
  buddies: BuddyEntry[];
  pubKeys: Record<string, string>;
};
export type SrvRoomList = { type: 'roomList'; rooms: RoomEntry[] };
export type SrvError = { type: 'error'; code: string; message: string };

// Talk signalling relayed as-is (server never reads payload)
export type SrvTalkSignal = { type: 'talkSignal'; from: string; callId: string; signal: string; payload: unknown };
// Game signalling relayed as-is (server never reads payload)
export type SrvGameSignal = { type: 'gameSignal'; from: string; action: string; kind: string; path?: number[] };
export type SrvRoomMemberJoin = { type: 'roomMemberJoin'; roomId: string; peerId: string; screenName: string };
export type SrvRoomMemberLeave = { type: 'roomMemberLeave'; roomId: string; peerId: string };
// Server-originated announcement (MOTD on connect, or admin broadcast).
export type SrvAnnounce = { type: 'announce'; text: string; ts: number };
// 1:1 reaction relay. added=true → emoji added; added=false → emoji removed.
// Stored for offline delivery (same as SrvIm).
export type SrvReaction = { type: 'reaction'; from: string; msgId: string; emoji: string; added: boolean };
// Room reaction relay — relay-only, not stored.
export type SrvRoomReaction = { type: 'roomReaction'; roomId: string; from: string; msgId: string; emoji: string; added: boolean };
// Ephemeral typing indicator — relayed only if recipient is online.
export type SrvTyping = { type: 'typing'; from: string; typing: boolean };
// Read receipt — relayed only if recipient is online.
export type SrvReadReceipt = { type: 'readReceipt'; from: string; msgId: string };
// v0.6.0 room moderation — relayed to all online room members.
export type SrvRoomPin = { type: 'roomPin'; roomId: string; from: string; msgId: string; isPinned: boolean };
export type SrvRoomKick = { type: 'roomKick'; roomId: string; from: string; peerId: string };
export type SrvRoomRole = { type: 'roomRole'; roomId: string; from: string; peerId: string; role: string };
export type SrvRoomCategory = { type: 'roomCategory'; roomId: string; channelId: string; category: string };
// Room channel add — broadcast to all members when a channel is created.
export type SrvRoomChannelAdd = { type: 'roomChannelAdd'; roomId: string; channelId: string; name: string; kind: 'text' | 'voice' };

export type ServerMessage =
  | SrvChallenge
  | SrvAuthed
  | SrvPresenceUpdate
  | SrvIm
  | SrvBuddyRequest
  | SrvBuddyResponse
  | SrvRoomInvite
  | SrvRoomMsg
  | SrvHistory
  | SrvRoomHistory
  | SrvBuddyList
  | SrvRoomList
  | SrvError
  | SrvTalkSignal
  | SrvGameSignal
  | SrvRoomMemberJoin
  | SrvRoomMemberLeave
  | SrvAnnounce
  | SrvReaction
  | SrvRoomReaction
  | SrvTyping
  | SrvReadReceipt
  | SrvRoomPin
  | SrvRoomKick
  | SrvRoomRole
  | SrvRoomCategory
  | SrvRoomChannelAdd;

// ── Client → Server messages ────────────────────────────────────────────────

export type CliAuth = {
  type: 'auth';
  peerId: string;
  screenName: string;
  pubKeyB64: string;   // ed25519 public key (base64)
  sigB64: string;      // signature of nonce (base64)
};
export type CliSetStatus = { type: 'setStatus'; status: UserStatus; awayMessage?: string };
export type CliIm = { type: 'im'; to: string; msgId: string; ts: number; cipherB64: string };
export type CliAck = { type: 'ack'; msgId: string };
export type CliBuddyAdd = { type: 'buddyAdd'; targetPeerId: string };
export type CliBuddyRemove = { type: 'buddyRemove'; targetPeerId: string };
export type CliBuddyApprove = { type: 'buddyApprove'; targetPeerId: string };
export type CliBuddyDeny = { type: 'buddyDeny'; targetPeerId: string };
export type CliRoomCreate = {
  type: 'roomCreate';
  roomId: string;
  name: string;
  // room key sealed to each member's X25519 pubkey, keyed by peerId
  keyEnvelopes: Array<{ peerId: string; cipherB64: string }>;
  memberPeerIds: string[];
};
export type CliRoomInvite = {
  type: 'roomInvite';
  roomId: string;
  targetPeerId: string;
  keyEnvelopeB64: string;
};
export type CliRoomMsg = {
  type: 'roomMsg';
  roomId: string;
  channelId: string;
  msgId: string;
  ts: number;
  cipherB64: string;
  // v0.6.0: metadata alongside the encrypted body
  fromName?: string;
  replyToId?: string;
  mentions?: string[];
};
export type CliGetHistory = { type: 'getHistory'; peerId: string; before?: number; limit?: number };
export type CliGetRoomHistory = { type: 'getRoomHistory'; roomId: string; channelId: string; before?: number; limit?: number };
export type CliRoomChannelAdd = { type: 'roomChannelAdd'; roomId: string; channelId: string; name: string; kind: 'text' | 'voice' };
// Talk signalling — relayed as-is to target peer
export type CliTalkSignal = { type: 'talkSignal'; to: string; callId: string; signal: string; payload: unknown };
// Game signalling — relayed as-is to target peer
export type CliGameSignal = { type: 'gameSignal'; to: string; action: string; kind: string; path?: number[] };
// 1:1 reactions — stored for offline delivery
export type CliReaction = { type: 'reaction'; to: string; msgId: string; emoji: string };
export type CliUnreaction = { type: 'unreaction'; to: string; msgId: string; emoji: string };
// Room reactions — relayed to online members only (not stored)
export type CliRoomReaction = { type: 'roomReaction'; roomId: string; msgId: string; emoji: string };
export type CliRoomUnreaction = { type: 'roomUnreaction'; roomId: string; msgId: string; emoji: string };
// Ephemeral typing indicator — relay-only
export type CliTyping = { type: 'typing'; to: string; typing: boolean };
// Read receipt — relay-only
export type CliReadReceipt = { type: 'readReceipt'; to: string; msgId: string };
// v0.6.0 room moderation — relayed to all room members.
export type CliRoomPin = { type: 'roomPin'; roomId: string; msgId: string; isPinned: boolean };
export type CliRoomKick = { type: 'roomKick'; roomId: string; peerId: string };
export type CliRoomRole = { type: 'roomRole'; roomId: string; peerId: string; role: string };
export type CliRoomCategory = { type: 'roomCategory'; roomId: string; channelId: string; category: string };

export type ClientMessage =
  | CliAuth
  | CliSetStatus
  | CliIm
  | CliAck
  | CliBuddyAdd
  | CliBuddyRemove
  | CliBuddyApprove
  | CliBuddyDeny
  | CliRoomCreate
  | CliRoomInvite
  | CliRoomMsg
  | CliGetHistory
  | CliGetRoomHistory
  | CliRoomChannelAdd
  | CliTalkSignal
  | CliGameSignal
  | CliReaction
  | CliUnreaction
  | CliRoomReaction
  | CliRoomUnreaction
  | CliTyping
  | CliReadReceipt
  | CliRoomPin
  | CliRoomKick
  | CliRoomRole
  | CliRoomCategory;

// ── Shared entity types ──────────────────────────────────────────────────────

export type UserStatus = 'online' | 'away' | 'idle' | 'invisible' | 'offline';

export type BuddyEntry = {
  peerId: string;
  screenName: string;
  status: UserStatus;
  awayMessage?: string;
};

export type BuddyRequest = {
  peerId: string;
  screenName: string;
  direction: 'in' | 'out';
  createdAt: number;
};

export type RoomEntry = {
  id: string;
  name: string;
  members: string[];
  channels: ChannelEntry[];
};

export type ChannelEntry = {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  category?: string;
};

// ── IPC types (Hive main ↔ renderer dashboard) ──────────────────────────────

export type HiveConfig = {
  port: number;
  certPath: string;   // empty = auto-generated self-signed
  keyPath: string;
  motd?: string;             // message of the day sent to clients on connect
  registrationOpen?: boolean; // false = reject new registrations
};

export type HiveStats = {
  running: boolean;
  port: number;
  address: string;
  connectedUsers: number;
  totalUsers: number;
  totalRooms: number;
  totalMessages: number;
  undeliveredMessages: number;
  bannedUsers: number;
};

export type HiveUser = {
  peerId: string;
  screenName: string;
  status: UserStatus;
  connected: boolean;
  lastSeen: number;
  banned: boolean;
};

export type HiveBannedUser = {
  peerId: string;
  screenName: string;
  bannedAt: number;
  reason: string;
};

export type HiveRoom = {
  id: string;
  name: string;
  memberCount: number;
  messageCount: number;
  textChannels: number;
  voiceChannels: number;
};
