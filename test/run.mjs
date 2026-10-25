// Runs rls's tests.yaml against the port, without Jest:
// node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/run.mjs
import { loadCases, runCases } from './rlsCases.ts';
import { RLS_TESTS_YAML } from './rlsTestsData.ts';

const cases = loadCases(RLS_TESTS_YAML);
const t0 = Date.now();
const bad = runCases(cases);
for (const b of bad.slice(0, Number(process.env.SHOW ?? 40))) {
  console.log(JSON.stringify(b.name));
  for (const p of b.problems) console.log('   ', p);
}
console.log(`${cases.length - bad.length}/${cases.length} cases match rls (${Date.now() - t0} ms)`);
process.exitCode = bad.length ? 1 : 0;
