// Hive IPC channel constants (main ↔ renderer).
export const HiveGetStats    = 'hive:getStats';
export const HiveGetUsers    = 'hive:getUsers';
export const HiveGetRooms    = 'hive:getRooms';
export const HiveGetConfig   = 'hive:getConfig';
export const HiveSetConfig   = 'hive:setConfig';
export const HiveStart       = 'hive:start';
export const HiveStop        = 'hive:stop';
export const EvtHiveStatus   = 'hive:evtStatus'; // main→renderer push
