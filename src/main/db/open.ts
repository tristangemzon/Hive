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

  if (current < CURRENT_VERSION) {
    // Future migrations go here as: if (current < N) { ... db.pragma or ALTER TABLE; }
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(CURRENT_VERSION);
  }
}
