// Lance l'API (server) et le front (client) en parallèle, sans dépendance externe.
// Équivalent à ouvrir deux terminaux : `npm run dev:server` et `npm run dev:client`.
import { spawn, spawnSync } from 'node:child_process';

const processes = [
  { name: 'server', command: 'npm run dev -w server' },
  { name: 'client', command: 'npm run dev -w client' },
];

const children = processes.map(({ name, command }) => {
  // `shell: true` avec une commande complète : nécessaire pour trouver npm.cmd sous Windows.
  const child = spawn(command, { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev] ${name} s'est arrêté avec le code ${code}`);
      stopAll(code);
    }
  });
  return child;
});

function stopAll(code = 0) {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // Sous Windows, child.kill() ne tue que le shell intermédiaire : le `node` lancé
    // par npm resterait vivant et garderait le port. taskkill /T tue tout l'arbre.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
