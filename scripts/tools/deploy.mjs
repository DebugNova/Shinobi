// Uploads the game to the owner's VPS (Shulker, games-1), builds it there and restarts it under pm2.
// Players on the server are disconnected by the restart: deploy when nobody is playing.
//   npm run deploy        (DEPLOY_HOST=root@<ip> to use another server)
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const HOST = process.env.DEPLOY_HOST || 'root@185.2.49.69';
const DIR = '/home/kaustab/games/shinobi';
const TGZ = path.join(os.tmpdir(), 'shinobi-deploy.tgz');
const run = (cmd, input) => execSync(cmd, input ? { input, stdio: ['pipe', 'inherit', 'inherit'] } : { stdio: 'inherit' });

// Windows' bsdtar (System32): Git Bash's GNU tar reads "C:" in a path as a remote host.
const TAR = process.platform === 'win32' ? `"${process.env.SystemRoot}\\System32\\tar.exe"` : 'tar';
const EXCLUDE = ['node_modules', 'mixamo', 'dist', 'dist-test', 'dist-prof', 'shots', 'models']
  .map((d) => `--exclude=./${d}`).join(' ');
console.log('packing...');
run(`${TAR} -czf "${TGZ}" ${EXCLUDE} -C . .`);
console.log(`uploading to ${HOST}...`);
run(`scp -o BatchMode=yes "${TGZ}" ${HOST}:/tmp/shinobi.tgz`);
// Old sources are removed first (a file deleted here must not linger there); node_modules stays for a fast install.
const remote = [
  'set -e',
  `cd ${DIR}`,
  'find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +',
  'tar -xzf /tmp/shinobi.tgz -C .',
  'chown -R kaustab:kaustab .',
  `su - kaustab -c "cd ${DIR} && npm install --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -3 && pm2 restart shinobi --update-env >/dev/null && pm2 save >/dev/null && pm2 ls"`,
].join('\n');
run(`ssh -o BatchMode=yes ${HOST} "bash -s"`, remote);
console.log('\nlive: https://shinobi.185-2-49-69.sslip.io/');
