// Regenerates test/rlsTestsData.ts from rls/tests.yaml (so Jest and tsc need no fs).
// Run: node new_parser/scripts/gen-test-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(join(root, 'rls/tests.yaml'), 'utf8');
const out =
  '// Generated from rls/tests.yaml by scripts/gen-test-data.mjs. Do not edit.\n' +
  '// rls tests.yaml: Copyright (c) 2020-2022 m. jo istari, MIT licence (see ../rls/LICENSE).\n\n' +
  'export const RLS_TESTS_YAML = ' + JSON.stringify(yaml) + ';\n';
writeFileSync(join(root, 'test/rlsTestsData.ts'), out);
console.log('wrote test/rlsTestsData.ts', yaml.length, 'bytes');
