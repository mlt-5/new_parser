// Release sorting, ported from rls (rls.go: Compare).

import { fieldsFunc, isBreakDelim, mustNormalize } from './normalize';
import type { Release } from './release';
import { ReleaseType } from './types';

/** Order in which release types group together when sorting. */
export const COMPARE_MAP: Record<ReleaseType, number> = {
  [ReleaseType.Unknown]: 0,
  [ReleaseType.Movie]: 1,
  [ReleaseType.Series]: 2,
  [ReleaseType.Episode]: 2,
  [ReleaseType.Music]: 3,
  [ReleaseType.App]: 4,
  [ReleaseType.Game]: 5,
  [ReleaseType.Book]: 6,
  [ReleaseType.Audiobook]: 7,
  [ReleaseType.Comic]: 9,
  [ReleaseType.Education]: 8,
  [ReleaseType.Magazine]: 10,
};

function cmpInt(a: number, b: number): number {
  return a < b ? -1 : b < a ? 1 : 0;
}

/** Go strings.Compare (byte order; UTF-16 order agrees for BMP text). */
function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpIntString(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '' && b !== '') return -1;
  if (b === '' && a !== '') return 1;
  if (!/[0-9]/.test(a)) return 0;
  if (!/[0-9]/.test(b)) return 1;
  // rls sums each byte's (unsigned) distance from '0' by place value
  const num = (s: string) => {
    let v = 0;
    for (let i = s.length; i > 0; i--) v += ((s.charCodeAt(i - 1) - 0x30) & 0xff) * Math.pow(10, s.length - i);
    return Math.trunc(v);
  };
  return cmpInt(num(a), num(b));
}

function roman(c: string): number {
  switch (c) {
    case 'i':
      return 1;
    case 'v':
      return 5;
    case 'x':
      return 10;
    case 'l':
      return 50;
    case 'c':
      return 100;
    case 'd':
      return 500;
    case 'm':
      return 1000;
  }
  return 0;
}

/** Parses lower-case roman numerals. */
export function parseRoman(s: string): [number, boolean] {
  if (s === '') return [0, true];
  let i = 0;
  for (let j = 0; j < s.length; j++) {
    const r = roman(s[j]);
    if (r === 0 || (j < s.length - 2 && r < roman(s[j + 1]) && roman(s[j + 1]) < roman(s[j + 2]))) return [-1, false];
    if (j < s.length - 1 && r < roman(s[j + 1])) i -= r;
    else i += r;
  }
  return [i, true];
}

function convNumber(s: string): [number, boolean, boolean] {
  if (/^[+-]?\d+$/.test(s)) return [parseInt(s, 10), false, true];
  const [i, ok] = parseRoman(s);
  if (ok && i < 100) return [i, true, true];
  return [0, false, false];
}

function compareTitleNumber(a: string, b: string, i: number): number {
  const [ai, arom, aok] = convNumber(a);
  const [bi, brom, bok] = convNumber(b);
  const abad = i === 0 && arom && aok && (ai === 1 || ai === 5 || ai === 50);
  const bbad = i === 0 && brom && bok && (bi === 1 || bi === 5 || bi === 50);
  if ((arom || brom) && i === 0) {
    // fall through to string compare
  } else if (abad && bbad) {
    // fall through
  } else if (aok && bbad) {
    return -1;
  } else if (bok && abad) {
    return 1;
  } else if ((aok && bok && ai < bi) || (aok && !bok && !abad)) {
    return -1;
  } else if ((aok && bok && bi < ai) || (bok && !aok && !bbad)) {
    return 1;
  }
  return cmpString(a, b);
}

/** Compares titles: normalised, by leading words, numbers and roman numerals. */
export function compareTitle(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '' && b !== '') return -1;
  if (b === '' && a !== '') return 1;
  const av = fieldsFunc(mustNormalize(a).toLowerCase(), isBreakDelim);
  const bv = fieldsFunc(mustNormalize(b).toLowerCase(), isBreakDelim);
  let start = 0;
  let min = 3;
  if (av.length > 0 && bv.length > 0 && av[0] === bv[0] && ['a', 'an', 'the'].includes(av[0])) {
    start = 1;
    min = 1;
  }
  let i = start;
  for (; i < start + min && i < av.length && i < bv.length; i++) {
    if ((av[i] === 'and' && bv[i] === '&') || (av[i] === '&' && bv[i] === 'and')) continue;
    const c = compareTitleNumber(av[i], bv[i], i);
    if (c !== 0) return c;
  }
  if (i < start + min) {
    if (av.length < bv.length) return -1;
    if (bv.length < av.length) return 1;
  }
  return 0;
}

/** Compares releases for sorting, grouping types by COMPARE_MAP. */
export function compare(a: Release, b: Release): number {
  const steps: (() => number)[] = [
    () => cmpInt(COMPARE_MAP[a.type], COMPARE_MAP[b.type]),
    () => compareTitle(a.artist, b.artist),
    () => compareTitle(a.title, b.title),
    () => cmpInt(a.year, b.year),
    () => cmpInt(a.month, b.month),
    () => cmpInt(a.day, b.day),
    () => cmpInt(a.series, b.series),
    () => cmpInt(a.episode, b.episode),
    () => compareTitle(a.subtitle, b.subtitle),
    () => compareTitle(a.alt, b.alt),
    () => cmpIntString(a.resolution, b.resolution),
    () => cmpString(a.version, b.version),
    () => cmpString(a.group, b.group),
    () => cmpString(a.title, b.title),
    () => cmpString(a.toString(), b.toString()),
  ];
  for (const f of steps) {
    const c = f();
    if (c !== 0) return c;
  }
  return 0;
}
