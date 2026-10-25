// Prints test names for the oracle: every rls tests.yaml name plus seeded
// random names built from the tag vocabulary and tricky tokens.
// node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/oracle/corpus.mjs [count] > names.txt
import { RLS_TESTS_YAML } from '../rlsTestsData.ts';
import { allTaginfo } from '../../src/index.ts';

// mulberry32
let seed = 11;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

const tags = Object.values(allTaginfo()).flat().map((i) => i.tag);
const words = ['The', 'Show', 'of', 'Love', 'KING', 'I', 'A', 'vol', 'Season', 'Episode', 'Ep', 'Part', 'Disc', 'CD2', 'DVD9', '2xDVD9',
  'VLS2004', 'WEB2007', 'S01', 'S01E02', '1x03', 'S02E03E04', 'E07', 'v2', 'Version 2004', '11.09.1', '2nd Jan 2006', '13 Dec 2011',
  '2006-01-02', '02-13-2006', '17.12.15', '1999', '2023', '720p', '1080i', '(Rock)', '(ABC-12345)', 'REQ', '[REQ]', '[ABCD1234]',
  '[[k:v]]', '{{pw}}', '-={site}=-', '&amp;', '&AMP', '&#039;', 'AKA', '~', '...', 'Ünïcödé', '東京', '第1集', '⭐️', '🎬', 'Mr.',
  'S.H.I.E.L.D', 'C.S.', '$elfie', '£', '16bit', 'CBR', 'BOOTLEG', 'REMiX', 'IMAX', 'Amazon', 'Web', 'Uncut', 'DC', 'MD',
  'January', 'x264', 'DDP5.1', 'AAC2.0', 'DTS-HD.MA.5.1', '-GRP', '_iNTERNAL', 'Hi10', '10bit'];
const delims = ['.', ' ', '_', '-', ' - ', '(', ')', '[', ']', '{', '}', '+', ',', '~', '/', '\\', '__', '--', '. ', ' (', ') ', ']['];

const out = new Set();
for (const line of RLS_TESTS_YAML.split('\n')) {
  if (line.startsWith('"')) out.add(JSON.parse(line.slice(0, line.lastIndexOf('"') + 1)));
}
const count = Number(process.argv[2] ?? 40000);
for (let k = 0; k < count; k++) {
  const n = 1 + Math.floor(rand() * 12);
  let s = '';
  for (let j = 0; j < n; j++) {
    let tok = rand() < 0.5 ? pick(tags) : pick(words);
    if (rand() < 0.2) tok = tok.toLowerCase();
    else if (rand() < 0.1) tok = tok.toUpperCase();
    s += tok + (j < n - 1 ? pick(delims) : '');
  }
  if (rand() < 0.3) s += '-' + pick(['GRP', 'NTb', 'FLUX', 'x', 'SubsPlease']);
  if (rand() < 0.2) s += pick(['.mkv', '.mp4', '.epub', '.nfo', '.rar']);
  if (rand() < 0.1) s = '[' + pick(['Erai-raws', 'ASW', 'SubsPlease', 'A B']) + '] ' + s;
  if (rand() < 0.05) s = '  ' + s + ' \t';
  out.add(s);
}
for (const s of out) if (!/[\n\r]/.test(s)) console.log(s);
