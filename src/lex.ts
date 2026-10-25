// Lexers, ported from rls (lex.go).
//
// A lexer looks at src[i:n] (or buf, the working copy with `_`, `,` and `+`
// turned into spaces, so `\b` works) and appends tags to start (from the
// left) or end (from the right). Multi lexers must change state only when
// they return true; once lexers may change it either way.

import { findAllSubmatch, findSubmatch, goRe, goReG, goRegexp } from './goRegexp';
import { taginfoRe } from './reutil';
import { newTag, pad2, type Tag } from './tag';
import { find, type FindFunc, type TaginfoMap } from './taginfo';
import { TagType } from './types';

export interface LexState {
  start: Tag[];
  end: Tag[];
  i: number;
  n: number;
}

export type LexFunc = (src: string, buf: string, st: LexState) => boolean;

export interface Lexer {
  init?: (infos: TaginfoMap, delim: RegExp, short: Set<string>) => void;
  lex: LexFunc;
  /** Skip until a tag other than a delimiter has been read. */
  notFirst?: boolean;
  /** Run once over the whole name, before the multi lexers. */
  once?: boolean;
}

/** UTF-8 byte length (Go len on a string). */
export function utf8Len(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Index in s of UTF-8 byte offset b, rounded down to a character boundary.
 * rls works in bytes; where it moves by a byte count, the port converts.
 */
export function byteToIndex(s: string, b: number): number {
  let n = 0;
  let i = 0;
  for (const ch of s) {
    const w = utf8Len(ch);
    if (n + w > b) return i;
    n += w;
    i += ch.length;
  }
  return i + (b - n);
}

function containsAny(s: string, chars: string): boolean {
  for (const c of chars) if (s.includes(c)) return true;
  return false;
}

function trimChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** The default lexers, in rls order. */
export function defaultLexers(): Lexer[] {
  return [
    // --------------- once ---------------
    trimWhitespaceLexer(),
    extLexer(),
    metaLexer(
      // [[ type:value ]]
      '', '[[', ']]', '([a-zA-Z][a-zA-Z0-9_]{0,15}):\\s*([^ \\t\\]]{1,32})',
      // [REQ]
      'req', '[', ']', '(REQ(?:UEST)?)',
      // (REQ)
      'req', '(', ')', '(REQ(?:UEST)?)',
      // {REQ}
      'req', '{', '}', '(REQ(?:UEST)?)',
      // [ABCD1234]
      'sum', '[', ']', '([0-9A-F]{8})',
      // [site]
      'site', '[', ']', '([^ \\t\\]]{1,32})',
      // -={site}=-
      'site', '-={', '}=-', '([^ \\t\\}]{1,32})',
      // {{pass}}
      'pass', '{{', '}}', '([^ \\t\\}]{1,32})',
    ),
    groupLexer(),
    // --------------- multi ---------------
    regexpLexer(TagType.Size, true),
    regexpLexer(TagType.Platform, true),
    regexpLexer(TagType.Arch, true),
    regexpLexer(TagType.Source, true),
    regexpLexer(TagType.Resolution, true),
    regexpSourceLexer(TagType.Collection, true),
    seriesLexer(
      // s02, S01E01
      '(?i)^s(?P<s>[0-8]?\\d)[\\-\\._ ]?(?:e(?P<e>\\d{1,5}))?\\b',
      // S01E02E03, S01E02-E03, S01E03.E04.E05
      '(?i)^s(?P<s>[0-8]?\\d)(?P<m>(?:[\\-\\._ ]?e\\d{1,5}){1,5})\\b',
      // S01S02S03
      '(?i)^(?P<S>(?:s[0-8]?\\d){2,4})\\b',
      // 2x1, 1x01
      '(?i)^(?P<s>[0-8]?\\d)x(?P<e>\\d{1,3})\\b',
      // S01 - 02v3, S07-06, s03-5v.9
      '(?i)^s(?P<s>[0-8]?\\d)[\\-\\._ ]{1,3}(?P<e>\\d{1,5})(?:[\\-\\._ ]{1,3}(?P<v>v\\d+(?:\\.\\d+){0,2}))?\\b',
      // Season.01.Episode.02, Series.01.Ep.02, Series.01, Season.01
      '(?i)^(?:series|season|s)[\\-\\._ ]?(?P<s>[0-8]?\\d)(?:[\\-\\._ ]?(?:episode|ep)(?P<e>\\d{1,5}))?\\b',
      // Vol.1.No.2, vol1no2
      '(?i)^vol(?:ume)?[\\-\\._ ]?(?P<s>\\d{1,3})(?:[\\-\\._ ]?(?:number|no)[\\-\\._ ]?(?P<e>\\d{1,5}))\\b',
      // Episode 15, E009, Ep. 007, Ep.05-07
      '(?i)^e(?:p(?:isode)?[\\-\\._ ]{1,3})?(?P<e>\\d{1,5})(?:[\\-\\._ ]{1,3}\\d{1,3})?\\b',
      // 10v1.7, 13v2
      '(?i)^(?P<e>\\d{1,5})(?P<v>v[\\-\\._ ]?\\d+(?:\\.\\d){0,2})\\b',
      // S01.Disc02, s01D3, Series.01.Disc.02, S02DVD3
      '(?i)^(?:series|season|s)[\\-\\._ ]?(?P<s>[0-8]?\\d)[\\-\\._ ]?(?P<d>(?:disc|disk|dvd|d)[\\-\\._ ]?(?:\\d{1,3}))\\b',
      // s1957e01
      '(?i)^s(?P<s>(?:19|20)\\d\\d)e(?P<e>\\d{2,4})\\b',
    ),
    discSourceYearLexer(
      // VLS2004, 2DVD1999, 4CD2003
      '(?i)^(?P<d>[2-9])?(?P<s>cd|ep|lp|dvd|vls|vinyl)(?P<y>(?:19|20)\\d\\d)\\b',
      // WEB2007
      '(?i)^(?P<s>web)(?P<y>20\\d\\d)\\b',
    ),
    discLexer(
      // D01, Disc.1
      '(?i)^(?P<t>d)(?:is[ck][\\-\\._ ])?(?P<c>\\d{1,3})\\b',
      // 12DiSCS
      '(?i)^(?P<c>\\d{1,3})[\\-\\._ ]?di(?P<t>s)[ck]s?\\b',
      // CD1, CD30
      '(?i)^(?P<t>cd)[\\-\\._ ]?(?P<c>\\d{1,2})\\b',
      // DVD2, DVD24 -- does not match DVD5/DVD9
      '(?i)^(?P<t>dvd)[\\-\\._ ]?(?P<c>[1-46-8]|[12]\\d)\\b',
      // 2xDVD9
      '(?i)^(?P<c>\\d{1,2})(?P<t>x(?:dvd9))\\b',
      // 2DVD9, 6DVD9
      '(?i)^(?P<c>[2-9])(?P<z>dvd9)\\b',
      // 2xVinyl, 3xDVD, 4xCD
      '(?i)^(?P<c>\\d{1,2})(?P<t>x(?:cd|ep|lp|dvda|dvd|vls|vinyl)s?)\\b',
      // 2Vinyl, 6DVD
      '(?i)^(?P<c>\\d{1,2})(?P<x>(?:cd|ep|lp|dvda|dvd|vls|vinyl)s?)\\b',
      // CDS3
      '(?i)^(?:(?P<x>cd)s)(?P<c>\\d{1,2})\\b',
      // 2CDS
      '(?i)^(?P<c>[2-9])(?P<x>cds)\\b',
    ),
    dateLexer(
      // 2006-01-02, 2006
      '(?i)^(?P<2006>(?:19|20)\\d{2})(?:[\\-\\._ ](?P<01>\\d{2})[\\-\\._ ](?P<02>\\d{2}))?\\b',
      // 2006-01
      '(?i)^(?P<2006>(?:19|20)\\d{2})?:[\\-\\._ ](?P<01>\\d{2})\\b',
      // 13-02-2006
      '(?i)^(?P<01>\\d{2})[\\-\\._ ](?P<02>\\d{2})[\\-\\._ ](?P<2006>(?:19|20)\\d{2})\\b',
      // 02-13-2006
      '(?i)^(?P<02>\\d{2})[\\-\\._ ](?P<01>\\d{2})[\\-\\._ ](?P<2006>(?:19|20)\\d{2})\\b',
      // 2nd Jan 2006, 13 Dec 2011, Nov 1999
      '(?i)^(?:(?P<_2>\\d{1,2})(?:th|st|nd|rd)?[\\-\\._ ])?(?P<Jan>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\\-\\._ ](?P<2006>(?:19|20)\\d{2})\\b',
      // 01-August-1998
      '(?i)^(?P<_2>\\d{1,2})[\\-\\._ ](?P<January>January|February|March|April|May|June|July|August|September|October|November|December)[\\-\\._ ](?P<2006>(?:19|20)\\d{2})\\b',
      // MAY-30-1992
      '(?i)^(?P<Jan>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\\-\\._ ](?P<_2>\\d{1,2})[\\-\\._ ](?P<2006>(?:19|20)\\d{2})\\b',
      // 17.12.15, 20-9-9
      '(?i)^(?P<YY>[12]\\d)[\\-\\._ ](?P<01>\\d\\d?)[\\-\\._ ](?P<02>\\d\\d?)\\b',
    ),
    versionLexer(
      // v1.17, v1, v1.2a, v1b
      '(?i)^(version[\\-\\._ ])?(?P<v>v[\\-\\._ ]?\\d{1,2}(?:[\\._ ]\\d{1,2}[a-z]?\\d*){0,3})\\b',
      // v2012, v20120803, v20120803, v1999.08.08
      '(?i)^(version[\\-\\._ ])?(?P<v>v[\\-\\._ ]?(?:19|20)\\d\\d(?:[\\-\\._ ]?\\d\\d?){0,2})\\b',
      // v60009
      '(?i)^(version[\\-\\._ ])?(?P<v>v[\\-\\._ ]?\\d{4,10})\\b',
      // Version 2004, Version 21H2, Version 22H1
      '(?i)^version[\\-\\._ ](?P<V>\\d{2,}|\\d{2}[a-z]{1,2}\\d{1,2})\\b',
      // 11.09.1, 100.000.99999999999, 23.3.2.458
      '(?i)^(?P<u>\\d{1,3}\\.\\d{1,3}\\.\\d{1,16}(\\.\\d{1,16})?)\\b',
    ),
    regexpSourceLexer(TagType.Codec, true),
    regexpSourceLexer(TagType.HDR, true),
    regexpLexer(TagType.BitDepth, true),
    audioLexer(),
    regexpLexer(TagType.Channels, true),
    regexpLexer(TagType.Other, true),
    regexpLexer(TagType.Cut, true),
    regexpLexer(TagType.Edition, true),
    regexpLexer(TagType.Language, false),
    regexpLexer(TagType.Region, true),
    regexpLexer(TagType.Container, true),
    genreLexer(),
    idLexer(),
    episodeLexer(),
  ];
}

/** Leading and trailing whitespace (and ⭐, U+FE0F). */
export function trimWhitespaceLexer(): Lexer {
  const s = '(\\t|\\n|\\f|\\r| |⭐|\ufe0f)+';
  const prefix = goRe('^' + s);
  const suffix = goRe(s + '$');
  return {
    once: true,
    lex: (src, _buf, st) => {
      let m = findSubmatch(prefix, src.slice(st.i, st.n));
      if (m) {
        st.start.push(newTag(TagType.Whitespace, null, ...m));
        st.i += m[0].length;
      }
      m = findSubmatch(suffix, src.slice(st.i, st.n));
      if (m) {
        st.end.push(newTag(TagType.Whitespace, null, ...m));
        st.n -= m[0].length;
      }
      return true;
    },
  };
}

// Go time.Parse for the single-field layouts the date lexer uses.
const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LONG_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Parses t with a one-field Go layout; returns the field's value or null. */
export function parseTimeField(layout: string, t: string): number | null {
  switch (layout) {
    case '2006':
      return /^\d{4}$/.test(t) ? parseInt(t, 10) : null;
    case '06':
      return /^\d{2}$/.test(t) ? parseInt(t, 10) + (parseInt(t, 10) >= 69 ? 1900 : 2000) : null;
    case '01': {
      if (!/^\d{2}$/.test(t)) return null;
      const m = parseInt(t, 10);
      return m >= 1 && m <= 12 ? m : null;
    }
    case '_1': {
      if (!/^\d{1,2}$/.test(t)) return null;
      const m = parseInt(t, 10);
      return m >= 1 && m <= 12 ? m : null;
    }
    case '02':
    case '_2': {
      const u = layout === '_2' && t.startsWith(' ') ? t.slice(1) : t;
      if (!(layout === '02' ? /^\d{2}$/ : /^\d{1,2}$/).test(u)) return null;
      const d = parseInt(u, 10);
      return d >= 1 && d <= 31 ? d : null;
    }
    case 'Jan': {
      const k = SHORT_MONTHS.indexOf(t.toLowerCase());
      return k === -1 ? null : k + 1;
    }
    case 'January': {
      const k = LONG_MONTHS.indexOf(t.toLowerCase());
      return k === -1 ? null : k + 1;
    }
  }
  throw new Error(`unknown capture group ${JSON.stringify(layout)}`);
}

/** Dates: 2006-01-02, 13 Dec 2011, 17.12.15, ... */
export function dateLexer(...strs: string[]): Lexer {
  const lexer = namedCaptureLexer(...strs);
  return {
    lex: (src, buf, st) => {
      const r = lexer(src, buf, st.i, st.n);
      if (!r) return false;
      const [s, v, i] = r;
      let year = '';
      let month = '';
      let day = '';
      let matched = true;
      for (let l = 0; l < v.length; l += 2) {
        let f = v[l];
        let t = v[l + 1];
        if (f === 'YY') {
          f = '2006';
          t = '20' + t;
        }
        const x = parseTimeField(f, t);
        if (x === null) {
          matched = false;
          continue;
        }
        switch (f) {
          case '06':
          case '2006':
            year = String(x);
            break;
          case '_1':
          case '01':
          case 'Jan':
          case 'January':
            month = pad2(x);
            break;
          case '_2':
          case '02':
            day = pad2(x);
            break;
        }
      }
      if (!matched) return false;
      st.start.push(newTag(TagType.Date, null, s, year, month, day));
      st.i = i;
      return true;
    },
  };
}

/** Series and episodes: S01E02, 1x02, Season 1, E05, ... */
export function seriesLexer(...strs: string[]): Lexer {
  let sourcef: FindFunc | null = null;
  const lexer = namedCaptureLexer(...strs);
  const mlt = goReG('(?i)s(\\d?\\d)');
  const mny = goReG('(?i)[\\-\\._ ]?e(\\d{1,5})');
  const dsc = goRe('(?i)^disc|disk|dvd|d');
  return {
    init: (infos) => {
      sourcef = find(infos['source'] ?? []);
    },
    lex: (src, buf, st) => {
      const r = lexer(src, buf, st.i, st.n);
      if (!r) return false;
      let [s] = r;
      const [, v, i] = r;
      let series = '';
      let episode = '';
      let version = '';
      let disc = '';
      let multi = '';
      let many = '';
      for (let l = 0; l < v.length; l += 2) {
        switch (v[l]) {
          case 's':
            series = v[l + 1];
            break;
          case 'e':
            episode = v[l + 1];
            break;
          case 'v':
            version = v[l + 1];
            break;
          case 'd':
            disc = v[l + 1];
            break;
          case 'S':
            multi = v[l + 1];
            break;
          case 'm':
            many = v[l + 1];
            break;
          default:
            throw new Error(`unknown capture group ${JSON.stringify(v[l])}`);
        }
      }
      const tags: Tag[] = [];
      if (series !== '' || episode !== '') {
        if (version !== '' && s.endsWith(version)) s = s.slice(0, s.length - version.length);
        if (disc !== '' && s.endsWith(disc)) s = s.slice(0, s.length - disc.length);
        const l = [s, series];
        if (many === '') l.push(episode);
        else for (const m of findAllSubmatch(mny, many)) l.push(m[1]);
        tags.push(newTag(TagType.Series, null, ...l));
      }
      if (version !== '') tags.push(newTag(TagType.Version, null, version, version));
      if (disc !== '') {
        const dm = findSubmatch(dsc, disc)!;
        const disctyp = disc.slice(0, dm[0].length).toUpperCase();
        const num = disc.slice(disctyp.length).trim();
        if (disctyp === 'DVD') {
          tags.push(
            newTag(TagType.Source, sourcef, disctyp, disctyp),
            newTag(TagType.Disc, null, disc.slice(disctyp.length), disctyp, num),
          );
        } else {
          tags.push(newTag(TagType.Disc, null, disc, disctyp, num));
        }
      }
      // S01S02S03 ...
      if (multi !== '') {
        for (const m of findAllSubmatch(mlt, multi)) tags.push(newTag(TagType.Series, null, ...m, ''));
      }
      if (series.length === 4 && (series.startsWith('19') || series.startsWith('20'))) {
        tags.push(newTag(TagType.Date, null, '', series, '', ''));
      }
      st.start.push(...tags);
      st.i = i;
      return true;
    },
  };
}

/** Music catalogue ids in parentheses: (ABC-1234). */
export function idLexer(): Lexer {
  const alpha = goReG('[A-Z]');
  const digit = goReG('\\d');
  const ws = goReG('[\\-\\._ ]');
  const re = goRe('^([A-Z\\d\\-\\_\\. ]{2,24})\\)');
  const lb = goRe('\\([\\._ ]{0,2}$');
  return {
    lex: (src, buf, st) => {
      if (!lb.test(src.slice(0, st.i))) return false;
      const m = findSubmatch(re, buf.slice(st.i, st.n));
      if (!m) return false;
      const a = findAllSubmatch(alpha, m[1]).length;
      const d = findAllSubmatch(digit, m[1]).length;
      const w = findAllSubmatch(ws, m[1]).length;
      if ((a === 0 && d > 4 && w < 4) || (a > 1 && d > 1 && a + d > 4 && w < 4)) {
        st.start.push(newTag(TagType.ID, null, src.slice(st.i, st.i + m[0].length), m[1]));
        st.i += m[0].length;
        return true;
      }
      return false;
    },
  };
}

/** A lone episode after a dash: `- 2 -`, `- 867 (`, `- 100 [`. */
export function episodeLexer(): Lexer {
  const re = goRe('^(\\d{1,4})(\\b|[\\._ ]?[\\-\\[\\]\\(\\)\\{\\}])');
  const lb = goRe('-[\\-\\._ ]{1,3}$');
  return {
    lex: (src, _buf, st) => {
      if (!lb.test(src.slice(0, st.i))) return false;
      const m = findSubmatch(re, src.slice(st.i, st.n));
      if (!m || src.slice(st.i + m[1].length).startsWith(',')) return false;
      st.start.push(newTag(TagType.Series, null, m[1], '', m[1]));
      if (m[2] !== '') st.start.push(newTag(TagType.Delim, null, m[2], m[2]));
      st.i += m[0].length;
      return true;
    },
  };
}

/** Versions: v1.2, Version 2004, 11.09.1. */
export function versionLexer(...strs: string[]): Lexer {
  const lexer = namedCaptureLexer(...strs);
  return {
    notFirst: true,
    lex: (src, buf, st) => {
      const r = lexer(src, buf, st.i, st.n);
      if (!r) return false;
      const [s, v, i] = r;
      let version = '';
      for (let l = 0; l < v.length; l += 2) {
        switch (v[l]) {
          case 'v':
            version = s.toLowerCase();
            if (version.startsWith('version')) version = version.slice('version'.length + 1);
            version = version.split(' ').join('.');
            break;
          case 'V':
            version = v[l + 1];
            break;
          case 'u':
            version = 'v' + v[l + 1];
            break;
          default:
            throw new Error(`unknown capture group ${JSON.stringify(v[l])}`);
        }
      }
      st.start.push(newTag(TagType.Version, null, s, version));
      st.i = i;
      return true;
    },
  };
}

/** Combined disc, source and year: VLS2004, 2DVD1999, WEB2007. */
export function discSourceYearLexer(...strs: string[]): Lexer {
  let sourcef: FindFunc | null = null;
  const lexer = namedCaptureLexer(...strs);
  return {
    init: (infos) => {
      sourcef = find(infos['source'] ?? []);
    },
    lex: (src, buf, st) => {
      const r = lexer(src, buf, st.i, st.n);
      if (!r) return false;
      const [, v, i] = r;
      let disc = '';
      let source = '';
      let year = '';
      for (let l = 0; l < v.length; l += 2) {
        switch (v[l]) {
          case 'd':
            disc = v[l + 1];
            break;
          case 's':
            source = v[l + 1];
            break;
          case 'y':
            year = v[l + 1];
            break;
          default:
            throw new Error(`unknown capture group ${JSON.stringify(v[l])}`);
        }
      }
      if (disc !== '') st.start.push(newTag(TagType.Disc, null, disc, 'X', disc));
      st.start.push(newTag(TagType.Source, sourcef, source, source), newTag(TagType.Date, null, year, year, '', ''));
      // Fix (differs from Go rls): rls advances by len(s) a second time here
      // (its i is already past s), losing the text after the tag, e.g. .FLAC
      // in Album.VLS2004.FLAC-GRP. Advance once, as the other lexers do.
      st.i = i;
      return true;
    },
  };
}

/** Discs: D01, CD2, 2xDVD9, 2Vinyl, ... */
export function discLexer(...strs: string[]): Lexer {
  let sourcef: FindFunc | null = null;
  let sizef: FindFunc | null = null;
  const lexer = namedCaptureLexer(...strs);
  const re = goRe('(?i)^dvd|cd|d|s|x');
  return {
    init: (infos) => {
      sourcef = find(infos['source'] ?? []);
      sizef = find(infos['size'] ?? []);
    },
    lex: (src, buf, st) => {
      const r = lexer(src, buf, st.i, st.n);
      if (!r) return false;
      const [s, v, j] = r;
      let typ = '';
      let c = '';
      let x = '';
      let z = '';
      for (let l = 0; l < v.length; l += 2) {
        switch (v[l]) {
          case 'c':
            c = v[l + 1];
            break;
          case 't':
            typ = v[l + 1].toUpperCase();
            break;
          case 'x':
            x = v[l + 1].toUpperCase();
            break;
          case 'z':
            typ = 'Z';
            z = v[l + 1].toUpperCase();
            break;
          default:
            throw new Error(`unknown capture group ${JSON.stringify(v[l])}`);
        }
      }
      if (typ !== '') typ = typ.slice(0, findSubmatch(re, s)![0].length).toUpperCase();
      const k = c.length + 1;
      switch (typ) {
        case 'D':
        case 'S':
          st.start.push(newTag(TagType.Disc, null, s, typ, c));
          break;
        case 'DVDA':
        case 'DVD':
        case 'CD':
          st.start.push(
            newTag(TagType.Source, sourcef, s.slice(0, typ.length), typ, typ),
            newTag(TagType.Disc, null, s.slice(typ.length), typ, c),
          );
          break;
        case 'X':
          if (s.slice(k).toUpperCase() === 'DVD9') {
            st.start.push(newTag(TagType.Disc, null, s.slice(0, k), typ, c), newTag(TagType.Size, sizef, s.slice(k), s.slice(k)));
          } else {
            st.start.push(newTag(TagType.Disc, null, s.slice(0, k), typ, c), newTag(TagType.Source, sourcef, s.slice(k), s.slice(k)));
          }
          break;
        case 'Z':
          st.start.push(newTag(TagType.Disc, null, s.slice(0, k), 'X', c), newTag(TagType.Size, sizef, s.slice(k), z));
          break;
        case '':
          st.start.push(newTag(TagType.Disc, null, s.slice(0, k), 'X', c), newTag(TagType.Source, sourcef, s.slice(k), x));
          break;
        default:
          throw new Error(`unknown type ${JSON.stringify(typ)}`);
      }
      st.i = j;
      return true;
    },
  };
}

/** Audio, with channels straight after it: DDP5.1, AAC2.0. */
export function audioLexer(): Lexer {
  let re: RegExp | null = null;
  let audiof: FindFunc | null = null;
  let channelsf: FindFunc | null = null;
  return {
    init: (infos) => {
      const audio = infos['audio'] ?? [];
      const channels = infos['channels'] ?? [];
      const v = channels.map((info) => info.tag.split('.').join('[\\._ ]?'));
      const codec = taginfoRe('', infos['codec'] ?? []);
      re = goRe(
        taginfoRe('^i', audio) +
          '(?:[\\-\\._ ]?(' +
          v.join('|') +
          '))?(?:\\b|[\\-\\._ ]|(' +
          codec +
          '(?:\\b|[\\-\\._ ])))',
      );
      audiof = find(audio);
      channelsf = find(channels);
    },
    lex: (src, _buf, st) => {
      const m = findSubmatch(re!, src.slice(st.i, st.n));
      if (!m) return false;
      let m0 = m[0];
      // leave an attached codec and its delimiter for the next lexer
      if (m[3] !== '' && m0.endsWith(m[3])) m0 = m0.slice(0, m0.length - m[3].length);
      const l = m0.length;
      if (m[2] !== '' && m0.endsWith(m[2])) m0 = m0.slice(0, m0.length - m[2].length);
      st.start.push(newTag(TagType.Audio, audiof, m0, m[1]));
      if (m[2] !== '') st.start.push(newTag(TagType.Channels, channelsf, m[2], m[2]));
      st.i += l;
      return true;
    },
  };
}

/** Genres: (Rock), or a genre's other form. */
export function genreLexer(): Lexer {
  let genref: FindFunc | null = null;
  let re: RegExp | null = null;
  let lb: RegExp | null = null;
  let other: RegExp | null = null;
  return {
    init: (infos) => {
      const genre = infos['genre'] ?? [];
      const v: string[] = [];
      const tagv: string[] = [];
      for (const info of genre) {
        v.push(info.RE());
        if (info.other !== '') tagv.push(info.other);
      }
      const s = '\\(?(' + v.join('|') + ')\\s*\\)';
      re = goRe('(?i)^' + s);
      lb = goRe('(?i)\\(\\s*' + s + '$');
      other = goRe('(?i)^(' + tagv.join('|') + ')\\b');
      genref = find(genre);
    },
    lex: (src, buf, st) => {
      let m = findSubmatch(re!, src.slice(st.i, st.n));
      if (m && lb!.test(src.slice(0, st.i + m[0].length))) {
        st.start.push(newTag(TagType.Genre, genref, ...m));
        st.i += m[0].length;
        return true;
      }
      m = findSubmatch(other!, buf.slice(st.i, st.n));
      if (m) {
        st.start.push(newTag(TagType.Genre, genref, ...m));
        st.i += m[0].length;
        return true;
      }
      return false;
    },
  };
}

/** Bounds a group name whose words are space- or underscore-separated. */
export const spacedGroup = goRe('(?i)^[a-z_ ]{2,10}$');

/** The release group after the last `-`, or a known group at the end. */
export function groupLexer(): Lexer {
  const delim = '-';
  const invalid = ' _.()[]{}+';
  const year = goRe('\\b(19|20)\\d{2}\\b');
  const bracket = goRe('^[\\]\\)\\}]');
  let groupf: FindFunc | null = null;
  let otherf: FindFunc | null = null;
  let re: RegExp | null = null;
  let special: RegExp | null = null;
  let shortTags = new Set<string>();
  return {
    once: true,
    init: (infos, _delim, short) => {
      const group = infos['group'] ?? [];
      const other = infos['other'] ?? [];
      const v = other.map((info) => info.other).filter((s) => s !== '');
      groupf = find(group);
      otherf = find(other);
      re = goRe('(?i)[\\-\\._ ]+' + taginfoRe('$', group));
      special = goRe('(?i)_(' + v.join('|') + ')$');
      shortTags = short;
    },
    lex: (src, buf, st) => {
      const { i } = st;
      // special end tags on groups
      let m = findSubmatch(special!, src.slice(i, st.n));
      if (m) {
        st.end.push(newTag(TagType.Other, otherf, ...m));
        st.n -= m[0].length;
      }
      const n = st.n;
      // known groups
      m = findSubmatch(re!, src.slice(i, n));
      if (m) {
        st.end.push(newTag(TagType.Group, groupf, ...m));
        st.n = n - m[0].length;
        return true;
      }
      // clamp to the end of the first year; rls uses the offset within
      // buf[i:n] as an absolute position
      let l = i;
      const first = year.exec(buf.slice(l, n));
      if (first) l = byteToIndex(buf, utf8Len(buf.slice(i, i + first.index + first[0].length)));
      // locate delimiter and check valid group
      const j = buf.slice(l, n).lastIndexOf(delim);
      if (j !== -1) {
        const s = src.slice(l + j + 1, n);
        const grp = trimChars(s, ' \t_');
        const last = st.end[st.end.length - 1];
        if (
          grp.length !== 0 &&
          (!containsAny(s, invalid) || (utf8Len(s) <= 14 && spacedGroup.test(grp))) &&
          !shortTags.has(grp) &&
          (st.end.length === 0 || !bracket.test(last.text()))
        ) {
          st.end.push(newTag(TagType.Group, null, s, grp), newTag(TagType.Delim, null, src.slice(l + j, l + j + 1), delim));
          st.n = l + j;
          return false;
        }
      }
      return false;
    },
  };
}

/** File meta at either end: [site], [[key:value]], {{pass}}, [REQ], [ABCD1234]. */
export function metaLexer(...strs: string[]): Lexer {
  if (strs.length % 4 !== 0) throw new Error('must be divisible by 4');
  const o = strs.length / 4;
  const prefix: RegExp[] = [];
  const suffix: RegExp[] = [];
  const hasTwo: boolean[] = [];
  for (let l = 0; l < o; l++) {
    const s = '\\s*\\Q' + strs[l * 4 + 1] + '\\E\\s*' + strs[l * 4 + 3] + '\\s*\\Q' + strs[l * 4 + 2] + '\\E\\s*';
    const p = goRegexp('^' + s);
    prefix.push(p.re);
    suffix.push(goRe(s + '$'));
    if (p.names.length !== 1 && p.names.length !== 2) throw new Error('must have exactly 1 or 2 capture groups');
    hasTwo.push(p.names.length === 2);
  }
  let delim: RegExp | null = null;
  let shortTags = new Set<string>();
  return {
    once: true,
    init: (_infos, d, short) => {
      delim = d;
      shortTags = short;
    },
    lex: (src, _buf, st) => {
      let { i, n } = st;
      let d = '';
      let m: string[] | null = null;
      let k = '';
      let v = '';
      let matched = false;
      const prev = new Set<string>();
      const check = (re: RegExp, l: number, s: string): boolean => {
        m = findSubmatch(re, s);
        if (!m) return false;
        k = strs[l * 4];
        v = m[1];
        if (hasTwo[l]) {
          k = m[1];
          v = m[2];
        }
        const short = strs[l * 4 + 1].length === 1 && shortTags.has(v.toUpperCase());
        const ok = !prev.has(k) && !short && !containsAny(v, '\t\r\n\f +');
        prev.add(k);
        return ok;
      };
      // prefixes
      for (; i < n; i++) {
        matched = false;
        for (let l = 0; l < o && !matched; l++) matched = check(prefix[l], l, src.slice(i, n));
        if (matched) {
          if (d.length !== 0) {
            st.start.push(newTag(TagType.Delim, null, d, d));
            d = '';
          }
          const mm = m as unknown as string[];
          st.start.push(newTag(TagType.Meta, null, mm[0], k, v));
          i = i + mm[0].length - 1;
        } else if (!delim!.test(src.slice(i, i + 1))) {
          break;
        } else {
          d += src[i];
        }
      }
      // backtrack remaining
      if (d.length !== 0) {
        i -= d.length;
        d = '';
      }
      // suffixes
      for (; i < n; n--) {
        matched = false;
        for (let l = 0; l < o && !matched; l++) matched = check(suffix[l], l, src.slice(i, n));
        if (matched) {
          if (d.length !== 0) {
            st.end.push(newTag(TagType.Delim, null, d, d));
            d = '';
          }
          const mm = m as unknown as string[];
          st.end.push(newTag(TagType.Meta, null, mm[0], k, v));
          n = n - mm[0].length + 1;
        } else if (!delim!.test(src.slice(n - 1, n))) {
          break;
        } else {
          d = src[n - 1] + d;
        }
      }
      // backtrack remaining
      if (d.length !== 0) st.end.push(newTag(TagType.Delim, null, d, d));
      st.i = i;
      st.n = n;
      return true;
    },
  };
}

/** File extension at the end: .mkv, .epub, ... */
export function extLexer(): Lexer {
  let extf: FindFunc | null = null;
  let re: RegExp | null = null;
  return {
    once: true,
    init: (infos) => {
      const ext = infos['ext'] ?? [];
      re = goRe('(?i:\\.' + taginfoRe('$', ext) + ')');
      extf = find(ext);
    },
    lex: (src, _buf, st) => {
      const m = findSubmatch(re!, src.slice(st.i, st.n));
      if (!m) return false;
      st.end.push(newTag(TagType.Ext, extf, ...m));
      st.n -= m[0].length;
      return true;
    },
  };
}

/** A tag from the vocabulary, matched on buf between word boundaries. */
export function regexpLexer(typ: TagType, ignoreCase: boolean): Lexer {
  let f: FindFunc | null = null;
  let re: RegExp | null = null;
  return {
    init: (infos) => {
      const info = infos[typeKey(typ)] ?? [];
      re = goRe(taginfoRe(ignoreCase ? '^ib' : '^b', info));
      f = find(info);
    },
    lex: (src, buf, st) => {
      const m = findSubmatch(re!, buf.slice(st.i, st.n));
      if (!m) return false;
      st.start.push(newTag(typ, f, src.slice(st.i, st.i + m[0].length), ...m.slice(1)));
      st.i += m[0].length;
      return true;
    },
  };
}

/** A tag from the vocabulary, matched on src; a trailing delimiter becomes its own tag. */
export function regexpSourceLexer(typ: TagType, ignoreCase: boolean): Lexer {
  let f: FindFunc | null = null;
  let re: RegExp | null = null;
  return {
    init: (infos) => {
      const info = infos[typeKey(typ)] ?? [];
      re = goRe(taginfoRe(ignoreCase ? '^i' : '^', info) + '(?:\\b|[\\-\\._ ])');
      f = find(info);
    },
    lex: (src, _buf, st) => {
      const { i } = st;
      const m = findSubmatch(re!, src.slice(i, st.n));
      if (!m) return false;
      if (m[0].length !== m[1].length) {
        const v = src.slice(i, i + m[1].length);
        const d = src.slice(i + m[1].length, i + m[0].length);
        st.start.push(newTag(typ, f, v, v), newTag(TagType.Delim, null, d, d));
      } else {
        st.start.push(newTag(typ, f, src.slice(i, i + m[0].length), ...m.slice(1)));
      }
      st.i = i + m[0].length;
      return true;
    },
  };
}

const TYPE_KEYS: Partial<Record<TagType, string>> = {
  [TagType.Platform]: 'platform',
  [TagType.Arch]: 'arch',
  [TagType.Source]: 'source',
  [TagType.Resolution]: 'resolution',
  [TagType.Collection]: 'collection',
  [TagType.Codec]: 'codec',
  [TagType.HDR]: 'hdr',
  [TagType.BitDepth]: 'bitdepth',
  [TagType.Channels]: 'channels',
  [TagType.Other]: 'other',
  [TagType.Cut]: 'cut',
  [TagType.Edition]: 'edition',
  [TagType.Language]: 'language',
  [TagType.Size]: 'size',
  [TagType.Region]: 'region',
  [TagType.Container]: 'container',
};

function typeKey(typ: TagType): string {
  const k = TYPE_KEYS[typ];
  if (!k) throw new Error('no taginfo key for tag type ' + typ);
  return k;
}

/**
 * Returns a func matching the first regexp (with named groups) against
 * buf[i:n], giving the matched src text, name/value pairs for non-empty named
 * groups, and the new position.
 */
export function namedCaptureLexer(...strs: string[]): (src: string, buf: string, i: number, n: number) => [string, string[], number] | null {
  const regexps: { re: RegExp; idx: number[]; names: string[] }[] = [];
  for (const str of strs) {
    const { re, names } = goRegexp(str);
    const idx: number[] = [];
    const nm: string[] = [];
    names.forEach((name, j) => {
      if (name !== null && name !== '') {
        idx.push(j + 1);
        nm.push(name);
      }
    });
    if (idx.length !== 0) regexps.push({ re, idx, names: nm });
  }
  return (src, buf, i, n) => {
    for (const { re, idx, names } of regexps) {
      const m = findSubmatch(re, buf.slice(i, n));
      if (!m) continue;
      const v: string[] = [];
      idx.forEach((k, j) => {
        if (m[k] !== '') v.push(names[j], m[k]);
      });
      if (v.length !== 0) return [src.slice(i, i + m[0].length), v, i + m[0].length];
    }
    return null;
  };
}
