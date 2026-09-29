import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// /asset-sizes.json = { "/assets/...": bytes } for every file in public/assets: the boot screen weights its progress
// bar by file size (the 10 MB character and a 20 KB font would otherwise count the same).
function assetSizes() {
  const root = path.resolve('public');
  const walk = (dir, out) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out[`/${path.relative(root, p).split(path.sep).join('/')}`] = fs.statSync(p).size;
    }
    return out;
  };
  const json = () => JSON.stringify(walk(path.join(root, 'assets'), {}));
  return {
    name: 'shinobi-asset-sizes',
    configureServer(server) {
      server.middlewares.use('/asset-sizes.json', (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(json());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'asset-sizes.json', source: json() });
    },
  };
}

// In dev, Vite serves the client with hot reload and proxies multiplayer traffic to the game server (:3100).
export default defineConfig({
  plugins: [assetSizes()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      // (xfwd: the server sees who really connected: dev commands are for this laptop only, not LAN friends via Vite)
      '/ws': { target: 'ws://localhost:3100', ws: true, xfwd: true },
      '/api': { target: 'http://localhost:3100' },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
  },
});
