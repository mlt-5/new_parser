// Tag and release types, numbered as in rls.

export const TagType = {
  Whitespace: 0,
  Delim: 1,
  Text: 2,
  Platform: 3,
  Arch: 4,
  Source: 5,
  Resolution: 6,
  Collection: 7,
  Date: 8,
  Series: 9,
  Version: 10,
  Disc: 11,
  Codec: 12,
  HDR: 13,
  BitDepth: 14,
  Audio: 15,
  Channels: 16,
  Other: 17,
  Cut: 18,
  Edition: 19,
  Language: 20,
  Size: 21,
  Region: 22,
  Container: 23,
  Genre: 24,
  ID: 25,
  Group: 26,
  Meta: 27,
  Ext: 28,
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- const + type pair, like an enum
export type TagType = (typeof TagType)[keyof typeof TagType];

const TAG_TYPE_NAMES = Object.keys(TagType) as (keyof typeof TagType)[];

/** Tag type name, as rls's stringer prints it ("Whitespace", "HDR", ...). */
export function tagTypeName(typ: TagType): string {
  return TAG_TYPE_NAMES[typ] ?? `TagType(${typ})`;
}

export const ReleaseType = {
  Unknown: 0,
  App: 1,
  Audiobook: 2,
  Book: 3,
  Comic: 4,
  Education: 5,
  Episode: 6,
  Game: 7,
  Magazine: 8,
  Movie: 9,
  Music: 10,
  Series: 11,
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare -- const + type pair, like an enum
export type ReleaseType = (typeof ReleaseType)[keyof typeof ReleaseType];

const RELEASE_TYPE_NAMES: Record<ReleaseType, string> = {
  0: '',
  1: 'app',
  2: 'audiobook',
  3: 'book',
  4: 'comic',
  5: 'education',
  6: 'episode',
  7: 'game',
  8: 'magazine',
  9: 'movie',
  10: 'music',
  11: 'series',
};

/** Release type name ("movie", "episode", ...; "" for unknown). */
export function releaseTypeName(typ: ReleaseType): string {
  return RELEASE_TYPE_NAMES[typ] ?? '';
}

/** Parses a release type name; unknown names give ReleaseType.Unknown. */
export function parseReleaseType(s: string): ReleaseType {
  for (const [k, v] of Object.entries(RELEASE_TYPE_NAMES)) {
    if (v === s && s !== '') return Number(k) as ReleaseType;
  }
  return ReleaseType.Unknown;
}
