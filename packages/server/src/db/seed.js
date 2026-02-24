import pg from 'pg';
import config from '../config.js';
import { generateSecretKey, generatePublicKey, hashApiKey } from '../utils/token.js';

const { Pool } = pg;

/**
 * Creates a demo tenant and prints the API keys.
 * Run once before the demo: npm run db:seed
 */
async function seed() {
  const pool = new Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl,
  });

  // On first deploy: generated randomly and printed.
  // On subsequent deploys: set DEMO_SECRET_KEY + DEMO_PUBLIC_KEY as env vars so
  // the same keys (and their hashes in the DB) survive re-deploys.
  const secretKey = process.env.DEMO_SECRET_KEY || generateSecretKey();
  const publicKey = process.env.DEMO_PUBLIC_KEY || generatePublicKey();

  try {
    const result = await pool.query(
      `INSERT INTO tenants (name, secret_key_hash, public_key_hash, allowed_domains, masking_rules)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id, name`,
      [
        'Demo Tenant (Insurance)',
        hashApiKey(secretKey),
        hashApiKey(publicKey),
        ['localhost', 'localhost:3001', '127.0.0.1', '127.0.0.1:3001', '*'],
        JSON.stringify({
          selectors: [
            'input[name="card"]',
            'input[name="cvv"]',
            'input[name="otp"]',
            '#card-number',
            '#cvv-code',
          ],
          maskTypes: ['password', 'tel'],
          patterns: [],
        }),
      ]
    );

    if (result.rowCount === 0) {
      console.log('Demo tenant already exists. Skipping seed.');
      return;
    }

    const tenant = result.rows[0];

    console.log('\n───────────────────────────────────────────────────');
    console.log('  CoBrowse Demo Tenant Created');
    console.log('───────────────────────────────────────────────────');
    console.log(`  Tenant ID   : ${tenant.id}`);
    console.log(`  Name        : ${tenant.name}`);
    console.log('');
    console.log('  ⚠️  These keys are shown ONCE. Copy them now.');
    console.log('');
    console.log(`  SECRET KEY  : ${secretKey}`);
    console.log(`  (used by the agent app and server-to-server calls)`);
    console.log('');
    console.log(`  PUBLIC KEY  : ${publicKey}`);
    console.log(`  (embedded in the customer-app SDK config)`);
    console.log('───────────────────────────────────────────────────');
    console.log('');
    console.log('  Next steps (local dev):');
    console.log('  1. Copy SECRET KEY → packages/agent-app/app.js  (CONFIG.secretKey)');
    console.log('  2. Copy PUBLIC KEY → packages/customer-app/app.js  (CONFIG.publicKey)');
    console.log('  3. Run: npm start');
    console.log('');
    console.log('  Next steps (Railway / hosted demo):');
    console.log('  Set these env vars in your hosting provider, then redeploy:');
    console.log(`  DEMO_SECRET_KEY = ${secretKey}`);
    console.log(`  DEMO_PUBLIC_KEY = ${publicKey}`);
    console.log('');
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
