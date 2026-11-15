// SOLSPIRE — hand-in program for the threejs-fps-02 bounty (Node 22, standard
// library only). The game itself is the game/ folder beside this file: plain
// static files, ES modules, three.js 0.187.0 vendored under game/vendor/.
// This program copies game/ and screenshots/ into the output directory and
// writes dossier.json there with the kit's own library, so the dossier the
// judge reads is byte for byte the one the scorer rebuilds.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play it locally with: node serve.ts  (then open http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's caps, passed to the library so an over-limit entry fails here
// first instead of at the gate: dossier text 160 KiB, at most 4 screenshots
// of at most 256 KiB, game/ at most 993 entries and 48 MiB.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
