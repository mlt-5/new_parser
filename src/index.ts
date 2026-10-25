// TypeScript port of rls (github.com/autobrr/rls v0.10.0, a fork of
// github.com/moistari/rls), the release-name parser autobrr uses.
// rls: Copyright (c) 2020-2022 m. jo istari, MIT licence (see ../rls/LICENSE).

import { vocabTaginfo } from '../vocab/index';
import { getDefaultParser, newDefaultParser, TagParser, TagBuilder } from './parse';
import type { Release } from './release';
import { find, type FindFunc } from './taginfo';

export { Release } from './release';
export { Tag, newTag } from './tag';
export { Taginfo, all as allTaginfo, find as findTaginfo, load as loadTaginfo, must as mustTaginfo } from './taginfo';
export type { FindFunc, TaginfoMap } from './taginfo';
export { TagType, ReleaseType, tagTypeName, releaseTypeName, parseReleaseType } from './types';
export { defaultLexers } from './lex';
export type { Lexer, LexFunc, LexState } from './lex';
export { mustClean, mustNormalize } from './normalize';
export { compare, compareTitle } from './compare';
export { TagParser, TagBuilder, newDefaultParser };

export { VOCAB, vocabRows, vocabTaginfo, tagRe } from '../vocab/index';
export type { ReleaseKind, VocabEntry, VocabEntryWithOther, VocabRow } from '../vocab/index';

let parser: TagParser | null = null;
let listedGroup: FindFunc | null = null;

/** Parses a release name: rls plus the entries in ../vocab/. */
export function parse(name: string): Release {
  if (!parser) {
    const infos = vocabTaginfo();
    parser = newDefaultParser(infos);
    listedGroup = find(infos.group ?? []);
  }
  return leadingGroup(name, parser.parseRelease(name));
}

/**
 * Fansub names put the group first: '[SubsPlease] Title - 04 (1080p) [hash]'. rls reads that bracket as the site
 * and looks for the group after the last '-'. When the bracket holds a group listed in ../vocab/group.ts, it is
 * the group (as written) instead, and not the site.
 */
function leadingGroup(name: string, r: Release): Release {
  // ASCII whitespace only, as go/parse.go (Go's \s and the cutset there)
  const m = /^[\t\n\f\r ]*\[([^\]]+)\]/.exec(name);
  const x = m?.[1].replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '') ?? '';
  if (!x || !listedGroup?.(x)) return r;
  r.group = x;
  if (r.site === x) r.site = '';
  return r;
}

/** Parses a release name with plain rls, as the Go comparisons need. */
export function parseRls(name: string): Release {
  return getDefaultParser().parseRelease(name);
}

/** Every field of a release as a plain object, in rls field order. */
export function releaseFields(r: Release) {
  return {
    type: r.type,
    artist: r.artist,
    title: r.title,
    subtitle: r.subtitle,
    alt: r.alt,
    platform: r.platform,
    arch: r.arch,
    source: r.source,
    resolution: r.resolution,
    collection: r.collection,
    year: r.year,
    month: r.month,
    day: r.day,
    series: r.series,
    episode: r.episode,
    version: r.version,
    disc: r.disc,
    codec: [...r.codec],
    hdr: [...r.hdr],
    bitDepth: r.bitDepth,
    audio: [...r.audio],
    channels: r.channels,
    other: [...r.other],
    cut: [...r.cut],
    edition: [...r.edition],
    language: [...r.language],
    size: r.size,
    region: r.region,
    container: r.container,
    genre: r.genre,
    id: r.id,
    group: r.group,
    meta: [...r.meta],
    site: r.site,
    sum: r.sum,
    pass: r.pass,
    req: r.req,
    ext: r.ext,
  };
}
