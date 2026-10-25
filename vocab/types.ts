// The shape of an entry in the vocab files (codec.ts, source.ts, group.ts, ...).

/** Release types an entry can hint at. */
export type ReleaseKind =
  | 'movie'
  | 'episode'
  | 'series'
  | 'music'
  | 'game'
  | 'app'
  | 'book'
  | 'audiobook'
  | 'comic'
  | 'education'
  | 'magazine';

export interface VocabEntry {
  /**
   * The tag as the parser should report it (`r.codec`, `r.source`, ...; a group comes out as written in the name).
   * Matched ignoring case (except in language.ts). Each separator in it may be any of - . _ or space, or left
   * out: 'WEB-DL' also finds 'WEB.DL', 'WEB DL' and 'WEBDL'.
   */
  tag: string;
  /**
   * Optional. Other spellings that mean this tag, matched the same way as `tag` and reported as `tag`:
   * `{ tag: 'AMZN', aliases: ['AMZN Prime', 'Prime Video'] }`. The tag can be one rls already has, to add
   * spellings to it; it then keeps rls's title, type and exclusive unless the entry gives its own. rls's own
   * spellings are tried first, so an alias that starts with one of them and a separator never wins ('AMZN Prime'
   * still finds 'AMZNPrime', but 'AMZN.Prime' is read as AMZN plus the word 'Prime'). In group.ts an alias finds
   * the group, but the group still comes out as written in the name.
   */
  aliases?: string[];
  /**
   * Optional. A Go-style regexp for spellings plain text can't describe, e.g. '(?-i:DarQ)' to match that case
   * only, or 'web[\-\._ ]?dl(?:rip)?' for an optional ending. It replaces the plain `tag` (aliases are still added).
   */
  match?: string;
  /** Optional. A longer name for display, e.g. 'High Efficiency Video Coding' for 'HEVC'. */
  title?: string;
  /** Optional. The kind of release the tag belongs to. The parser uses it to guess the release type, so leave it out for tags used by several kinds. */
  type?: ReleaseKind;
  /**
   * Optional, needs `type`. The tag only means this on releases of that type: it decides the type when nothing
   * else does, and on any other type of release it is dropped back to plain text (rls marks 'AUDiOBOOK' as an
   * exclusive audiobook source, and 'DOS' as an exclusive app platform).
   */
  exclusive?: boolean;
}

/** genre.ts and other.ts entries can also give a second form (see those files). */
export interface VocabEntryWithOther extends VocabEntry {
  other?: string;
}
