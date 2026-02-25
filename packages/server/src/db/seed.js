import pg from 'pg';
import crypto from 'node:crypto';
import config from '../config.js';
import { generateSecretKey, generatePublicKey, hashApiKey } from '../utils/token.js';

const { Pool } = pg;

/**
 * Creates a demo tenant, demo vendor, and vendor user, then prints the API keys.
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
        ['localhost', 'localhost:3001', 'localhost:3002', 'localhost:4000', '127.0.0.1', '127.0.0.1:3001'],
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

    let tenantId;
    let tenantCreated = false;

    if (result.rowCount === 0) {
      // Tenant already exists — look up its ID for vendor linking
      const existing = await pool.query(
        `SELECT id FROM tenants WHERE secret_key_hash = $1`,
        [hashApiKey(secretKey)]
      );
      tenantId = existing.rows[0]?.id;
      console.log('Demo tenant already exists. Skipping tenant seed.');
    } else {
      tenantId = result.rows[0].id;
      tenantCreated = true;
    }

    // ─── Seed demo vendor + vendor user ───────────────────────────────────────
    const vendorResult = await pool.query(
      `INSERT INTO vendors (name, contact_email)
       VALUES ($1, $2)
       ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['Demo Vendor', 'admin@demo-vendor.com']
    );
    const vendorId = vendorResult.rows[0].id;

    // Link demo tenant to vendor
    if (tenantId) {
      await pool.query(
        `UPDATE tenants SET vendor_id = $1 WHERE id = $2`,
        [vendorId, tenantId]
      );
    }

    // Seed vendor user (admin)
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash('cobrowse123', 12);

    await pool.query(
      `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [vendorId, 'admin@demo-vendor.com', passwordHash, 'Demo Admin', 'admin']
    );

    // Only print keys in local development — never in production/CI logs
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

    if (tenantCreated) {
      console.log('\n───────────────────────────────────────────────────');
      console.log('  CoBrowse Demo Tenant Created');
      console.log('───────────────────────────────────────────────────');
      console.log(`  Tenant ID   : ${tenantId}`);
      console.log(`  Vendor ID   : ${vendorId}`);

      if (isProduction) {
        console.log('');
        console.log('  Keys generated but NOT printed (production mode).');
        console.log('  Set DEMO_SECRET_KEY and DEMO_PUBLIC_KEY env vars and redeploy.');
      } else {
        console.log('');
        console.log('  These keys are shown ONCE. Copy them now.');
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
      }
    }

    console.log('');
    console.log('  Portal login: admin@demo-vendor.com / cobrowse123');
    console.log('  Portal URL  : http://localhost:4000/portal/login');
    console.log('');
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
