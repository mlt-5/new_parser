// Go html.UnescapeString, ported so titles unescape exactly as in rls.
// Go source: Copyright 2010 The Go Authors, BSD-style licence (../GO-LICENSE).

import { ENTITY, ENTITY2, LONGEST_ENTITY_WITHOUT_SEMICOLON } from './htmlEntitiesData';

let entity: Map<string, number> | null = null;
let entity2: Map<string, [number, number]> | null = null;

function maps(): [Map<string, number>, Map<string, [number, number]>] {
  if (!entity || !entity2) {
    entity = new Map();
    for (const e of ENTITY.split('|')) {
      const k = e.lastIndexOf(':');
      entity.set(e.slice(0, k), parseInt(e.slice(k + 1), 16));
    }
    entity2 = new Map();
    for (const e of ENTITY2.split('|')) {
      const k = e.lastIndexOf(':');
      const [a, b] = e.slice(k + 1).split(',');
      entity2.set(e.slice(0, k), [parseInt(a, 16), parseInt(b, 16)]);
    }
  }
  return [entity, entity2];
}

// Windows-1252 replacements for &#128; to &#159;.
const REPLACEMENT = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

const isAlnum = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');

/** Reads an entity at s[0] === '&'; returns the replacement and characters consumed. */
function unescapeEntity(s: string): [string, number] {
  const [ent, ent2] = maps();
  let i = 1;
  if (s.length <= 1) return ['&', 1];
  if (s[i] === '#') {
    if (s.length <= 3) return ['&', 1];
    i++;
    let c = s[i];
    let hex = false;
    if (c === 'x' || c === 'X') {
      hex = true;
      i++;
    }
    let x = 0;
    while (i < s.length) {
      c = s[i];
      i++;
      if (hex) {
        const d = '0123456789abcdef'.indexOf(c.toLowerCase());
        if (d !== -1 && c.length === 1) {
          x = (16 * x + d) | 0;
          continue;
        }
      } else if (c >= '0' && c <= '9') {
        x = (10 * x + (c.charCodeAt(0) - 48)) | 0;
        continue;
      }
      if (c !== ';') i--;
      break;
    }
    if (i <= 3) return ['&', 1];
    if (x >= 0x80 && x <= 0x9f) x = REPLACEMENT[x - 0x80];
    else if (x <= 0 || (x >= 0xd800 && x <= 0xdfff) || x > 0x10ffff) x = 0xfffd;
    return [String.fromCodePoint(x), i];
  }
  // consume the longest run of alphanumerics, plus a ';'
  while (i < s.length) {
    const c = s[i];
    i++;
    if (isAlnum(c)) continue;
    if (c !== ';') i--;
    break;
  }
  const name = s.slice(1, i);
  if (name.length !== 0) {
    const x = ent.get(name);
    if (x) return [String.fromCodePoint(x), i];
    const x2 = ent2.get(name);
    if (x2) return [String.fromCodePoint(x2[0], x2[1]), i];
    const maxLen = Math.min(name.length - 1, LONGEST_ENTITY_WITHOUT_SEMICOLON);
    for (let j = maxLen; j > 1; j--) {
      const y = ent.get(name.slice(0, j));
      if (y) return [String.fromCodePoint(y), j + 1];
    }
  }
  return [s.slice(0, i), i];
}

/** Unescapes entities like "&lt;" to "<", exactly as Go's html.UnescapeString. */
export function unescapeHtml(s: string): string {
  let i = s.indexOf('&');
  if (i < 0) return s;
  let out = s.slice(0, i);
  while (i < s.length) {
    if (s[i] === '&') {
      const [v, n] = unescapeEntity(s.slice(i));
      out += v;
      i += n;
    } else {
      const j = s.indexOf('&', i);
      if (j < 0) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, j);
      i = j;
    }
  }
  return out;
}
