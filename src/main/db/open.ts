import Database from 'better-sqlite3';
import { SCHEMA_SQL, CURRENT_VERSION } from './schema.js';

export type Db = InstanceType<typeof Database>;

export function openDb(filePath: string): Db {
  const db = new Database(filePath);

  // Performance pragmas.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -32000'); // 32 MB

  // Apply schema idempotently.
  db.exec(SCHEMA_SQL);

  // Run migrations.
  migrate(db);

  return db;
}

function migrate(db: Db): void {
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const current = row?.version ?? 0;

  if (current < 2) {
    // Add encrypted_keystore and registered_at columns to users if they don't exist yet.
    // ALTER TABLE ADD COLUMN is a no-op if the column already exists in SQLite >= 3.37
    // but older versions throw, so we check first.
    const cols = (db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    if (!cols.includes('encrypted_keystore')) {
      db.exec('ALTER TABLE users ADD COLUMN encrypted_keystore TEXT');
    }
    if (!cols.includes('registered_at')) {
      db.exec('ALTER TABLE users ADD COLUMN registered_at INTEGER');
    }
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run();
  }

  if (current < 3) {
    // banned_users table is created by SCHEMA_SQL (CREATE TABLE IF NOT EXISTS).
    // No DDL needed here — just stamp the version.
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (3)').run();
  }

  if (current < 4) {
    // reactions table is created by SCHEMA_SQL (CREATE TABLE IF NOT EXISTS).
    // No DDL needed here — just stamp the version.
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (4)').run();
  }

  if (current < 5) {
    // Add category column to room_channels for channel grouping (v0.6.0).
    const cols = (db.prepare(`PRAGMA table_info(room_channels)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    if (!cols.includes('category')) {
      db.exec("ALTER TABLE room_channels ADD COLUMN category TEXT NOT NULL DEFAULT ''");
    }
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (5)').run();
  }
}
