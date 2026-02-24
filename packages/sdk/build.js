#!/usr/bin/env node
'use strict';

/**
 * SDK build script.
 *
 * Bundles the SDK + rrweb + Ably browser client into a single JS file
 * that clients embed via a <script> tag.
 *
 * Output: packages/server/public/sdk/cobrowse.js
 *         packages/server/public/sdk/cobrowse.min.js
 *
 * Usage:
 *   node build.js           — single build
 *   node build.js --watch   — watch mode (development)
 */

const esbuild = require('esbuild');
const path    = require('path');
const fs      = require('fs');

const isWatch = process.argv.includes('--watch');

const outDir = path.resolve(__dirname, '../server/public/sdk');
fs.mkdirSync(outDir, { recursive: true });

const sharedOptions = {
  entryPoints: [path.resolve(__dirname, 'src/index.js')],
  bundle:      true,
  platform:    'browser',
  globalName:  'CoBrowse',
  // External: don't bundle rrweb if already on page (allows clients to deduplicate)
  // Comment this line to produce a fully self-contained bundle:
  // external: ['rrweb'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  footer: {
    // Expose as both global and ES module default
    js: 'if (typeof module !== "undefined") module.exports = CoBrowse;',
  },
};

async function build() {
  // Development build (readable, sourcemaps)
  await esbuild.build({
    ...sharedOptions,
    outfile:    path.join(outDir, 'cobrowse.js'),
    minify:     false,
    sourcemap:  true,
  });

  // Production build (minified)
  await esbuild.build({
    ...sharedOptions,
    outfile:    path.join(outDir, 'cobrowse.min.js'),
    minify:     true,
    sourcemap:  false,
  });

  const stat = fs.statSync(path.join(outDir, 'cobrowse.min.js'));
  console.log(`✓ SDK built → ${outDir}`);
  console.log(`  cobrowse.js      (dev, with sourcemaps)`);
  console.log(`  cobrowse.min.js  (${Math.round(stat.size / 1024)}KB minified)`);
}

async function watch() {
  const ctx = await esbuild.context({
    ...sharedOptions,
    outfile:   path.join(outDir, 'cobrowse.js'),
    minify:    false,
    sourcemap: true,
    plugins: [{
      name: 'rebuild-notify',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) {
            console.error('Build failed:', result.errors);
          } else {
            console.log(`[${new Date().toLocaleTimeString()}] SDK rebuilt`);
          }
        });
      },
    }],
  });
  await ctx.watch();
  console.log('Watching SDK for changes…');
}

if (isWatch) {
  watch().catch(console.error);
} else {
  build().catch((err) => { console.error(err); process.exit(1); });
}
