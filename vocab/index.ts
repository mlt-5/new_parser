// Collects the vocab files into tag info for the parser, on top of rls's
// taginfo.csv. Add entries in the per-type files, not here.

import { all, must, type TaginfoMap } from '../src/taginfo';
import { releaseTypeName } from '../src/types';
import { entries as arch } from './arch';
import { entries as audio } from './audio';
import { entries as bitdepth } from './bitdepth';
import { entries as channels } from './channels';
import { entries as codec } from './codec';
import { entries as collection } from './collection';
import { entries as container } from './container';
import { entries as cut } from './cut';
import { entries as edition } from './edition';
import { entries as ext } from './ext';
import { entries as genre } from './genre';
import { entries as group } from './group';
import { entries as hdr } from './hdr';
import { entries as language } from './language';
import { entries as other } from './other';
import { entries as platform } from './platform';
import { entries as region } from './region';
import { entries as resolution } from './resolution';
import { entries as size } from './size';
import { entries as source } from './source';
import type { VocabEntryWithOther } from './types';

export type { ReleaseKind, VocabEntry, VocabEntryWithOther } from './types';

/** Every vocab list, keyed by rls's taginfo type. */
export const VOCAB: Record<string, VocabEntryWithOther[]> = {
  arch,
  audio,
  bitdepth,
  channels,
  codec,
  collection,
  container,
  cut,
  edition,
  ext,
  genre,
  group,
  hdr,
  language,
  other,
  platform,
  region,
  resolution,
  size,
  source,
};

/** A tag as a regexp where each separator may be any of - . _ or space, or left out ('WEB-DL' matches 'WEB.DL' and 'WEBDL'). */
export function tagRe(tag: string): string {
  return tag
    .split(/[-._ ]+/)
    .map((w) => '\\Q' + w + '\\E')
    .join('[\\-\\._ ]?');
}

/**
 * The regexp for an entry: its match (or plain tag), then each alias. For a tag rls already has, the plain tag
 * is left out: rls's pattern reads it, and the loose one could read more ('2.0' would also find '20').
 */
export function entryRe(e: VocabEntryWithOther, rlsHasTag = false): string {
  const own = e.match ? [e.match] : rlsHasTag ? [] : [tagRe(e.tag)];
  return [...own, ...(e.aliases ?? []).map(tagRe)].join('|');
}

/** A taginfo.csv row for a vocab entry: Type, Tag, Title, Regexp, Other, ReleaseType, TypeExclusive. */
export type VocabRow = [string, string, string, string, string, string, string];

/** The vocab entries as taginfo.csv rows, as Go reads them from ../go/vocab.csv (scripts/gen-vocab-csv.mjs). */
export function vocabRows(vocab: Record<string, VocabEntryWithOther[]> = VOCAB): VocabRow[] {
  const rls = all();
  const rows: VocabRow[] = [];
  for (const [typ, list] of Object.entries(vocab)) {
    for (const e of list) {
      // an entry for one of rls's tags adds spellings to it, keeping what rls says about it
      const base = (rls[typ] ?? []).find((info) => info.tag === e.tag);
      const title = e.title ?? (base && base.title !== base.tag ? base.title : '');
      const type = e.type ?? (base ? releaseTypeName(base.type) : '');
      const exclusive = e.exclusive ?? base?.excl ?? false;
      const other = e.other ?? base?.other ?? '';
      if (exclusive && !type) throw new Error(`vocab/${typ}.ts: ${JSON.stringify(e.tag)} is exclusive but has no type`);
      rows.push([typ, e.tag, title, entryRe(e, !!base), other, type, exclusive ? '1' : '']);
    }
  }
  return rows;
}

/** Tag info for vocab entries, to pass to newDefaultParser. */
export function vocabTaginfo(vocab: Record<string, VocabEntryWithOther[]> = VOCAB): TaginfoMap {
  const out: TaginfoMap = {};
  for (const [typ, tag, ...rest] of vocabRows(vocab)) {
    try {
      (out[typ] ??= []).push(must(tag, ...rest));
    } catch (err) {
      throw new Error(`vocab/${typ}.ts: ${JSON.stringify(tag)}: ${(err as Error).message}`);
    }
  }
  return out;
}
