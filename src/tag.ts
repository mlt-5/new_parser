// Release tags, ported from rls (rls.go: Tag).

import type { FindFunc, Taginfo } from './taginfo';
import { ReleaseType, TagType, tagTypeName } from './types';

/** Go strconv.Atoi with the error ignored: 0 unless s is a plain integer. */
export function atoi(s: string): number {
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : 0;
}

/** Go fmt %02d. */
export function pad2(n: number): string {
  return n < 0 ? '-' + String(-n).padStart(2, '0') : String(n).padStart(2, '0');
}

/** A release tag: its type and captured values. v[0] is the original text. */
export class Tag {
  readonly typ: TagType;
  readonly v: readonly string[];
  readonly f: FindFunc | null;
  readonly prev: TagType;
  readonly prevf: FindFunc | null;

  constructor(typ: TagType, v: readonly string[], f: FindFunc | null, prev: TagType = TagType.Whitespace, prevf: FindFunc | null = null) {
    this.typ = typ;
    this.v = v;
    this.f = f;
    this.prev = prev;
    this.prevf = prevf;
  }

  /** Copy of the tag as another type, remembering the previous one. */
  as(typ: TagType, f: FindFunc | null): Tag {
    return new Tag(typ, this.v, f, this.typ, this.f);
  }

  /** Copy of the tag as its previous type. */
  revert(): Tag {
    return new Tag(this.prev, this.v, this.prevf);
  }

  is(...types: TagType[]): boolean {
    return types.includes(this.typ);
  }

  was(...types: TagType[]): boolean {
    return types.includes(this.prev);
  }

  tagType(): TagType {
    return this.typ;
  }

  /** The original captured text. */
  original(): string {
    return this.v[0];
  }

  info(): Taginfo | null {
    return this.f ? this.f(this.normalize()) : null;
  }

  singleEp(): boolean {
    if (this.typ === TagType.Series) {
      const [s, e] = this.series();
      return s === 0 && e !== 0 && this.v[1] === '' && this.v[0] === this.v[2];
    }
    return false;
  }

  infoType(): ReleaseType {
    return this.info()?.type ?? ReleaseType.Unknown;
  }

  infoExcl(): boolean {
    return this.info()?.excl ?? false;
  }

  infoTitle(): string {
    const info = this.info();
    if (!info) return '';
    let s = info.title;
    for (let i = 1; i < this.v.length; i++) s = s.split('$' + (i + 1)).join(this.v[i]);
    return s;
  }

  /** Normalizes s via the tag info, replacing $1, $2, ... with v. */
  private norm(s: string, ...v: string[]): string {
    if (this.f) {
      const info = this.f(s);
      if (info) s = info.tag;
      for (let i = 0; i < v.length; i++) s = s.split('$' + (i + 1)).join(v[i]);
    }
    return s;
  }

  private normRest(): string {
    return this.norm(this.v[1], ...this.v.slice(2));
  }

  /** The normalized string for the tag (Go %s). */
  normalize(): string {
    switch (this.typ) {
      case TagType.Whitespace:
      case TagType.Delim:
        return this.v[1];
      case TagType.Text:
        return this.text();
      case TagType.Date: {
        const [year, month, day] = this.date();
        if (month !== 0 && day !== 0) return `${year}-${pad2(month)}-${pad2(day)}`;
        return String(year);
      }
      case TagType.Series: {
        const [series, episode] = this.series();
        return episode !== 0 ? `S${pad2(series)}E${pad2(episode)}` : `S${pad2(series)}`;
      }
      case TagType.Version:
        return this.v[1];
      case TagType.Disc:
        return this.disc();
      case TagType.Channels:
        return this.channels();
      case TagType.Other:
        return this.other();
      case TagType.Size:
        return this.size();
      case TagType.Group:
        return this.v[1];
      case TagType.Meta: {
        const [typ, s] = this.meta();
        switch (typ) {
          case 'site':
          case 'sum':
            return '[' + s + ']';
          case 'pass':
            return '{{' + s + '}}';
          case 'req':
            return '[REQ]';
        }
        return '[[' + typ + ':' + s + ']]';
      }
      case TagType.Ext:
        return this.ext();
      case TagType.Platform:
      case TagType.Arch:
      case TagType.Source:
      case TagType.Resolution:
      case TagType.Collection:
      case TagType.Codec:
      case TagType.HDR:
      case TagType.BitDepth:
      case TagType.Audio:
      case TagType.Cut:
      case TagType.Edition:
      case TagType.Language:
      case TagType.Region:
      case TagType.Container:
      case TagType.Genre:
      case TagType.ID:
        return this.normRest();
    }
    return '';
  }

  /** Go %e: <Type:normal>. */
  debug(): string {
    return '<' + tagTypeName(this.typ) + ':' + JSON.stringify(this.normalize()).slice(1, -1) + '>';
  }

  whitespace(): string {
    return this.v[1];
  }

  delim(): string {
    return this.v[1];
  }

  text(): string {
    switch (this.prev) {
      case TagType.Date:
      case TagType.Series:
        return this.v[0];
      case TagType.Channels:
        return this.channels();
    }
    return this.v[1];
  }

  /** Text with old replaced by newstr (all occurrences when n < 0). */
  textReplace(old: string, newstr: string, n: number): string {
    const s = this.text();
    if (this.prev === TagType.Channels) return s;
    if (n < 0) return s.split(old).join(newstr);
    let out = s;
    for (let k = 0; k < n; k++) out = out.replace(old, newstr);
    return out;
  }

  platform(): string {
    return this.normRest();
  }
  arch(): string {
    return this.normRest();
  }
  source(): string {
    return this.normRest();
  }
  resolution(): string {
    return this.normRest();
  }
  collection(): string {
    return this.normRest();
  }

  date(): [number, number, number] {
    return [atoi(this.v[1]), atoi(this.v[2]), atoi(this.v[3])];
  }

  series(): [number, number] {
    return [atoi(this.v[1]), atoi(this.v[2])];
  }

  episodes(): number[] {
    return this.v
      .slice(2)
      .map(atoi)
      .filter((e) => e !== 0);
  }

  version(): string {
    return this.v[1];
  }

  disc(): string {
    const disc = atoi(this.v[2]);
    switch (this.v[1]) {
      case 'CD':
      case 'DVD':
        return this.v[1] + disc;
      case 'S':
        return disc + 'DiSCS';
      case 'X':
        return disc + 'x';
    }
    return 'D' + pad2(disc);
  }

  codec(): string {
    return this.normRest();
  }
  hdr(): string {
    return this.normRest();
  }
  bitDepth(): string {
    return this.normRest();
  }
  audio(): string {
    return this.normRest();
  }

  channels(): string {
    const s = this.norm(this.v[1]).replace(/[^0-9]/g, '');
    // Fix (as in rls/rls.go, differs from upstream rls): a channels spelling
    // without digits (vocab alias STEREO for 2.0) has none once its tag is
    // discarded and it is text again; keep the word (Go panics, '.' before).
    if (s === '') return this.v[1];
    return s.slice(0, 1) + '.' + s.slice(1);
  }

  other(): string {
    const s = this.normRest();
    const y = s.toUpperCase();
    return y === '19XX' || y === '20XX' ? y : s;
  }

  cut(): string {
    return this.normRest();
  }
  edition(): string {
    return this.normRest();
  }
  language(): string {
    return this.normRest();
  }

  size(): string {
    return this.normRest().toUpperCase().split('I').join('i');
  }

  region(): string {
    return this.normRest();
  }
  container(): string {
    return this.normRest();
  }
  genre(): string {
    return this.normRest();
  }
  id(): string {
    return this.normRest();
  }

  group(): string {
    return this.v[1];
  }

  meta(): [string, string] {
    return [this.v[1], this.v[2]];
  }

  ext(): string {
    return this.v[1].toLowerCase();
  }
}

/** Creates a tag; at least the original text and one value are required. */
export function newTag(typ: TagType, f: FindFunc | null, ...v: string[]): Tag {
  if (v.length < 2) throw new Error('must provide at least 2 values to newTag');
  return new Tag(typ, v, f);
}
