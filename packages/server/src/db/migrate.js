'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

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
    console.log('✓ Migration complete');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
