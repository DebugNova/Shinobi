// npm run dev: the game server (:3100) and the Vite dev server with hot reload (:5174, /ws and /api proxied).
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: '3100' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
