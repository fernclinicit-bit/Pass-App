const fs = require('fs');
const path = require('path');

// Server settings that admins save from the web app: the Lark/LINE account menus and the
// channel credentials entered on the settings page. Without DATABASE_URL they live in
// data/config.json (the original behaviour). With DATABASE_URL they live in PostgreSQL so
// they survive restarts and redeploys on hosts with a temporary filesystem (Render Free).

function readConfigFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    console.error('Error reading config.json:', error);
    return {};
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class LocalConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.persistent = false;
    this.loaded = true;
  }

  async load() {
    return this.getSync();
  }

  // Re-read the file every time, exactly like the server did before this store existed.
  getSync() {
    return readConfigFile(this.filePath);
  }

  async update(mutate) {
    const next = this.getSync();
    mutate(next);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2));
    return next;
  }
}

class PostgresConfigStore {
  constructor(pool, { seedFile = '' } = {}) {
    this.pool = pool;
    this.seedFile = seedFile;
    this.persistent = true;
    this.loaded = false;
    this.ready = null;
    this.cache = {};
    this.queue = Promise.resolve();
  }

  ensureSchema() {
    if (!this.ready) {
      this.ready = this.pool.query(`
        CREATE TABLE IF NOT EXISTS passly_server_config (
          singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  async write(config) {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO passly_server_config (singleton_id, config, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (singleton_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      [JSON.stringify(config)],
    );
  }

  // Load once at startup. On an empty table, carry over anything already in config.json.
  async load() {
    await this.ensureSchema();
    const result = await this.pool.query('SELECT config FROM passly_server_config WHERE singleton_id = 1');
    if (result.rows[0]) {
      this.cache = isPlainObject(result.rows[0].config) ? result.rows[0].config : {};
    } else {
      const seed = this.seedFile ? readConfigFile(this.seedFile) : {};
      if (Object.keys(seed).length) await this.write(seed);
      this.cache = seed;
    }
    this.loaded = true;
    return this.getSync();
  }

  getSync() {
    return structuredClone(this.cache);
  }

  // Saves run one at a time so two admin saves cannot overwrite each other's fields.
  update(mutate) {
    const run = this.queue.then(async () => {
      if (!this.loaded) await this.load();
      const next = this.getSync();
      mutate(next);
      await this.write(next);
      this.cache = next;
      return this.getSync();
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function createConfigStore(databaseUrl = process.env.DATABASE_URL, filePath) {
  if (!databaseUrl) return new LocalConfigStore(filePath);
  const { Pool } = require('pg');
  return new PostgresConfigStore(new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  }), { seedFile: filePath });
}

module.exports = {
  LocalConfigStore,
  PostgresConfigStore,
  createConfigStore,
};
