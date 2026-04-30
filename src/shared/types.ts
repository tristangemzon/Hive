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
};
export type SrvRoomMsg = {
  type: 'roomMsg';
  roomId: string;
  channelId: string;
  from: string;
  msgId: string;
  ts: number;
  cipherB64: string;
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
export type SrvRoomMemberJoin = { type: 'roomMemberJoin'; roomId: string; peerId: string; screenName: string };
export type SrvRoomMemberLeave = { type: 'roomMemberLeave'; roomId: string; peerId: string };

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
  | SrvRoomMemberJoin
  | SrvRoomMemberLeave;

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
};
export type CliGetHistory = { type: 'getHistory'; peerId: string; before?: number; limit?: number };
export type CliGetRoomHistory = { type: 'getRoomHistory'; roomId: string; channelId: string; before?: number; limit?: number };
export type CliRoomChannelAdd = { type: 'roomChannelAdd'; roomId: string; channelId: string; name: string; kind: 'text' | 'voice' };
// Talk signalling — relayed as-is to target peer
export type CliTalkSignal = { type: 'talkSignal'; to: string; callId: string; signal: string; payload: unknown };

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
  | CliTalkSignal;

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
};

// ── IPC types (Hive main ↔ renderer dashboard) ──────────────────────────────

export type HiveConfig = {
  port: number;
  certPath: string;   // empty = auto-generated self-signed
  keyPath: string;
};

export type HiveStats = {
  running: boolean;
  port: number;
  address: string;
  connectedUsers: number;
  totalUsers: number;
  totalRooms: number;
  totalMessages: number;
};

export type HiveUser = {
  peerId: string;
  screenName: string;
  status: UserStatus;
  connected: boolean;
  lastSeen: number;
};

export type HiveRoom = {
  id: string;
  name: string;
  memberCount: number;
  messageCount: number;
};
