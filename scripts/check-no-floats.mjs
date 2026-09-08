// Fails if any SQL migration declares a binary floating-point column (P6).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages/persistence/migrations'];
const bad = /\b(real|float4|float8|double\s+precision|float)\b/i;
let failures = 0;
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.sql')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (bad.test(line) && !/^\s*--/.test(line)) {
          console.error(`${p}:${i + 1}: floating-point column type is forbidden (P6): ${line.trim()}`);
          failures++;
        }
      });
    }
  }
}
roots.forEach(walk);
process.exit(failures ? 1 : 0);
