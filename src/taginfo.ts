// Tag info: the vocabulary rls matches (taginfo.csv), ported from rls/taginfo.

import { goRe } from './goRegexp';
import { TAGINFO_CSV } from './taginfoData';
import { parseReleaseType, ReleaseType } from './types';

const COLUMNS = 6;

/** Describes one known tag. */
export class Taginfo {
  readonly tag: string;
  readonly title: string;
  readonly regexp: string;
  readonly other: string;
  readonly type: ReleaseType;
  readonly excl: boolean;
  private readonly re: RegExp;

  constructor(tag: string, title: string, regexp: string, other: string, typ: string, excl: string) {
    if (tag === '') throw new Error('must define tag');
    const t = parseReleaseType(typ);
    if (typ !== '' && t === ReleaseType.Unknown) throw new Error(`invalid type ${JSON.stringify(typ)}`);
    this.tag = tag;
    this.title = title === '' ? tag : title;
    this.regexp = regexp;
    this.other = other;
    this.type = t;
    this.excl = excl === '1';
    this.re = goRe('(?i)^(?:' + this.RE() + ')$');
  }

  /** The tag's regexp source (Go syntax); the quoted tag when none is set. */
  RE(): string {
    return this.regexp !== '' ? this.regexp : '\\Q' + this.tag + '\\E';
  }

  /** Whether s is this tag. */
  match(s: string): boolean {
    return this.re.test(s);
  }
}

export type TaginfoMap = Record<string, Taginfo[]>;

/** Finds the tag info for a string. */
export type FindFunc = (s: string) => Taginfo | null;

/** Returns a func finding the first info in infos that matches. Results are cached. */
export function find(infos: Taginfo[]): FindFunc {
  const memo = new Map<string, Taginfo | null>();
  return (s: string) => {
    let v = memo.get(s);
    if (v === undefined) {
      v = infos.find((info) => info.match(s)) ?? null;
      memo.set(s, v);
    }
    return v;
  };
}

/** Parses CSV the way Go's encoding/csv does (RFC 4180 quoting). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length !== 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Loads tag info from CSV text with the rls header. */
export function load(csv: string): TaginfoMap {
  const rows = parseCsv(csv);
  const head = rows[0];
  if (!head) throw new Error('empty csv');
  const want = ['Type', 'Tag', 'Title', 'Regexp', 'Other', 'ReleaseType', 'TypeExclusive'];
  if (head.length !== COLUMNS + 1 || want.some((w, k) => head[k] !== w)) {
    throw new Error('must have csv headers ' + want.join(', '));
  }
  const m: TaginfoMap = {};
  const exists = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i];
    if (v.length !== COLUMNS + 1) throw new Error(`line ${i}: wrong number of fields`);
    const key = v[0] + '\u0000' + v[1];
    if (exists.has(key)) {
      throw new Error(`line ${i}: type ${v[0]} with tag ${v[1]} previously defined on line ${exists.get(key)}`);
    }
    let info: Taginfo;
    try {
      info = new Taginfo(v[1], v[2], v[3], v[4], v[5], v[6]);
    } catch (err) {
      throw new Error(`line ${i}: tag ${JSON.stringify(v[1])}: ${(err as Error).message}`);
    }
    (m[v[0]] ??= []).push(info);
    exists.set(key, i);
  }
  return m;
}

let embedded: TaginfoMap | null = null;

/** All embedded tag info plus any extras (appended per type). */
export function all(...extras: TaginfoMap[]): TaginfoMap {
  embedded ??= load(TAGINFO_CSV);
  const out: TaginfoMap = {};
  for (const [k, v] of Object.entries(embedded)) out[k] = [...v];
  for (const extra of extras) {
    for (const [k, v] of Object.entries(extra)) out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}

/** Creates a tag info: tag, title, regexp, other, release type, exclusive ("1"). */
export function must(...strs: string[]): Taginfo {
  if (strs.length !== COLUMNS) throw new Error(`tag info must have ${COLUMNS} fields`);
  return new Taginfo(strs[0], strs[1], strs[2], strs[3], strs[4], strs[5]);
}
