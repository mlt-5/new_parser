// Release, ported from rls (rls.go: Release).

import type { Tag } from './tag';
import { TagType, ReleaseType } from './types';

/** Release information parsed from a name. Every field rls fills is kept. */
export class Release {
  type: ReleaseType = ReleaseType.Unknown;

  artist = '';
  title = '';
  subtitle = '';
  alt = '';

  platform = '';
  arch = '';

  source = '';
  resolution = '';
  collection = '';

  year = 0;
  month = 0;
  day = 0;

  series = 0;
  episode = 0;
  version = '';
  disc = '';

  codec: string[] = [];
  hdr: string[] = [];
  bitDepth = '';
  audio: string[] = [];
  channels = '';
  other: string[] = [];
  cut: string[] = [];
  edition: string[] = [];
  language: string[] = [];

  size = '';
  region = '';
  container = '';
  genre = '';
  id = '';
  group = '';
  meta: string[] = [];
  site = '';
  sum = '';
  pass = '';
  req = false;
  ext = '';

  /** @internal all tags, in order */
  _tags: Tag[];
  /** @internal indexes of date tags not used */
  _dates: number[] = [];
  /** @internal indexes of text tags not used in titles */
  _unused: number[] = [];
  /** @internal index of the first end tag */
  _end: number;

  constructor(tags: Tag[], end: number) {
    this._tags = tags;
    this._end = end;
  }

  /** All tags. */
  tags(): Tag[] {
    return this._tags;
  }

  /** Text tags not used in titles. */
  unused(): Tag[] {
    return this._unused.map((i) => this._tags[i]);
  }

  /** Date tags not used. */
  dates(): Tag[] {
    return this._dates.map((i) => this._tags[i]);
  }

  /** The original name, rebuilt from the tags. */
  toString(): string {
    return this._tags.map((t) => t.v[0]).join('');
  }

  /** All [series, episode] pairs, sorted; fills ranges like S01E01-E03. */
  seriesEpisodes(): [number, number][] {
    const v: [number, number][] = [];
    let last = -1;
    this._tags.forEach((tag, i) => {
      if (!tag.is(TagType.Series)) return;
      const [series] = tag.series();
      for (const episode of tag.episodes()) {
        let s = series;
        if (s === 0 && last !== -1) {
          let lastEp: number;
          [s, lastEp] = this._tags[last].series();
          if (i > 0 && this._tags[i - 1].v[0] === '-') {
            for (let j = lastEp + 1; j < episode; j++) v.push([s, j]);
          }
        }
        v.push([s, episode]);
      }
      if (series !== 0) last = i;
    });
    v.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
    return v;
  }
}
