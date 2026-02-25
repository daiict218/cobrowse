import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import config from '../config.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  const pool = new Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl,
  });

  try {
    console.log('Running database migration…');
    const schema = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );
    await pool.query(schema);
    console.log('✓ Schema applied');

    // Run incremental migration files in order
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await pool.query(sql);
        console.log(`  ✓ ${file}`);
      }
    }

    console.log('✓ Migration complete');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
