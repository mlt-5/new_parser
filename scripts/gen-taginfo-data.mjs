// Regenerates src/taginfoData.ts from rls/taginfo/taginfo.csv.
// Run: node new_parser/scripts/gen-taginfo-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, 'rls/taginfo/taginfo.csv'), 'utf8');
const out =
  '// Generated from rls/taginfo/taginfo.csv by scripts/gen-taginfo-data.mjs. Do not edit.\n' +
  '// rls taginfo.csv: Copyright (c) 2020-2022 m. jo istari, MIT licence (see rls/LICENSE).\n\n' +
  'export const TAGINFO_CSV = ' + JSON.stringify(csv) + ';\n';
writeFileSync(join(root, 'src/taginfoData.ts'), out);
console.log('wrote src/taginfoData.ts', csv.length, 'bytes');
