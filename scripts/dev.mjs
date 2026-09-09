/**
 * Both halves of local development in one terminal:
 *
 *   pnpm dev     → API on :8080 (Postgres in-process via PGlite), app on :8081
 *
 * Deliberately a script rather than a `concurrently` dependency: the whole job is
 * spawning two children, labelling their output and — the part that is actually
 * worth getting right — making one Ctrl-C stop both, instead of leaving an Expo
 * bundler holding port 8081 after the API is gone.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers';

const tasks = [
  { label: 'api', args: ['--filter', '@vst/api', 'dev:pglite'] },
  { label: 'app', args: ['--filter', '@vst/mobile', 'web'] },
];
const width = Math.max(...tasks.map((t) => t.label.length));

const children = tasks.map(({ label, args }) => {
  const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      console.log(`\x1b[2m[${label.padEnd(width)}]\x1b[0m ${line}`);
    });
  }
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`\x1b[2m[${label.padEnd(width)}]\x1b[0m exited (${signal ?? code}) — stopping the other`);
      stop(typeof code === 'number' ? code : 1);
    }
  });
  return child;
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  // Give them a moment to go down cleanly, then leave regardless.
  setTimeout(() => { process.exit(code); }, 500).unref();
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(0); });
