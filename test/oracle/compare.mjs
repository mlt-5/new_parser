// Compares the port with Go rls output from main.go, field by field and tag by tag.
// node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/oracle/compare.mjs go.jsonl
// With --vocab it compares parse() with the output of main.go -vocab instead.

import { readFileSync } from 'node:fs';
import { parse as parseVocab, parseRls, releaseTypeName, tagTypeName } from '../../src/index.ts';

const vocab = process.argv.includes('--vocab');
const parse = vocab ? parseVocab : parseRls;
const lines = readFileSync(process.argv.slice(2).find((a) => a !== '--vocab'), 'utf8').split('\n').filter(Boolean);
const map = {
  Type: 'TypeS', Artist: 'artist', Title: 'title', Subtitle: 'subtitle', Alt: 'alt', Platform: 'platform', Arch: 'arch',
  Source: 'source', Resolution: 'resolution', Collection: 'collection', Year: 'year', Month: 'month', Day: 'day',
  Series: 'series', Episode: 'episode', Version: 'version', Disc: 'disc', Codec: 'codec', HDR: 'hdr', BitDepth: 'bitDepth',
  Audio: 'audio', Channels: 'channels', Other: 'other', Cut: 'cut', Edition: 'edition', Language: 'language', Size: 'size',
  Region: 'region', Container: 'container', Genre: 'genre', ID: 'id', Group: 'group', Meta: 'meta', Site: 'site', Sum: 'sum',
  Pass: 'pass', Req: 'req', Ext: 'ext',
};
let bad = 0;
const byField = {};
const t0 = Date.now();
for (const line of lines) {
  const g = JSON.parse(line);
  if (g.Panic) {
    bad++;
    byField.Panic = (byField.Panic ?? 0) + 1;
    console.log(JSON.stringify(g.Name), '\n    Go panicked:', g.Panic);
    continue;
  }
  const r = parse(g.Name);
  const probs = [];
  for (const [gk, tk] of Object.entries(map)) {
    let want = gk === 'Type' ? g.TypeS : g[gk];
    let got = gk === 'Type' ? releaseTypeName(r.type) : r[tk];
    if (Array.isArray(got) || want === null) {
      want = JSON.stringify(want ?? []);
      got = JSON.stringify(got);
    }
    if (want !== got) probs.push(`${gk}: go ${JSON.stringify(want)} ts ${JSON.stringify(got)}`);
  }
  const se = r.seriesEpisodes();
  const seS = se.length > 1 ? se.map(([s, e]) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`).join(' ') : '';
  if (seS !== g.SeriesEpisodes) probs.push(`SeriesEpisodes: go ${g.SeriesEpisodes} ts ${seS}`);
  const un = r.unused().map((t) => t.normalize()).join(' ');
  if (un !== g.Unused) probs.push(`Unused: go ${JSON.stringify(g.Unused)} ts ${JSON.stringify(un)}`);
  const tags = r.tags().map((t) => `${tagTypeName(t.typ)}|${t.v[0]}|${t.normalize()}`);
  if (JSON.stringify(tags) !== JSON.stringify(g.Tags ?? [])) probs.push(`Tags:\n      go ${JSON.stringify(g.Tags)}\n      ts ${JSON.stringify(tags)}`);
  if (probs.length) {
    bad++;
    for (const p of probs) byField[p.split(':')[0]] = (byField[p.split(':')[0]] ?? 0) + 1;
    if (bad <= Number(process.env.SHOW ?? 15)) {
      console.log(JSON.stringify(g.Name));
      for (const p of probs) console.log('   ', p);
    }
  }
}
console.log(byField);
console.log(`${lines.length - bad}/${lines.length} names identical to Go${vocab ? ' parse (vocab)' : ' rls'} (${Date.now() - t0} ms)`);
process.exitCode = bad ? 1 : 0;
