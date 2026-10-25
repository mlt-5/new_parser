// Text cleaning and title normalising, ported from rls (rls.go: Collapser,
// MustClean, MustNormalize), plus the delimiter helpers rls shares.

const MN = /\p{Mn}/u;
const LETTER = /\p{L}/u;
const UNICODE_SPACE = new Set(
  [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]
    .concat(Array.from({ length: 11 }, (_, k) => 0x2000 + k))
    .map((c) => String.fromCharCode(c)),
);

/** Go unicode.IsSpace. */
export function isSpace(r: string): boolean {
  return UNICODE_SPACE.has(r);
}

/** Go unicode.IsLetter. */
export function isLetter(r: string): boolean {
  return r !== '' && LETTER.test(r);
}

const ANY_DELIM = '\t\n\f\r ()+,-._[/\\]{}~';
const BREAK_DELIM = '\t\n\f\r ()+,._[/\\]{}~';
const TITLE_TRIM_DELIM = '\t\n\f\r (),-_[/\\]{}~';

/** Any delimiter. */
export function isAnyDelim(r: string): boolean {
  return r.length === 1 && ANY_DELIM.includes(r);
}

/** Break delimiter: any delimiter except '-'. */
export function isBreakDelim(r: string): boolean {
  return r.length === 1 && BREAK_DELIM.includes(r);
}

/** Title trim delimiter: any delimiter except '.' and '+'. */
export function isTitleTrimDelim(r: string): boolean {
  return r.length === 1 && TITLE_TRIM_DELIM.includes(r);
}

/** Go strings.TrimLeftFunc. */
export function trimLeftFunc(s: string, f: (r: string) => boolean): string {
  const cs = [...s];
  let a = 0;
  while (a < cs.length && f(cs[a])) a++;
  return cs.slice(a).join('');
}

/** Go strings.TrimRightFunc. */
export function trimRightFunc(s: string, f: (r: string) => boolean): string {
  const cs = [...s];
  let b = cs.length;
  while (b > 0 && f(cs[b - 1])) b--;
  return cs.slice(0, b).join('');
}

/** Go strings.TrimFunc. */
export function trimFunc(s: string, f: (r: string) => boolean): string {
  return trimRightFunc(trimLeftFunc(s, f), f);
}

/** Go strings.FieldsFunc. */
export function fieldsFunc(s: string, f: (r: string) => boolean): string[] {
  const out: string[] = [];
  let cur = '';
  for (const r of s) {
    if (f(r)) {
      if (cur !== '') out.push(cur);
      cur = '';
    } else {
      cur += r;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

interface Collapser {
  lower: boolean;
  trim: boolean;
  remove: Set<string>;
  space: Set<string>;
  transformer: ((r: string, prev: string, next: string) => string | null) | null;
}

function collapse(c: Collapser, input: string): string {
  const src = [...input.normalize('NFD')];
  let i = 0;
  if (c.trim) {
    while (i < src.length && (c.remove.has(src[i]) || c.space.has(src[i]))) i++;
  }
  let out = '';
  let last = 0;
  let prev = '';
  for (; i < src.length; i++) {
    let r: string | null = src[i];
    if ((c.space.has(r) && prev === ' ') || c.remove.has(r) || MN.test(r)) continue;
    if (c.space.has(r)) r = ' ';
    if (c.transformer) {
      r = c.transformer(r, prev, src[i + 1] ?? '');
      if (r === null) continue;
    }
    if (c.lower) r = r.toLowerCase();
    out += r;
    prev = r;
    if (r !== ' ') last = out.length;
  }
  if (c.trim) out = out.slice(0, last);
  return out.normalize('NFC');
}

const CLEANER: Collapser = {
  lower: false,
  trim: true,
  remove: new Set(["'"]),
  space: new Set(' \t\r\n\f'),
  transformer: null,
};

const NORMALIZER: Collapser = {
  lower: true,
  trim: true,
  remove: new Set("`':;~!@#%^*=+()[]{}<>/?|\",".split('')),
  space: new Set(' \t\r\n\f._'.split('')),
  transformer: (r, prev, next) => {
    if (r === '-' && isSpace(prev)) return null;
    if (r === '$' && (isLetter(prev) || isLetter(next))) return 'S';
    if (r === '£' && (isLetter(prev) || isLetter(next))) return 'L';
    if (r === '$' || r === '£') return null;
    return r;
  },
};

/**
 * Clean form: accents removed, spaces collapsed to ' ', `'` removed, trimmed.
 */
export function mustClean(s: string): string {
  return collapse(CLEANER, s);
}

/** Lower-case clean form useful for matching titles. */
export function mustNormalize(s: string): string {
  return collapse(NORMALIZER, s);
}
