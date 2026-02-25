/**
 * Railway startup script — runs migration + seed as child processes,
 * then starts the server in the same process.
 *
 * Railway expects PID 1 to stay alive. Shell `&&` chains spawn separate
 * Node processes that exit, which Railway's process manager can misinterpret
 * as a crash. This script keeps a single long-running process.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run migration (idempotent)
try {
  console.log('=== Running migration ===');
  execFileSync('node', [path.join(__dirname, 'db', 'migrate.js')], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}

// Run seed (idempotent)
try {
  console.log('=== Running seed ===');
  execFileSync('node', [path.join(__dirname, 'db', 'seed.js')], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}

// Start the server (in this process — keeps PID 1 alive)
console.log('=== Starting server ===');
await import('./server.js');
