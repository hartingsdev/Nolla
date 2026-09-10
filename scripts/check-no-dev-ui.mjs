// Fails if developer-only UI survived into a production web bundle (#8).
//
// DEV_TOOLS is `process.env.EXPO_PUBLIC_E2E === '1'`, which Expo inlines at
// export time, so a production export folds it to false and drops the branch.
// This asserts that rather than trusting it: CI's check job already exports the
// web build without the flag, and this greps what came out.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'apps/mobile/dist';
const MARKER = 'nolla-dev-tools';

if (!existsSync(dist)) {
  console.error(`${dist} does not exist — export the web build first`);
  process.exit(2);
}
if (process.env.EXPO_PUBLIC_E2E === '1') {
  console.error('refusing to check a build exported with EXPO_PUBLIC_E2E=1');
  process.exit(2);
}

let hits = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(p) && readFileSync(p, 'utf8').includes(MARKER)) {
      console.error(`${p}: contains the developer-UI marker ${MARKER}`);
      hits++;
    }
  }
}
walk(dist);
if (hits) { console.error('\ndeveloper UI must not reach a shipped build'); process.exit(1); }
console.log(`no developer UI in ${dist}`);
