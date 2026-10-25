// Tag parser and release builder, ported from rls (parse.go).

import { goRe, goReG } from './goRegexp';
import { defaultLexers, spacedGroup, utf8Len, type LexFunc, type Lexer, type LexState } from './lex';
import {
  fieldsFunc,
  isAnyDelim,
  isBreakDelim,
  isTitleTrimDelim,
  mustNormalize,
  trimFunc,
  trimLeftFunc,
  trimRightFunc,
} from './normalize';
import { unescapeHtml } from './htmlUnescape';
import { Release } from './release';
import { newTag, type Tag } from './tag';
import { all, find, type FindFunc, type TaginfoMap } from './taginfo';
import { ReleaseType, TagType } from './types';

const DELIM_CHARS = '\t\n\f\r ()+,-._[/\\]{}~';

/** Parses names into tags and builds releases. */
export class TagParser {
  private readonly builder: TagBuilder;
  private readonly delim: RegExp;
  private readonly once: LexFunc[] = [];
  private readonly multi: LexFunc[] = [];
  private readonly notFirst: boolean[] = [];

  constructor(infos: TaginfoMap, lexers: Lexer[]) {
    this.delim = /^([\t\n\f\r ()+,\-._[/\\\]{}~]+)/;
    // short tags: words under 5 bytes from every tag except HDR
    const short = new Set<string>();
    for (const [typ, v] of Object.entries(infos)) {
      if (typ === 'hdr') continue;
      for (const info of v) {
        for (const field of fieldsFunc(info.tag, isAnyDelim)) {
          if (utf8Len(field) < 5 && !field.includes('$')) short.add(field.toUpperCase());
        }
      }
    }
    for (const lexer of lexers) {
      lexer.init?.(infos, this.delim, short);
      if (lexer.once) {
        this.once.push(lexer.lex);
      } else {
        this.multi.push(lexer.lex);
        this.notFirst.push(lexer.notFirst ?? false);
      }
    }
    this.builder = new TagBuilder(infos);
  }

  /** Parses tags in src; returns the tags and the index of the first end tag. */
  parse(src: string): [Tag[], number] {
    const buf = src.replace(/[_,+]/g, ' ');
    const st: LexState = { start: [], end: [], i: 0, n: buf.length };
    for (const f of this.once) f(src, buf, st);
    const nf = { v: false };
    while (st.i < st.n) this.next(src, buf, st, nf);
    const tags = [...st.start, ...[...st.end].reverse()];
    return [tags, tags.length - st.end.length];
  }

  /** Reads the next delimiter, lexer match or run of text. */
  private next(src: string, buf: string, st: LexState, notFirst: { v: boolean }): void {
    const s = src.slice(st.i, st.n);
    if (s.startsWith('...')) {
      st.start.push(newTag(TagType.Delim, null, '...', '...'));
      st.i += 3;
      return;
    }
    const m = this.delim.exec(s);
    if (m) {
      st.start.push(newTag(TagType.Delim, null, m[0], m[1]));
      st.i += m[0].length;
      return;
    }
    const startn = st.start.length;
    for (let a = 0; a < this.multi.length; a++) {
      if (this.notFirst[a] && !notFirst.v) continue;
      if (this.multi[a](src, buf, st)) {
        notFirst.v = notFirst.v || startn !== st.start.length;
        return;
      }
    }
    // text
    let j = st.i;
    while (j < st.n && !DELIM_CHARS.includes(src[j])) j++;
    notFirst.v = true;
    st.start.push(newTag(TagType.Text, null, src.slice(st.i, j), src.slice(st.i, j)));
    st.i = j;
  }

  /** Parses a release from src. */
  parseRelease(src: string): Release {
    const [tags, end] = this.parse(src);
    return this.builder.build(tags, end);
  }
}

function contains(v: string[], s: string): boolean {
  return v.includes(s);
}

function remove(v: string[], s: string): string[] {
  return v.filter((t) => t !== s);
}

function peek(tags: Tag[], i: number, ...types: TagType[]): boolean {
  return i >= 0 && i < tags.length && tags[i].is(...types);
}

/** Whether the tag in direction inc (-1/+1) from i, past delimiters, is text. */
function isolated(tags: Tag[], i: number, inc: number): boolean {
  for (i += inc; 0 < i && i < tags.length - 1 && tags[i + inc].is(TagType.Whitespace, TagType.Delim); i += inc) {
    // skip
  }
  i += inc;
  return 0 <= i && i < tags.length - 1 && tags[i].is(TagType.Text);
}

const UPPER = /^\p{Lu}$/u;
const DIGIT = /^\p{Nd}$/u;

function isUpperLetter(s: string): boolean {
  const r = [...s];
  if (r.length === 0) return true;
  return r.length === 1 && UPPER.test(r[0]);
}

function isDigit(s: string): boolean {
  const r = [...s];
  return r.length === 1 && DIGIT.test(r[0]);
}

/** Go time.Parse("January", s): s must be a full month name (any case). */
function parseLongMonth(s: string): number {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return months.indexOf(s.toLowerCase()) + 1;
}

/** Builds a release from tags. */
export class TagBuilder {
  private readonly missing = goReG('\\b[A-Z][\\. ][A-Z](?:[\\. ][A-Z])*[\\. ]?\\b');
  private readonly bad = goReG('[^A-Z][-\\. ][A-Z]\\.($|[^A-Z])');
  private readonly fix = goReG('([A-Z])\\.');
  private readonly spaces = goReG('\\s+');
  private readonly ellips = goReG('\\.{3,}');
  private readonly plus = goReG('(\\+)');
  private readonly sum = goRe('(?i)^[a-f0-9]{8}$');
  private readonly digits = goRe('^\\d+$');
  private readonly digpre = goRe('^\\d+');
  private readonly digsuf = goRe('\\d+$');
  private readonly containerf: FindFunc;
  private readonly audiof: FindFunc;

  constructor(infos: TaginfoMap) {
    this.containerf = find(infos['container'] ?? []);
    this.audiof = find(infos['audio'] ?? []);
  }

  build(tags: Tag[], end: number): Release {
    const r = new Release(tags, end);
    this.init(r);
    this.collect(r);
    r.type = this.inspect(r, true);
    this.specialDate(r);
    this.unset(r);
    const i = this.titles(r);
    this.unused(r, i);
    return r;
  }

  private init(r: Release): void {
    this.fixFirstDate(r);
    const [m, pivot] = this.pivots(r, TagType.Date, TagType.Source, TagType.Series, TagType.Resolution, TagType.Version);
    const date = m.get(TagType.Date)!;
    const series = m.get(TagType.Series)!;
    if (date !== -1) r._dates.push(date);
    const dates = this.reset(r, date, TagType.Date);
    if (dates.length !== 0) r._dates.push(...dates);
    if (date !== -1 || series !== -1) {
      let i = Math.min(date, series);
      if (date === -1) i = series;
      else if (series === -1) i = date;
      this.fixSpecial(r, i, series !== -1);
    }
    const end = this.end(r, pivot);
    this.reset(r, end, TagType.Language, TagType.Arch, TagType.Platform);
    this.fixFirst(r);
    this.fixSourceWeb(r);
    const start = this.start(r, 0);
    this.fixBad(r, start, end);
    this.fixNoText(r, end);
    this.fixIsolated(r);
    this.fixMusic(r);
  }

  /** A date before any text, with no later date, becomes text. */
  private fixFirstDate(r: Release): void {
    const t = r._tags;
    let last = -1;
    let i: number;
    for (i = r._end; i > 0; i--) {
      if (t[i - 1].is(TagType.Date)) {
        last = i - 1;
        break;
      }
    }
    if (last === -1) return;
    for (i = 0; i < r._end && t[i].is(TagType.Whitespace, TagType.Delim); i++) {
      // seek first
    }
    if (i < last || (peek(t, i - 1, TagType.Delim) && t[i - 1].delim().endsWith('('))) {
      // keep
    } else if (t[i].is(TagType.Date)) {
      t[i] = t[i].as(TagType.Text, null);
    }
  }

  /** Last position of each type, and the earliest of those. */
  private pivots(r: Release, ...types: TagType[]): [Map<TagType, number>, number] {
    const m = new Map<TagType, number>();
    for (const typ of types) m.set(typ, -1);
    let j = -1;
    for (let i = r._end; i > 0; i--) {
      const typ = r._tags[i - 1].tagType();
      if (types.includes(typ) && m.get(typ) === -1) {
        m.set(typ, i - 1);
        j = i - 1;
      }
    }
    return [m, j !== -1 ? j : r._end];
  }

  /** Turns tags of types before i into text; returns their indexes. */
  private reset(r: Release, i: number, ...types: TagType[]): number[] {
    const v: number[] = [];
    for (; i > 0; i--) {
      if (r._tags[i - 1].is(...types)) {
        r._tags[i - 1] = r._tags[i - 1].as(TagType.Text, null);
        v.push(i - 1);
      }
    }
    return v;
  }

  private start(r: Release, i: number): number {
    for (; i < r._end && !r._tags[i].is(TagType.Text); i++) {
      // seek
    }
    return i;
  }

  private end(r: Release, i: number): number {
    for (; i > 0 && !r._tags[i - 1].is(TagType.Text); i--) {
      // seek
    }
    return i;
  }

  /** The first non-delimiter tag becomes text when it's a badly matched tag. */
  private fixFirst(r: Release): void {
    let i = 0;
    for (; i < r._end && r._tags[i].is(TagType.Whitespace, TagType.Delim); i++) {
      // seek
    }
    if (
      i !== r._end &&
      r._tags[i].is(
        TagType.Platform,
        TagType.Arch,
        TagType.Source,
        TagType.Resolution,
        TagType.Codec,
        TagType.HDR,
        TagType.BitDepth,
        TagType.Audio,
        TagType.Other,
        TagType.Cut,
        TagType.Edition,
        TagType.Language,
        TagType.Region,
      )
    ) {
      r._tags[i] = r._tags[i].as(TagType.Text, null);
    }
  }

  /**
   * A bare WEB source preceded by text becomes text when another source tag
   * follows, as a release names its source once amongst the technical tags
   * (ie, 'Show.S03E03.A.Dark.Web.1080p.WEBRip...').
   */
  private fixSourceWeb(r: Release): void {
    for (let i = 0; i < r._end; i++) {
      if (!r._tags[i].is(TagType.Source) || r._tags[i].source() !== 'WEB' || !isolated(r._tags.slice(0, r._end), i, -1)) {
        continue;
      }
      // seek source after i
      for (let j = i + 1; j < r._end; j++) {
        if (r._tags[j].is(TagType.Source)) {
          r._tags[i] = r._tags[i].as(TagType.Text, null);
          break;
        }
      }
    }
  }

  /** Collection/language/other/arch/platform tags inside the title become text. */
  private fixBad(r: Release, start: number, i: number): void {
    const t = r._tags;
    for (
      ;
      i > start &&
      t[i - 1].is(TagType.Language, TagType.Edition, TagType.Cut, TagType.Other, TagType.Collection, TagType.Delim, TagType.Source);
      i--
    ) {
      // seek
    }
    for (; i > start; i--) {
      if ((t[i - 1].is(TagType.Collection) && t[i - 1].collection() === 'IMAX') || (t[i - 1].is(TagType.Other) && t[i - 1].other() === 'REMiX')) {
        // keep
      } else if (t[i - 1].is(TagType.Collection, TagType.Language, TagType.Other, TagType.Arch, TagType.Platform)) {
        t[i - 1] = t[i - 1].as(TagType.Text, null);
      }
    }
  }

  /** Special collection and other tags before i become text. */
  private fixSpecial(r: Release, i: number, series: boolean): void {
    const t = r._tags;
    for (; i > 0; i--) {
      const tag = t[i - 1];
      const typ = tag.tagType();
      const c = tag.collection();
      const o = tag.other();
      const s = tag.text();
      const l = s.toLowerCase();
      if (
        (typ === TagType.Collection && (c === 'CC' || c === 'RED' || (c === 'AMZN' && l === 'amazon'))) ||
        (typ === TagType.Source && s === 'Web') ||
        (typ === TagType.Cut && s === 'Uncut') ||
        (typ === TagType.Other && (o === 'MD' || o === 'RESTORATiON')) ||
        (typ === TagType.Cut && l === 'dc') ||
        (series && (typ === TagType.Arch || typ === TagType.Platform))
      ) {
        t[i - 1] = tag.as(TagType.Text, null);
      }
    }
  }

  /** With no text before end, collection tags there become text. */
  private fixNoText(r: Release, end: number): void {
    const n = Math.min(end + 1, r._tags.length);
    for (let i = 0; i < n; i++) if (r._tags[i].is(TagType.Text)) return;
    for (let i = 0; i < n; i++) {
      if (r._tags[i].is(TagType.Collection)) r._tags[i] = r._tags[i].as(TagType.Text, null);
    }
  }

  /** Tags with text on both sides become text. */
  private fixIsolated(r: Release): void {
    const t = r._tags;
    const head = t.slice(0, r._end);
    for (let i = r._end - 1; i > 1; i--) {
      if (
        t[i - 1].is(TagType.Collection, TagType.Language, TagType.Other, TagType.Arch, TagType.Platform) &&
        isolated(head, i - 1, -1) &&
        isolated(head, i - 1, +1) &&
        t[i - 1].other() !== 'REMiX'
      ) {
        t[i - 1] = t[i - 1].as(TagType.Text, null);
        head[i - 1] = t[i - 1];
      }
    }
  }

  /** Music fixes: single CBR → container, 16bit → audio, loose BOOTLEG → text. */
  private fixMusic(r: Release): void {
    const t = r._tags;
    let countCbr = 0;
    let posCbr = 0;
    let hasCbr = false;
    let musicExcl = false;
    for (let i = 0; i < r._end; i++) {
      if (t[i].is(TagType.Audio)) {
        if (t[i].audio() === 'CBR') {
          hasCbr = true;
          posCbr = i;
        }
        musicExcl = musicExcl || t[i].infoExcl();
        countCbr++;
      }
      if (i !== 0 && t[i].is(TagType.Other) && t[i].other() === 'BOOTLEG') {
        const wrapped =
          (peek(t, i - 1, TagType.Delim) &&
            t[i - 1].delim().endsWith('-') &&
            peek(t, i + 1, TagType.Delim) &&
            t[i + 1].delim().startsWith('-')) ||
          (peek(t, i - 1, TagType.Delim) &&
            t[i - 1].delim().endsWith('(') &&
            peek(t, i + 1, TagType.Delim) &&
            t[i + 1].delim().startsWith(')'));
        if (!wrapped) t[i] = t[i].as(TagType.Text, null);
      }
      const singleEp = t[i].singleEp();
      const sbBit = t[i].is(TagType.Arch) && t[i].arch() === '16bit';
      if (singleEp || sbBit) {
        for (let j = i + 1; !musicExcl && j < r._end; j++) {
          musicExcl = musicExcl || (t[j].is(TagType.Audio) && t[j].infoExcl());
        }
        if (musicExcl && singleEp) t[i] = t[i].as(TagType.Text, null);
        else if (musicExcl && sbBit) t[i] = t[i].as(TagType.Audio, this.audiof);
      }
    }
    if (hasCbr && countCbr === 1) t[posCbr] = t[posCbr].as(TagType.Container, this.containerf);
  }

  /** Copies tag values into the release fields. */
  private collect(r: Release): void {
    for (const tag of r._tags) {
      switch (tag.typ) {
        case TagType.Text:
          break;
        case TagType.Platform:
          if (r.platform === '') r.platform = tag.platform();
          break;
        case TagType.Arch:
          if (r.arch === '') r.arch = tag.arch();
          break;
        case TagType.Source: {
          // stomping allowed when a more precise source is available
          const s = tag.source();
          if (r.source === '' || r.source === 'CD' || (r.source === 'DVD' && s !== 'CD')) r.source = s;
          break;
        }
        case TagType.Resolution:
          if (r.resolution === '') r.resolution = tag.resolution();
          break;
        case TagType.Collection:
          if (r.collection === '') r.collection = tag.collection();
          break;
        case TagType.Date:
          [r.year, r.month, r.day] = tag.date();
          break;
        case TagType.Series: {
          const [series, episode] = tag.series();
          if (r.series === 0) r.series = series;
          if (r.episode === 0) r.episode = episode;
          break;
        }
        case TagType.Version:
          if (r.version === '') r.version = tag.version();
          break;
        case TagType.Disc:
          if (r.disc === '') r.disc = tag.normalize();
          break;
        case TagType.Codec:
          r.codec.push(tag.codec());
          break;
        case TagType.HDR:
          r.hdr.push(tag.hdr());
          break;
        case TagType.BitDepth:
          if (r.bitDepth === '') r.bitDepth = tag.bitDepth();
          break;
        case TagType.Audio:
          r.audio.push(tag.audio());
          break;
        case TagType.Channels:
          if (r.channels === '') r.channels = tag.channels();
          break;
        case TagType.Other:
          r.other.push(tag.other());
          break;
        case TagType.Cut:
          r.cut.push(tag.cut());
          break;
        case TagType.Edition:
          r.edition.push(tag.edition());
          break;
        case TagType.Language:
          r.language.push(tag.language());
          break;
        case TagType.Size:
          if (r.size === '') r.size = tag.size();
          break;
        case TagType.Region:
          if (r.region === '') r.region = tag.region();
          break;
        case TagType.Container:
          if (r.container === '') r.container = tag.container();
          break;
        case TagType.Genre:
          if (r.genre === '') r.genre = tag.genre();
          break;
        case TagType.ID:
          if (r.id === '') r.id = tag.id();
          break;
        case TagType.Group:
          r.group = tag.group();
          break;
        case TagType.Meta: {
          const [k, v] = tag.meta();
          if (k === 'site' && r.site === '') r.site = v;
          else if (k === 'sum' && r.sum === '') r.sum = v;
          else if (k === 'pass' && r.pass === '') r.pass = v;
          else if (k === 'req') r.req = true;
          else r.meta.push(k + ':' + v);
          break;
        }
        case TagType.Ext:
          r.ext = tag.ext();
          break;
      }
    }
    // year, month, day from unset date tags
    for (let i = r._dates.length; i > 0; i--) {
      const [year, month, day] = r._tags[r._dates[i - 1]].date();
      if (r.year === 0 && year !== 0) r.year = year;
      if (r.month === 0 && month !== 0) r.month = month;
      if (r.day === 0 && day !== 0) r.day = day;
    }
  }

  /** Guesses the release type. */
  private inspect(r: Release, initial: boolean): ReleaseType {
    if (r.type !== ReleaseType.Unknown) return r.type;
    const t = r._tags;
    const n = t.length;
    let app = false;
    let series = false;
    let movie = false;
    let video = false;
    for (const tag of t) {
      series = series || tag.is(TagType.Series);
      video = video || (!tag.is(TagType.Group) && tag.infoType() === ReleaseType.Movie);
    }
    for (let i = n; i > 0; i--) {
      const typ = t[i - 1].infoType();
      app = app || typ === ReleaseType.App;
      movie = movie || typ === ReleaseType.Movie;
      switch (typ) {
        case ReleaseType.Book:
        case ReleaseType.Game:
          // a game group on a video release (series, resolution or full date)
          if (
            typ === ReleaseType.Game &&
            t[i - 1].is(TagType.Group) &&
            video &&
            (series || r.resolution !== '' || (r.year !== 0 && r.month !== 0 && r.day !== 0))
          ) {
            continue;
          }
          // peek for comic, education, magazine
          for (let j = i - 1; j > 0; j--) {
            const x = t[j - 1].infoType();
            if (x === ReleaseType.Comic || x === ReleaseType.Education || x === ReleaseType.Magazine) return x;
          }
          return typ;
        case ReleaseType.Series:
        case ReleaseType.Episode:
          if (r.episode !== 0 || (r.series === 0 && r.episode === 0 && !contains(r.other, 'BOXSET'))) return ReleaseType.Episode;
          return ReleaseType.Series;
        case ReleaseType.Education:
          if (r.series === 0 && r.episode === 0) return ReleaseType.Education;
          break;
        case ReleaseType.Music:
          // peek for audiobook
          for (let j = i - 1; j > 0; j--) {
            if (t[j - 1].infoType() === ReleaseType.Audiobook) return ReleaseType.Audiobook;
          }
          return typ;
        case ReleaseType.Audiobook:
        case ReleaseType.Comic:
        case ReleaseType.Magazine:
          return typ;
      }
      // exclusive tag not superseded by version/episode/date
      if (t[i - 1].infoExcl() && r.version === '' && r.series === 0 && r.episode === 0 && r.day === 0 && r.month === 0) return typ;
    }
    // music style tag delimiters
    for (let count = 0, i = n - 1; i > 1; i--) {
      if (
        t[i - 1].is(
          TagType.Date,
          TagType.Codec,
          TagType.HDR,
          TagType.BitDepth,
          TagType.Audio,
          TagType.Resolution,
          TagType.Source,
          TagType.Language,
        ) &&
        peek(t, i - 2, TagType.Delim) &&
        t[i - 2].delim().endsWith('-') &&
        peek(t, i, TagType.Delim) &&
        t[i].delim().startsWith('-')
      ) {
        count++;
        if (count > 1) return ReleaseType.Music;
      }
    }
    // defaults
    if (r.episode !== 0 || (r.year !== 0 && r.month !== 0 && r.day !== 0)) return ReleaseType.Episode;
    if (r.series !== 0 || series) return ReleaseType.Series;
    if (app || (r.version !== '' && r.resolution === '')) return ReleaseType.App;
    if (movie || r.resolution !== '') return ReleaseType.Movie;
    if ((r.source === '' || r.source === 'WEB') && r.resolution === '' && r.year !== 0) return ReleaseType.Music;
    // platform, arch tags previously reset
    if (initial) {
      let reinspect = false;
      for (let i = n; i > 0; i--) {
        if (t[i - 1].was(TagType.Platform, TagType.Arch)) {
          t[i - 1] = t[i - 1].revert();
          reinspect = true;
          switch (t[i - 1].tagType()) {
            case TagType.Platform:
              r.platform = t[i - 1].platform();
              break;
            case TagType.Arch:
              r.arch = t[i - 1].arch();
              break;
          }
        }
      }
      if (reinspect) return this.inspect(r, false);
    }
    return ReleaseType.Unknown;
  }

  /** Magazines: a month name before the year. */
  private specialDate(r: Release): void {
    if (r.type === ReleaseType.Magazine && r.year !== 0 && r.month === 0 && r.day === 0) {
      let i = r._dates[0] - 1;
      for (; i > 0 && r._tags[i].is(TagType.Delim); i--) {
        // seek prior text
      }
      if (i >= 0 && r._tags[i].is(TagType.Text)) {
        const s = r._tags[i].text();
        const month = parseLongMonth(s);
        if (month !== 0) {
          r.month = month;
          r._tags[i] = newTag(TagType.Date, null, s, String(r.year), String(r.month), '');
          r._dates.push(i);
        }
      }
    }
  }

  /** Unsets exclusive tags of another release type, and misread tags. */
  private unset(r: Release): void {
    const t = r._tags;
    const mseg =
      r.type === ReleaseType.Movie ||
      r.type === ReleaseType.Series ||
      r.type === ReleaseType.Episode ||
      r.type === ReleaseType.Music ||
      r.type === ReleaseType.Game;
    let grabSource = false;
    for (let i = 0; i < t.length; i++) {
      if (grabSource && t[i].is(TagType.Source) && r.source === '') r.source = t[i].source();
      const ityp = t[i].infoType();
      if (
        ityp !== r.type &&
        t[i].is(
          TagType.Platform,
          TagType.Arch,
          TagType.Source,
          TagType.Resolution,
          TagType.Collection,
          TagType.Codec,
          TagType.HDR,
          TagType.BitDepth,
          TagType.Audio,
          TagType.Channels,
          TagType.Other,
          TagType.Cut,
          TagType.Edition,
          TagType.Language,
          TagType.Size,
          TagType.Region,
          TagType.Container,
          TagType.Genre,
          TagType.Group,
          TagType.Ext,
        ) &&
        t[i].infoExcl()
      ) {
        const typ = t[i].tagType();
        const s = t[i].normalize();
        const text = () => {
          t[i] = t[i].as(TagType.Text, null);
        };
        if (typ === TagType.Platform && r.platform === s && !contains(r.other, 'Strategy.Guide')) {
          r.platform = '';
          text();
        } else if (typ === TagType.Arch && r.arch === s) {
          r.arch = '';
          text();
        } else if (typ === TagType.Source && r.source === s) {
          r.source = '';
          text();
        } else if (typ === TagType.Resolution && r.resolution === s) {
          r.resolution = '';
          text();
        } else if (typ === TagType.Collection && r.collection === s) {
          r.collection = '';
          text();
        } else if (typ === TagType.Codec && contains(r.codec, s)) {
          r.codec = remove(r.codec, s);
          text();
        } else if (typ === TagType.HDR && contains(r.hdr, s)) {
          r.hdr = remove(r.hdr, s);
          text();
        } else if (typ === TagType.BitDepth && r.bitDepth === s) {
          r.bitDepth = '';
          text();
        } else if (typ === TagType.Audio && contains(r.audio, s)) {
          r.audio = remove(r.audio, s);
          text();
        } else if (typ === TagType.Channels && r.channels === s) {
          r.channels = '';
          text();
        } else if (typ === TagType.Other && contains(r.other, s)) {
          r.other = remove(r.other, s);
          text();
        } else if (typ === TagType.Cut && contains(r.cut, s)) {
          r.cut = remove(r.cut, s);
          text();
        } else if (typ === TagType.Edition && contains(r.edition, s)) {
          r.edition = remove(r.edition, s);
          text();
        } else if (typ === TagType.Language && contains(r.language, s)) {
          r.language = remove(r.language, s);
          text();
        } else if (typ === TagType.Size && r.size === s) {
          r.size = '';
          text();
        } else if (typ === TagType.Region && r.region === s) {
          r.region = '';
          text();
        } else if (typ === TagType.Container && r.container === s) {
          r.container = '';
          text();
        } else if (typ === TagType.Genre && r.genre === s) {
          r.genre = '';
          text();
        } else if (typ === TagType.Group && r.group === s) {
          r.group = '';
          text();
        } else if (typ === TagType.Ext && r.ext === s) {
          r.ext = '';
          text();
        }
      } else if (
        !mseg &&
        t[i].is(TagType.Source) &&
        (ityp === ReleaseType.Movie || ityp === ReleaseType.Series || ityp === ReleaseType.Episode)
      ) {
        // reset movie/series/episode source tags
        if (r.source === t[i].normalize()) r.source = '';
        t[i] = t[i].as(TagType.Text, null);
        grabSource = true;
      } else if (!mseg && t[i].is(TagType.Channels)) {
        t[i] = t[i].as(TagType.Text, null);
        r.channels = '';
      }
    }
  }

  /** Sets the titles; returns the position after them. */
  private titles(r: Release): number {
    let i: number;
    let aka = false;
    switch (r.type) {
      case ReleaseType.Movie:
        i = this.movieTitles(r);
        aka = true;
        break;
      case ReleaseType.Series:
      case ReleaseType.Episode:
        i = this.episodeTitles(r);
        aka = true;
        break;
      case ReleaseType.Music:
        i = this.musicTitles(r);
        break;
      case ReleaseType.Book:
      case ReleaseType.Audiobook:
        i = this.bookTitles(r);
        break;
      case ReleaseType.App:
      case ReleaseType.Game:
        i = this.appTitle(r);
        break;
      default:
        i = this.defaultTitle(r);
    }
    if (aka) {
      const s = r.title.split(' AKA ');
      if (r.alt === '' && s.length === 2 && s[0] !== '' && s[1] !== '') {
        r.title = s[0];
        r.alt = s[1];
      }
    }
    return i;
  }

  private movieTitles(r: Release): number {
    const t = r._tags;
    let pos = 0;
    for (; pos < t.length && !t[pos].is(TagType.Text); pos++) {
      // seek to text
    }
    const start = pos;
    let offset: number;
    [r.title, offset] = this.title(t.slice(start), TagType.Text);
    for (pos = 0; pos < t.length && !t[pos].is(TagType.Date); pos++) {
      // seek date
    }
    const date = pos;
    if (date === t.length) return this.boxTitle(r, start, offset);
    for (pos = 0; pos < t.length && !t[pos].is(TagType.Resolution); pos++) {
      // seek resolution
    }
    const resolution = pos;
    if (resolution === t.length) return this.boxTitle(r, start, offset);
    // all tags between date and resolution must be text, delimiter, cut or edition
    let hasSubtitle = date + 1 < resolution - 1;
    if (!hasSubtitle) return this.boxTitle(r, start, offset);
    for (pos = date + 1; pos < t.length && hasSubtitle && pos < resolution; pos++) {
      hasSubtitle = hasSubtitle && t[pos].is(TagType.Delim, TagType.Text, TagType.Cut, TagType.Edition);
    }
    if (hasSubtitle) {
      for (pos = date + 1; pos < t.length && !t[pos].is(TagType.Text, TagType.Cut, TagType.Edition); pos++) {
        // seek
      }
      if (pos < resolution - 1) {
        [r.subtitle] = this.title(t.slice(pos, resolution - 1), TagType.Text, TagType.Cut, TagType.Edition);
      }
    }
    // alternate subtitle delimiter
    const i = r.title.lastIndexOf('~');
    if (i !== -1 && r.subtitle === '') {
      r.subtitle = trimLeftFunc(r.title.slice(i + 1), isTitleTrimDelim);
      r.title = trimRightFunc(r.title.slice(0, i), isTitleTrimDelim);
    }
    return Math.min(start + offset, resolution);
  }

  private boxTitle(r: Release, start: number, offset: number): number {
    const t = r._tags;
    const n = start + offset;
    if (n === t.length || n <= 0 || r.disc === '' || !t[n].is(TagType.Cut, TagType.Edition)) return n;
    // previous 4 words for 'the', not at the start of the last text block
    for (let pos = n - 1; pos > start + 1 && pos > n - 8 && pos > 0; pos--) {
      if (mustNormalize(t[pos - 1].text()) === 'the') {
        const [prefix] = this.title(t.slice(pos - 1, n), TagType.Text);
        const [suffix, off] = this.title(t.slice(n), TagType.Text, TagType.Cut, TagType.Edition);
        const base = r.title.endsWith(prefix) ? r.title.slice(0, r.title.length - prefix.length) : r.title;
        r.title = trimRightFunc(base, isTitleTrimDelim);
        r.subtitle = prefix + ' ' + trimRightFunc(suffix, isBreakDelim);
        return n + off;
      }
    }
    return n;
  }

  private episodeTitles(r: Release): number {
    const t = r._tags;
    let pos = this.movieTitles(r);
    const typ = r.month !== 0 && r.day !== 0 ? TagType.Date : TagType.Series;
    // seek past the date/series, collecting skipped text
    for (; pos < t.length && !t[pos].is(typ); pos++) {
      if (t[pos].is(TagType.Text)) r._unused.push(pos);
    }
    if (pos === t.length) return pos;
    // the episode title follows source, resolution, ... tags, before codec/audio
    for (
      pos++;
      pos < t.length &&
      t[pos].is(
        TagType.Delim,
        TagType.Source,
        TagType.Resolution,
        TagType.Collection,
        TagType.Date,
        TagType.Series,
        TagType.Version,
        TagType.Disc,
        TagType.Other,
        TagType.Cut,
        TagType.Edition,
        TagType.Language,
        TagType.Container,
      );
      pos++
    ) {
      // seek
    }
    if (pos === t.length || !t[pos].is(TagType.Text)) return pos;
    let offset: number;
    [r.subtitle, offset] = this.title(t.slice(pos), TagType.Text);
    return pos + offset;
  }

  private musicTitles(r: Release): number {
    let i: number;
    [r.title, i] = this.mixTitle(r, 0);
    // split artist, title
    for (const s of [' - ', '--', '~', '-']) {
      const j = r.title.lastIndexOf(s);
      if (j !== -1) {
        r.artist = trimRightFunc(r.title.slice(0, j), isTitleTrimDelim);
        r.title = trimLeftFunc(r.title.slice(j + s.length), isBreakDelim);
        break;
      }
    }
    let skipped: boolean;
    let ok: boolean;
    [i, skipped, ok] = this.checkDate(r, i);
    if (ok) {
      const s = r._tags[i].delim();
      // Artist - (Prefix) Title
      if (r.artist === '' && s.endsWith('(')) {
        let [title, z] = this.mixTitle(r, i + 1);
        let subtitle: string;
        [subtitle, z] = this.mixTitle(r, z + 1);
        if (title !== '' && subtitle !== '') {
          r.artist = r.title;
          r.title = '(' + title + ') ' + subtitle;
          [i, skipped, ok] = this.checkDate(r, z);
          if (!ok) return i;
        }
      }
      // (Artist) - Title
      if (r.artist === '' && (skipped || s.startsWith(')'))) {
        const [title, z] = this.mixTitle(r, i + 1);
        if (title !== '') {
          r.artist = r.title;
          r.title = title;
          i = z;
        }
      }
      // subtitle after '(', '__', '-', or '~'
      if (
        r.subtitle === '' &&
        (s.endsWith('(') || s === '__' || s.includes('-') || s.includes('~')) &&
        peek(r._tags.slice(0, r._end), i + 1, TagType.Text)
      ) {
        [r.subtitle, i] = this.mixTitle(r, i + 1);
      }
    }
    if (r.subtitle === '' && r.artist !== '') {
      // try to split artist
      for (const s of [' - ', '--', '~']) {
        const j = r.artist.lastIndexOf(s);
        if (j !== -1) {
          const artist = r.artist;
          r.subtitle = r.title;
          r.artist = trimRightFunc(artist.slice(0, j), isTitleTrimDelim);
          r.title = trimLeftFunc(artist.slice(j + s.length), isBreakDelim);
          break;
        }
      }
    }
    return i;
  }

  private mixTitle(r: Release, i: number): [string, number] {
    const t = r._tags;
    const start = Math.min(this.start(r, i), t.length);
    for (i = start; i < r._end && t[i].is(TagType.Delim, TagType.Text, TagType.Other); i++) {
      if (t[i].is(TagType.Other) && t[i].other() !== 'REMiX') break;
    }
    const [title, offset] = this.title(t.slice(start, i), TagType.Text, TagType.Other);
    return [title, start + offset];
  }

  /** At the end? Skips a date tag if present; ok when a delimiter follows. */
  private checkDate(r: Release, i: number): [number, boolean, boolean] {
    if (i === r._end) return [i, false, false];
    let skipped = false;
    if (r._tags[i].is(TagType.Date)) {
      i++;
      skipped = true;
    }
    if (i === r._end || !r._tags[i].is(TagType.Delim)) return [i, skipped, false];
    return [i, skipped, true];
  }

  private bookTitles(r: Release): number {
    const t = r._tags;
    let s = '';
    let pos = 0;
    let offset = 0;
    for (; pos < t.length; pos += offset) {
      for (; pos < t.length && !t[pos].is(TagType.Text, TagType.Platform, TagType.Arch, TagType.Other, TagType.Region); pos++) {
        // seek to text
      }
      if (pos === t.length) break;
      const isOther = t[pos].is(TagType.Other);
      if (isOther && t[pos].infoType() !== ReleaseType.Book) {
        offset = 1;
        continue;
      } else if (isOther && t[pos].other() === 'Strategy.Guide') {
        s = t[pos].text().split('.').join(' ');
        offset = 2;
      } else {
        [s, offset] = this.title(t.slice(pos), TagType.Text, TagType.Platform, TagType.Arch, TagType.Region);
      }
      if (r.title !== '' && s !== '') r.title += ' ';
      r.title += s;
    }
    let i = r.title.lastIndexOf(';');
    if (i !== -1) {
      r.subtitle = trimLeftFunc(r.title.slice(i + 1), isTitleTrimDelim);
      r.title = trimRightFunc(r.title.slice(0, i), isTitleTrimDelim);
    }
    if (r.artist === '') {
      for (const sep of [' - ', '--', '~']) {
        const j = r.title.indexOf(sep);
        if (j !== -1) {
          const title = r.title;
          r.artist = trimRightFunc(title.slice(0, j), isTitleTrimDelim);
          r.title = trimLeftFunc(title.slice(j + sep.length), isBreakDelim);
          break;
        }
      }
    }
    if (r.subtitle === '') {
      for (const sep of [' - ', '--', '~']) {
        const j = r.title.indexOf(sep);
        if (j !== -1) {
          const title = r.title;
          r.title = trimRightFunc(title.slice(0, j), isBreakDelim);
          r.subtitle = trimLeftFunc(title.slice(j + sep.length), isTitleTrimDelim);
          break;
        }
      }
    }
    i = r.title.lastIndexOf('-');
    if (r.artist === '' && i !== -1) {
      const artist = trimRightFunc(r.title.slice(0, i), isTitleTrimDelim);
      const title = trimLeftFunc(r.title.slice(i + 1), isBreakDelim);
      if (!this.digsuf.test(artist) && !this.digpre.test(title)) {
        r.artist = artist;
        r.title = title;
      }
    }
    return pos;
  }

  private appTitle(r: Release): number {
    const t = r._tags;
    let pos = 0;
    for (; pos < t.length && !t[pos].is(TagType.Text, TagType.Date); pos++) {
      // seek to text
    }
    let offset: number;
    [r.title, offset] = this.title(t.slice(pos), TagType.Text, TagType.Date);
    return pos + offset;
  }

  private defaultTitle(r: Release): number {
    const t = r._tags;
    let pos = 0;
    for (; pos < t.length && !t[pos].is(TagType.Text); pos++) {
      // seek to text
    }
    let offset: number;
    [r.title, offset] = this.title(t.slice(pos), TagType.Text);
    return pos + offset;
  }

  /** Joins text up to a non-space delimiter; returns the title and end position. */
  private title(tags: Tag[], ...types: TagType[]): [string, number] {
    const v: string[] = [];
    let i = 0;
    for (; i < tags.length; i++) {
      if (tags[i].is(...types)) {
        v.push(tags[i].textReplace('.', ' ', -1));
      } else if (tags[i].is(TagType.Delim)) {
        const s = tags[i].delim();
        if (!/[()[\]{}\\/]/.test(s) && s !== '__') v.push(this.delim(s, tags, i, ...types));
        else break;
      } else {
        break;
      }
    }
    // acronyms missing periods
    let s = v.join('').replace(this.missing, (a) => trimChars(a.trim().split(' ').join('.'), '. ', true) + '. ');
    // fix oopsie
    s = s.split('. .').join('. ');
    // acronyms on single letters
    s = s.replace(this.bad, (a) => a.replace(this.fix, '$1'));
    s = s.replace(this.spaces, ' ');
    s = s.replace(this.ellips, '...');
    s = unescapeHtml(s);
    if ((s.match(this.plus) ?? []).length > 1) s = s.replace(this.plus, ' ');
    return [trimFunc(s, isTitleTrimDelim), i];
  }

  /** Text tags after i are unused; the last may be the sum or group. */
  private unused(r: Release, i: number): void {
    for (; i < r._tags.length; i++) {
      if (r._tags[i].is(TagType.Text)) r._unused.push(i);
    }
    const n = r._unused.length;
    if (n !== 0) {
      const s = r._tags[r._unused[n - 1]].text();
      if (r.sum === '' && this.sum.test(s) && /[0-9]/.test(s)) {
        r.sum = s;
        r._unused = r._unused.slice(0, n - 1);
      } else if (r.group === '' && !this.digits.test(s)) {
        const last = r._unused[n - 1];
        r.group = s;
        r._unused = r._unused.slice(0, n - 1);
        this.widenGroup(r, last);
      }
    }
  }

  /**
   * Joins the leftover words in front of a guessed group when single spaces
   * separate them, so "(... - DarQ HONE)" yields the same group as
   * "-DarQ HONE". A run outside the group lexer's bound on a spaced group
   * keeps the single word, as the lexer would.
   */
  private widenGroup(r: Release, i: number): void {
    let n = r._unused.length;
    for (; n > 0 && r._unused[n - 1] === i - 2 && r._tags[i - 1].text() === ' '; n--) {
      i = r._unused[n - 1];
    }
    if (n === r._unused.length) return;
    const v = r._unused.slice(n).map((j) => r._tags[j].text());
    const group = [...v, r.group].join(' ');
    if (spacedGroup.test(group)) {
      r.group = group;
      r._unused = r._unused.slice(0, n);
    }
  }

  /** Fixes a title delimiter based on the tags around it. */
  private delim(delim: string, tags: Tag[], i: number, ...types: TagType[]): string {
    switch (delim) {
      case '...':
        return '...';
      case '..':
      case '. ':
        return '. ';
      case '':
        return ' ';
    }
    let mapped = '';
    for (const r of delim) {
      if ('-+,.~'.includes(r)) mapped += r;
      else if ('\t\n\f\r _'.includes(r)) mapped += ' ';
    }
    const s = mapped.replace(this.spaces, ' ');
    if (s !== '.' || i === tags.length - 1) return s.split('.').join(' ').replace(this.spaces, ' ');
    let ante = '';
    let prev = '';
    let next = '';
    if (i > 2 && tags[i - 2].is(TagType.Delim)) ante = tags[i - 2].delim();
    if (i !== 0 && tags[i - 1].is(...types)) prev = tags[i - 1].text();
    if (i < tags.length - 1 && tags[i + 1].is(...types)) next = tags[i + 1].text();
    // acronyms / abbreviations
    if (isUpperLetter(prev) && isUpperLetter(next) && !/[-~]/.test(ante)) return '.';
    // version, such as 2.0 or 5.1 (book title)
    if (isDigit(prev) && isDigit(next) && !/[-~]/.test(ante)) return '.';
    return ' ';
  }
}

/** Go strings.TrimLeft(s, cutset) (left only when leftOnly). */
function trimChars(s: string, cutset: string, leftOnly: boolean): string {
  let a = 0;
  let b = s.length;
  while (a < b && cutset.includes(s[a])) a++;
  if (!leftOnly) while (b > a && cutset.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Creates a parser with the embedded vocabulary plus extras and the default lexers. */
export function newDefaultParser(...extras: TaginfoMap[]): TagParser {
  return new TagParser(all(...extras), defaultLexers());
}

let defaultParser: TagParser | null = null;

/** The shared default parser (built on first use). */
export function getDefaultParser(): TagParser {
  defaultParser ??= newDefaultParser();
  return defaultParser;
}
