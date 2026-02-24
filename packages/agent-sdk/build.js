#!/usr/bin/env node

/**
 * Agent SDK build script.
 *
 * Bundles the Agent SDK into a single JS file for browser use.
 *
 * Output: packages/server/public/sdk/cobrowse-agent.js
 *         packages/server/public/sdk/cobrowse-agent.min.js
 */

import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

const outDir = path.resolve(__dirname, '../server/public/sdk');
fs.mkdirSync(outDir, { recursive: true });

const sharedOptions = {
  entryPoints: [path.resolve(__dirname, 'src/index.js')],
  bundle:      true,
  format:      'iife',
  platform:    'browser',
  globalName:  'CoBrowseAgent',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  footer: {
    js: 'CoBrowseAgent = CoBrowseAgent && CoBrowseAgent.default ? CoBrowseAgent.default : CoBrowseAgent;\nif (typeof module !== "undefined") module.exports = CoBrowseAgent;',
  },
};

async function build() {
  const enableSourceMaps = process.env.NODE_ENV !== 'production';
  await esbuild.build({
    ...sharedOptions,
    outfile:    path.join(outDir, 'cobrowse-agent.js'),
    minify:     false,
    sourcemap:  enableSourceMaps,
  });

  await esbuild.build({
    ...sharedOptions,
    outfile:    path.join(outDir, 'cobrowse-agent.min.js'),
    minify:     true,
    sourcemap:  false,
  });

  const stat = fs.statSync(path.join(outDir, 'cobrowse-agent.min.js'));
  console.log(`✓ Agent SDK built → ${outDir}`);
  console.log(`  cobrowse-agent.js      (dev, with sourcemaps)`);
  console.log(`  cobrowse-agent.min.js  (${Math.round(stat.size / 1024)}KB minified)`);
}

async function watch() {
  const ctx = await esbuild.context({
    ...sharedOptions,
    outfile:   path.join(outDir, 'cobrowse-agent.js'),
    minify:    false,
    sourcemap: true,
    plugins: [{
      name: 'rebuild-notify',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) {
            console.error('Build failed:', result.errors);
          } else {
            console.log(`[${new Date().toLocaleTimeString()}] Agent SDK rebuilt`);
          }
        });
      },
    }],
  });
  await ctx.watch();
  console.log('Watching Agent SDK for changes…');
}

if (isWatch) {
  watch().catch(console.error);
} else {
  build().catch((err) => { console.error(err); process.exit(1); });
}
