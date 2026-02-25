import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Redirect /portal → /portal/ so Vite doesn't show the base URL warning. */
function portalRedirectPlugin() {
  return {
    name: 'portal-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/portal') {
          res.writeHead(301, { Location: '/portal/' });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), portalRedirectPlugin()],
  base: '/portal/',
  build: {
    outDir: '../server/public/tenant-ui',
    emptyOutDir: true,
  },
  css: {
    modules: {
      // Dev: plain readable class names (e.g. "LoginPage_wrapper")
      // Prod: hashed/serialized class names (e.g. "_a1b2c3")
      generateScopedName: mode === 'production'
        ? '[hash:base64:8]'
        : '[name]_[local]',
    },
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    port: 5173,
    hmr: {
      // Separate WS port avoids base-path ('/portal/') mangling the WebSocket URL.
      port: 5174,
    },
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
    globals: true,
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
}));
