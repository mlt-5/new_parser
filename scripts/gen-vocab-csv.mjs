// Writes go/vocab.csv, the vocab/ entries as taginfo.csv rows for the Go
// package, so Go and the TypeScript parse() read the same lists. Run after
// editing vocab/ (tests/vocab.test.ts fails while it is out of date):
//   node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/scripts/gen-vocab-csv.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vocabCsv } from '../vocab/csv.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '../go/vocab.csv');
writeFileSync(out, vocabCsv());
console.log('wrote go/vocab.csv');
