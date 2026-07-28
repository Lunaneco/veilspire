#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = process.env.VERIFY_SCRATCH || join(ROOT, 'verify-out');
mkdirSync(OUTPUT, { recursive: true });

function run(label, command, args, options = {}) {
  process.stdout.write(`== ${label} ==\n`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  const log = `${result.stdout || ''}${result.stderr || ''}\nexit=${result.status}\n`;
  writeFileSync(join(OUTPUT, `${label}.log`), log);
  if (result.status !== 0) {
    process.stdout.write(log);
    process.exit(1);
  }
  process.stdout.write(`PASS ${label}\n`);
}

const testFiles = readdirSync(join(ROOT, 'tests/unit'))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join('tests/unit', name));
run('unit-tests', process.execPath, ['--test', ...testFiles]);

const banned = [
  'Hogwarts',
  'Harry Potter',
  'Gryffindor',
  'Slytherin',
  'Ravenclaw',
  'Hufflepuff',
  'Dumbledore',
  'Voldemort',
  'Hermione',
  'Avada',
  'Expelliarmus',
  'Patronus',
  'Hogwarts Legacy',
  'Diagon Alley',
];
const hits = [];
function audit(directory) {
  for (const name of readdirSync(directory)) {
    if (['node_modules', '.git', 'dist', 'verify-out'].includes(name)) continue;
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      audit(path);
    } else if (/\.(js|html|md|json|css)$/.test(name)) {
      const contents = readFileSync(path, 'utf8');
      for (const term of banned) {
        if (contents.includes(term)) hits.push(`${path}: ${term}`);
      }
    }
  }
}
audit(ROOT);
writeFileSync(
  join(OUTPUT, 'ip-audit.log'),
  hits.length ? hits.join('\n') : 'PASS: no protected franchise identifiers.\n',
);
if (hits.length) {
  process.stdout.write(`IP audit failed:\n${hits.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('PASS ip-audit\n');

run('build', 'npm', ['run', 'build']);
run('browser-launch', process.execPath, ['scripts/browser-launch.mjs'], {
  timeout: 90000,
  env: { VERIFY_SCRATCH: OUTPUT },
});

process.stdout.write(`All verification artifacts: ${OUTPUT}\n`);
