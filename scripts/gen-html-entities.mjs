// Regenerates src/htmlEntitiesData.ts from Go's html/entity.go, so the
// port unescapes titles exactly like rls (which calls html.UnescapeString).
// Run: node new_parser/scripts/gen-html-entities.mjs "$(go env GOROOT)"
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const goroot = process.argv[2];
if (!goroot) throw new Error('usage: gen-html-entities.mjs <GOROOT>');
const src = readFileSync(join(goroot, 'src/html/entity.go'), 'utf8');
const longest = /const longestEntityWithoutSemicolon = (\d+)/.exec(src)[1];
const one = [];
const two = [];
for (const m of src.matchAll(/^\t\t"([^"]+)":\s+'\\U([0-9A-F]{8})',$/gm)) one.push(m[1] + ':' + parseInt(m[2], 16).toString(16));
for (const m of src.matchAll(/^\t\t"([^"]+)":\s+\{'\\u([0-9A-F]{4})', '\\u([0-9A-F]{4})'\},$/gm)) {
  two.push(m[1] + ':' + parseInt(m[2], 16).toString(16) + ',' + parseInt(m[3], 16).toString(16));
}
const out =
  "// Generated from Go's src/html/entity.go by scripts/gen-html-entities.mjs. Do not edit.\n" +
  '// Copyright 2010 The Go Authors. BSD-style licence: see ../GO-LICENSE.\n' +
  '// Format: name:hexcodepoint entries joined by |.\n\n' +
  `export const LONGEST_ENTITY_WITHOUT_SEMICOLON = ${longest};\n\n` +
  `export const ENTITY = ${JSON.stringify(one.join('|'))};\n\n` +
  `export const ENTITY2 = ${JSON.stringify(two.join('|'))};\n`;
writeFileSync(join(root, 'src/htmlEntitiesData.ts'), out);
console.log(`wrote src/htmlEntitiesData.ts: ${one.length} + ${two.length} entities, ${out.length} bytes`);
