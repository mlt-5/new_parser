# new_parser

A TypeScript port of **rls** v0.10.0, the release-name parser autobrr uses, as the starting point for Bard's new parser. The
plan for fixing its limitations is in [docs/RLS-PARSER-LIMITATIONS-TL.md](../docs/RLS-PARSER-LIMITATIONS-TL.md) and
[docs/RLS-PARSER-LIMITATIONS-NYAA.md](../docs/RLS-PARSER-LIMITATIONS-NYAA.md).

```ts
import { parse, releaseTypeName } from '../new_parser/src';

const r = parse('[SubsPlease] Kusuriya no Hitorigoto - 30 (1080p) [ABCD1234].mkv');
r.title;                  // 'Kusuriya no Hitorigoto'
r.episode;                // 30
r.site;                   // 'SubsPlease'  (autobrr drops this)
releaseTypeName(r.type);  // 'episode'
r.tags();                 // every token with its type; r.toString() rebuilds the name
```

The port gives every field rls has: type, artist, title, subtitle, alt, platform, arch, source, resolution,
collection, year/month/day, series, episode, version, disc, codec, hdr, bitDepth, audio, channels, other, cut,
edition, language, size, region, container, genre, id, group, meta, site, sum, pass, req and ext. It also gives the
tags, the unused text and `seriesEpisodes()`. autobrr copies only some of these.

## How faithful it is

It behaves the same as Go rls (`rls/`), field by field and tag by tag. Both carry two deliberate fixes over upstream
rls (below, and the STEREO one under `go/`).

| Check | Names | Same as Go |
|---|---:|---:|
| rls `tests.yaml` (rls's own expected results) | 456 | 456 |
| Random names built from the tag vocabulary and tricky tokens (`test/oracle/corpus.mjs`), plus the 1,488 TL/Nyaa names from `releases-2026-10-25.xlsx` | 60,124 | 60,124 |
| The same names through `parse()` (vocab and the leading-group step) against the Go package in `go/` | 60,124 | 60,124 |

Before the fix went into `rls/` too, the port
was also checked on 3,969 variants of the `tests.yaml` names and 22,128 variants of the TL/Nyaa names; they differed
from Go only after glued tags like `WEB2007`.

### Fix over upstream rls: text after `WEB2007`-style tags

After a glued disc/source+year tag (`VLS2004`, `2CD2003`, `WEB2007`), rls moves past the tag twice
(`lex.go`, `NewDiscSourceYearLexer`: its `i` is already past the match, then it returns `i + len(s)`). The text the
second jump lands on is lost. It's a bug: the line is the same in every rls version up to autobrr/rls master
(2026-10-17), no commit or issue mentions it, and rls's other lexers advance once. The port advances once, and
`rls/lex.go` here is patched to match (marked `bard fix`).

| Name | Upstream rls | Port and `rls/` |
|---|---|---|
| `Album.VLS2004.FLAC-GRP` | `FLAC` lost | audio `FLAC` |
| `Artist_-_Album-(CAT123)-WEB2021-FLAC-24BIT-GRP` | `FLAC` lost, junk `4BIT` left over | audio `FLAC 24BIT` |
| `Artist-Album-2CD2003-MP3-320-GRP` | `MP3` lost, junk `0` left over | audio `MP3` |

rls's own two tests with these tags still pass (in both the tag is right before the group, so nothing was lost).
None of the 1,488 TL/Nyaa names contain such a tag.

Speed on Node: about 30 µs per name, plus about 35 ms on first use to build the vocabulary.

## Adding tags: `vocab/`

`vocab/` has one file per kind of tag rls reads from its vocabulary: `codec.ts`, `source.ts`, `resolution.ts`,
`group.ts`, `audio.ts`, `hdr.ts`, `language.ts`, `collection.ts` (streaming services), `other.ts` and the rest, 20
in all. Add an entry and `parse()` recognises it:

```ts
// vocab/codec.ts
export const entries: VocabEntry[] = [
  { tag: 'VVC', title: 'Versatile Video Coding', type: 'movie' },
];
```

- Each file's header says what the kind fills, how it's matched, and which tags rls already has.
- The fields (`tag`, `aliases`, `match`, `title`, `type`, `exclusive`) are described in `vocab/types.ts`.
- Each separator in a tag or alias may be `-`, `.`, `_`, space or nothing (`WEB-DL` also finds `WEB.DL` and
  `WEBDL`). Matching ignores case, except in `language.ts`, as in rls.
- Entries are tried after rls's own, so rls's behaviour doesn't change for anything it already reads.
- Aliases are other spellings, reported as the tag. They can extend one of rls's tags:
  `{ tag: 'AMZN', aliases: ['AMZN Prime', 'Prime Video'] }` in `collection.ts` makes `PrimeVideo` read as `AMZN`,
  and the entry keeps rls's title, type and exclusive for `AMZN`. In `group.ts` an alias finds the group, but the
  group comes out as written in the name.
- A listed group is found at the end of a name after any separator. Plain rls takes only the text after the last
  `-`, so `…x264-D-Z0N3` gives `Z0N3`.
- A listed group in brackets at the very start is the group too, fansub style: `[SubsPlease] Title - 04 (1080p)`
  gives group `SubsPlease` (plain rls reads it as the `site` and finds no group, or a title word after a `-`).
  A bracket holding anything else stays the `site`.
- After updating rls, `node new_parser/scripts/gen-vocab.mjs` refreshes the headers; entries are kept.
- `tests/vocab.test.ts` checks the lists: no duplicates, nothing rls already matches, each entry found in a name.
- Because entries come after rls's own, an entry can't take a word an rls tag already claims. `Bootleg Cut` stays
  other `BOOTLEG` plus the word `Cut`. `16-bit` is rls's app architecture, and `Gumroad` its education collection.
  Both decide the release type, so a TL movie with them loses its source.

The lists were filled from the 1,010 TL names in `releases-2026-10-25.xlsx`; the Nyaa names are not used yet.
Left out on purpose:
- `ACC`, SHREDDiE's spelling of AAC: also a college sports conference that appears in titles.
- `SKY` and `F1LIVE`: they sit before `F1TV` and would replace it as the collection.
- `Kino`: a common word in German titles.
- `DTS` as a group: it is an audio tag.
- One-off groups named with plain words (`Star`, `Lol`, `POWER`, …).
- Typos glued to other tags (`WEBDLAAC2`, `HDR10DDP`, `FawesomeWEB-DL`).

Not in `vocab/`, because rls reads them from patterns rather than lists: title, year/month/day, series and episode,
version, disc, catalogue id, and the `[site]`, `[ABCD1234]`, `{{pass}}` and `[REQ]` meta tags.

`parseRls()` is plain rls without `vocab/`; the Go comparison uses it.

## Files

| File | Port of | What it does |
|---|---|---|
| `src/index.ts` | `rls.go` | `parse()`, exports, `releaseFields()` |
| `src/lex.ts` | `lex.go` | The lexers: whitespace, extension, meta (`[site]`, `[[k:v]]`, `{{pass}}`, `[REQ]`, CRC), group, series/episode, disc, date, version, audio+channels, genre, music id, lone episode, and the vocabulary lexers |
| `src/parse.ts` | `parse.go` | Tokeniser loop and the builder: tag fixes, field collection, type guess, exclusive-tag unset, titles (movie, episode, music, book, app), unused text |
| `src/tag.ts` | `rls.go` (`Tag`) | Tag values and normalising (`S01E02`, `2006-01-02`, `5.1`, …) |
| `src/release.ts` | `rls.go` (`Release`) | The release fields, `tags()`, `unused()`, `seriesEpisodes()` |
| `src/types.ts` | `rls.go` | Tag and release type numbers and names |
| `src/taginfo.ts` | `taginfo/taginfo.go` | Loads the vocabulary CSV, finds the tag info for a string |
| `src/reutil.ts` | `reutil/reutil.go` | Builds alternation regexps from tag info |
| `src/normalize.ts` | `rls.go` (`Collapser`) | `mustClean`, `mustNormalize`, delimiter helpers |
| `src/compare.ts` | `rls.go` (`Compare`) | Release sorting |
| `src/goRegexp.ts` | none | Translates Go regexp syntax to plain JavaScript (see below) |
| `src/htmlUnescape.ts` | Go `html.UnescapeString` | Title unescaping, with every HTML5 entity |
| `src/taginfoData.ts` | `taginfo/taginfo.csv` | Generated: the 813-tag vocabulary |
| `src/htmlEntitiesData.ts` | Go `html/entity.go` | Generated: the entity table |
| `vocab/csv.ts` | none | The `vocab/` entries as taginfo.csv rows, for `go/vocab.csv` |

Not ported: `scan.go`, rls's multi-threaded scanner for files of names, which Bard doesn't need.

### Go regexps in JavaScript

`taginfo.csv` and the lexers are written in Go (RE2) syntax. `goRegexp.ts` translates them when the parser is built:
- inline `(?i)`, `(?i:…)` and `(?-i:…)` become explicit cases (`a` → `[aA]`), because JavaScript has no inline flags and the vocabulary needs case-sensitive parts such as `(?-i:ARM)`;
- `\Q…\E` becomes escaped text;
- `(?P<2006>…)` becomes a plain group, with the names kept separately;
- `\s` and `.` match only what Go's do;
- `.` and `[^…]` match an emoji as one character, as Go matches one rune.

The output needs no `u` flag and no lookbehind, so it runs on Hermes. Where rls counts bytes (group length ≤ 14, the
year clamp), the port converts to UTF-8 byte counts.

## Tests

- `npx jest tests/rlsPort.test.ts` runs all of `tests.yaml`, plus checks on fields autobrr drops and on rebuilding a name.
- Without Jest:
  ```bash
  node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/run.mjs
  ```
- Against Go itself: `test/oracle/main.go` prints Go rls output for names on stdin, and `test/oracle/compare.mjs` compares it with the port. Its exit code is non-zero on any difference, and a Go panic on a name is reported as one.
  ```bash
  cd new_parser/test/oracle && GOFLAGS=-mod=mod go build -o /tmp/rlsoracle . && cd ../../..
  node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/oracle/corpus.mjs 60000 > /tmp/names.txt
  /tmp/rlsoracle < /tmp/names.txt > /tmp/go.jsonl
  node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/oracle/compare.mjs /tmp/go.jsonl
  ```

After editing `rls/taginfo/taginfo.csv` or `rls/tests.yaml`, regenerate the data modules:

```bash
node new_parser/scripts/gen-taginfo-data.mjs
node new_parser/scripts/gen-test-data.mjs
```

## The Go original

`rls/` is `github.com/autobrr/rls` v0.10.0 (2026-10-17), autobrr's fork of `moistari/rls`, unchanged except that its
CI folder was removed and two fixes are in (`lex.go` and `rls.go`, marked `bard fix`; keep them when updating rls). Licences:
- rls is MIT; keep `rls/LICENSE` with the port;
- the entity table and `htmlUnescape.ts` come from Go (BSD-style, `GO-LICENSE`).

rls's own Go tests pass: `cd new_parser/rls && go test ./...`.

### v0.8.1 → v0.10.0

The port was first written against v0.8.1. v0.10.0 adds, and the port follows:
- `WEB` inside a title becomes text when another source tag follows (`Show.S03E03.A.Dark.Web.1080p.WEBRip…`);
- a known game group (such as `CODEX`) no longer makes a video release a game when it has a series, resolution or full date;
- `E-AC-3` with a hyphen is read as `DDP`; `Ma10`/`Ma10p` as 10-bit;
- an audio tag glued to a codec (`DDP5.1H264`) leaves the codec for the codec lexer;
- a guessed group widens to the words in front of it when single spaces separate them (`(… - DarQ HONE)` → `DarQ HONE`);
- new `other` tags: `Audio.Description`, `Sign.Language`.

On the 1,488 TL/Nyaa names this changes 6 names, all in the group (`HONE` → `DarQ HONE`, `NFO` → `See NFO`, …); one
of them also gains audio `DDP`. The limitation docs have been re-measured on this port.

## What is not here, on purpose

autobrr's own parser code is **GPL-2.0** and must not be copied into Bard:

- `internal/domain/release.go`: `ParseString` copies only some rls fields into autobrr's `Release`. It drops Site,
  BitDepth, Alt, Version, Disc and Size, which causes several rows in the limitation docs.
- `internal/domain/releasetags.go`: autobrr's extra tag matching on top of rls.
- `internal/domain/irc_parser.go`, `macros`, `filter`: announce parsing and filter matching.

What autobrr does with rls's output is described in our own words in
[docs/PARSER-RULES-AUTOBRR-VS-BARD.md](../docs/PARSER-RULES-AUTOBRR-VS-BARD.md).

Apart from the fix above, the port is unchanged rls behaviour, limitations included. Fixes for the TL and Nyaa
limitations go on top of it.

## The Go package: `go/`

`go/` is Bard's parser in Go, the same as the TypeScript `parse()`: rls from `rls/`, plus the `vocab/` lists and the
leading-group step. `Parse` is the full parser, `ParseRls` plain rls.

- It reads the vocab lists from `go/vocab.csv`, written from `vocab/` by
  `node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/scripts/gen-vocab-csv.mjs`.
  Run it after editing `vocab/`; `tests/vocab.test.ts` fails while the file is out of date.
- Its tests: `cd new_parser/go && GOFLAGS=-mod=mod go test ./...`.
- To compare it with `parse()` on many names, run the oracle above with `-vocab` and `compare.mjs --vocab`:
  ```bash
  /tmp/rlsoracle -vocab < /tmp/names.txt > /tmp/govocab.jsonl
  node --experimental-strip-types --no-warnings --import ./new_parser/test/resolve-ts.mjs new_parser/test/oracle/compare.mjs --vocab /tmp/govocab.jsonl
  ```

### Fix over upstream rls: STEREO in a discarded channels tag

rls formats channels from the tag's digits (`5.1`). The `STEREO` alias in `vocab/channels.ts` has none. When rls
later discards that tag, which happens when an app tag such as `16-bit` makes the name an app release, upstream Go
panics and the port wrote a stray `.`. Both now keep the word (`Channels` in `rls/rls.go`, marked `bard fix`, and
`channels()` in `src/tag.ts`). Plain rls never reaches it: its own channel tags all have digits. Two TL names hit it
(`… 16-bit STEREO WAV MP4-CREATiVE24`).
