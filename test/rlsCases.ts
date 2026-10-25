// Loads rls's tests.yaml and builds the same comparison record rls's own test
// (rls_test.go: buildRls) uses, so the port is checked against every case.

import { mustTaginfo, newDefaultParser, releaseTypeName, TagType, type Release, type TaginfoMap } from '../src/index';

export interface RlsCase {
  name: string;
  exp: Record<string, string | number>;
}

const INT_FIELDS = new Set(['year', 'month', 'day', 'series', 'episode', 'req']);

/** Parses tests.yaml (the subset rls writes: quoted keys, `  field: value`). */
export function loadCases(yaml: string): RlsCase[] {
  const cases: RlsCase[] = [];
  let cur: RlsCase | null = null;
  for (const line of yaml.split('\n')) {
    if (line.startsWith('"')) {
      const n = line.lastIndexOf('"');
      cur = { name: JSON.parse(line.slice(0, n + 1)), exp: {} };
      cases.push(cur);
    } else if (line.startsWith('  ')) {
      const n = line.indexOf(':');
      const key = line.slice(2, n);
      const raw = line.slice(n + 2);
      cur!.exp[key] = INT_FIELDS.has(key) ? parseInt(raw, 10) : JSON.parse(raw);
    } else if (line.startsWith('#') || line === '') {
      // comment
    } else {
      throw new Error('unknown line: ' + line);
    }
  }
  return cases;
}

/** The extra groups rls's test parser adds (rls_test.go: groupInfos). */
export function groupInfos(): TaginfoMap {
  return {
    group: [
      ['CODEX', 'game'],
      ['DARKSiDERS', 'game'],
      ['D-Z0N3', 'movie'],
      ['MrSeeN-SiMPLE', ''],
    ].map(([tag, typ]) => mustTaginfo(tag, '', '', '', typ, '')),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** rls_test.go buildRls: every field, lists joined by spaces, zero values dropped. */
export function buildRls(r: Release): Record<string, string | number> {
  const eps = r.seriesEpisodes();
  const v: Record<string, string | number> = {
    type: releaseTypeName(r.type),
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
    seriesEpisodes: eps.length > 1 ? eps.map(([s, e]) => `S${pad2(s)}E${pad2(e)}`).join(' ') : '',
    version: r.version,
    disc: r.disc,
    codec: r.codec.join(' '),
    hdr: r.hdr.join(' '),
    bitdepth: r.bitDepth,
    audio: r.audio.join(' '),
    channels: r.channels,
    other: r.other.join(' '),
    cut: r.cut.join(' '),
    edition: r.edition.join(' '),
    language: r.language.join(' '),
    size: r.size,
    region: r.region,
    container: r.container,
    genre: r.genre,
    id: r.id,
    group: r.group,
    meta: r.meta.join(' '),
    site: r.site,
    sum: r.sum,
    pass: r.pass,
    req: r.req ? 1 : 0,
    ext: r.ext,
    unused: r
      .unused()
      .map((t) => t.normalize())
      .join(' '),
  };
  for (const k of Object.keys(v)) if (v[k] === '' || v[k] === 0) delete v[k];
  return v;
}

export interface CaseResult {
  name: string;
  problems: string[];
}

/** Runs every case; returns those that differ from rls. */
export function runCases(cases: RlsCase[]): CaseResult[] {
  const p = newDefaultParser(groupInfos());
  const bad: CaseResult[] = [];
  for (const c of cases) {
    const problems: string[] = [];
    let r: Release;
    try {
      r = p.parseRelease(c.name);
    } catch (err) {
      bad.push({ name: c.name, problems: ['threw: ' + (err as Error).stack] });
      continue;
    }
    if (r.toString() !== c.name) problems.push(`round trip: ${JSON.stringify(r.toString())}`);
    const dates = r.tags().filter((t) => t.is(TagType.Date)).length;
    if (dates > 1 && releaseTypeName(r.type) !== 'magazine') problems.push(`${dates} date tags`);
    const got = buildRls(r);
    for (const k of new Set([...Object.keys(got), ...Object.keys(c.exp)])) {
      if (got[k] !== c.exp[k]) problems.push(`${k}: want ${JSON.stringify(c.exp[k])}, got ${JSON.stringify(got[k])}`);
    }
    if (problems.length) bad.push({ name: c.name, problems });
  }
  return bad;
}
