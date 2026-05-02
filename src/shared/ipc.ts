// Hive IPC channel constants (main ↔ renderer).
export const HiveGetStats    = 'hive:getStats';
export const HiveGetUsers    = 'hive:getUsers';
export const HiveGetRooms    = 'hive:getRooms';
export const HiveGetConfig   = 'hive:getConfig';
export const HiveSetConfig   = 'hive:setConfig';
export const HiveStart       = 'hive:start';
export const HiveStop        = 'hive:stop';
export const EvtHiveStatus   = 'hive:evtStatus'; // main→renderer push

// Admin actions
export const HiveKickUser    = 'hive:kickUser';   // disconnect a peer
export const HiveBanUser     = 'hive:banUser';    // ban + kick
export const HiveUnbanUser   = 'hive:unbanUser';  // lift ban
export const HiveDeleteUser  = 'hive:deleteUser'; // remove account from DB
export const HiveAnnounce    = 'hive:announce';   // broadcast message to all peers
export const HiveGetBanned   = 'hive:getBanned';  // list banned users
