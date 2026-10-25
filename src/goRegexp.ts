// Translates Go (RE2) regexp syntax, as used by rls and its taginfo.csv, into
// plain JavaScript regexps that run on Hermes and V8 alike.
//
// JavaScript lacks inline flags (`(?i)`, `(?i:…)`, `(?-i:…)`), `\Q…\E` quoting
// and names such as `(?P<2006>…)`, and its `\s` and `.` match more than Go's.
// Case-insensitive parts are expanded to explicit cases (`a` → `[aA]`), so the
// result is compiled without the `i` flag. Capture groups keep Go's numbering;
// their names are returned separately.

export interface GoRegexp {
  re: RegExp;
  /** Name of each capture group (index 0 is group 1), or null when unnamed. */
  names: (string | null)[];
}

const SPECIAL = new Set('\\^$.|?*+()[]{}/'.split(''));
const CLASS_SPECIAL = new Set('\\]^-['.split(''));
const SPACE_CLASS = '\\t\\n\\f\\r ';

// A surrogate pair: lets `.` and negated classes match one astral character
// as Go matches one rune, instead of half of it.
const PAIR =
  '[' + String.fromCharCode(0xd800) + '-' + String.fromCharCode(0xdbff) + '][' + String.fromCharCode(0xdc00) + '-' + String.fromCharCode(0xdfff) + ']';

function anyRuneOr(cls: string): string {
  return '(?:' + PAIR + '|' + cls + ')';
}

// Extra simple case folds Go applies that toLowerCase/toUpperCase miss.
const EXTRA_FOLDS: Record<string, string[]> = {
  k: ['\u212a'],
  s: ['\u017f'],
  '\u00e5': ['\u212b'],
};

function caseVariants(ch: string): string[] {
  const out = new Set([ch]);
  const lo = ch.toLowerCase();
  const up = ch.toUpperCase();
  if (lo.length === ch.length) out.add(lo);
  if (up.length === ch.length) out.add(up);
  for (const c of [...out]) {
    for (const x of EXTRA_FOLDS[c] ?? []) out.add(x);
  }
  return [...out];
}

function escapeLiteral(ch: string): string {
  return SPECIAL.has(ch) ? '\\' + ch : ch;
}

function escapeClassChar(ch: string): string {
  switch (ch) {
    case '\t':
      return '\\t';
    case '\n':
      return '\\n';
    case '\f':
      return '\\f';
    case '\r':
      return '\\r';
  }
  return CLASS_SPECIAL.has(ch) ? '\\' + ch : ch;
}

function literal(ch: string, ci: boolean): string {
  if (!ci) return escapeLiteral(ch);
  const v = caseVariants(ch);
  if (v.length === 1) return escapeLiteral(ch);
  return '[' + v.map(escapeClassChar).join('') + ']';
}

/** Reads one (possibly surrogate pair) character at i. */
function charAt(s: string, i: number): string {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) return s.slice(i, i + 2);
  return s[i];
}

/** Reads an escape after a backslash at i; returns [kind, value, length]. */
function readEscape(p: string, i: number): ['char' | 'class' | 'raw', string, number] {
  const c = p[i + 1];
  if (c === undefined) throw new Error('trailing backslash in ' + JSON.stringify(p));
  switch (c) {
    case 'd':
    case 'D':
    case 'w':
    case 'W':
      return ['class', '\\' + c, 2];
    case 's':
      return ['class', SPACE_CLASS, 2];
    case 'S':
      return ['class', '^' + SPACE_CLASS, 2];
    case 't':
      return ['char', '\t', 2];
    case 'n':
      return ['char', '\n', 2];
    case 'f':
      return ['char', '\f', 2];
    case 'r':
      return ['char', '\r', 2];
    case 'v':
      return ['char', '\v', 2];
    case 'b':
    case 'B':
      return ['raw', '\\' + c, 2];
    case 'A':
      return ['raw', '^', 2];
    case 'z':
      return ['raw', '$', 2];
    case 'x': {
      if (p[i + 2] === '{') {
        const close = p.indexOf('}', i + 3);
        return ['char', String.fromCodePoint(parseInt(p.slice(i + 3, close), 16)), close - i + 1];
      }
      return ['char', String.fromCharCode(parseInt(p.slice(i + 2, i + 4), 16)), 4];
    }
  }
  if (/[A-Za-z0-9]/.test(c)) {
    throw new Error(`unsupported escape \\${c} in ${JSON.stringify(p)}`);
  }
  return ['char', charAt(p, i + 1), 1 + charAt(p, i + 1).length];
}

/** Translates a bracket expression starting at p[i] === '['. */
function translateClass(p: string, i: number, ci: boolean): [string, number] {
  let j = i + 1;
  let neg = false;
  if (p[j] === '^') {
    neg = true;
    j++;
  }
  const parts: string[] = [];
  const singles: string[] = [];
  const ranges: [number, number][] = [];
  let first = true;
  const readItem = (): ['char', string] | ['class', string] => {
    if (p[j] === '\\') {
      const [kind, v, len] = readEscape(p, j);
      j += len;
      if (kind === 'raw') throw new Error('bad escape in class: ' + JSON.stringify(p));
      return [kind, v];
    }
    if (p[j] === '[' && p[j + 1] === ':') {
      throw new Error('POSIX classes unsupported: ' + JSON.stringify(p));
    }
    const ch = charAt(p, j);
    j += ch.length;
    return ['char', ch];
  };
  while (j < p.length && (p[j] !== ']' || first)) {
    first = false;
    const a = readItem();
    if (a[0] === 'class') {
      if (a[1].startsWith('^')) throw new Error('negated class escape inside class: ' + JSON.stringify(p));
      parts.push(a[1]);
      continue;
    }
    if (p[j] === '-' && p[j + 1] !== ']' && j + 1 < p.length) {
      j++;
      const b = readItem();
      if (b[0] !== 'char') throw new Error('bad range in class: ' + JSON.stringify(p));
      ranges.push([a[1].codePointAt(0)!, b[1].codePointAt(0)!]);
      continue;
    }
    singles.push(a[1]);
  }
  if (p[j] !== ']') throw new Error('unterminated class: ' + JSON.stringify(p));
  const items = new Set<string>();
  for (const s of singles) {
    for (const v of ci ? caseVariants(s) : [s]) items.add(escapeClassChar(v));
  }
  const rangeStr = (lo: number, hi: number) =>
    escapeClassChar(String.fromCodePoint(lo)) + '-' + escapeClassChar(String.fromCodePoint(hi));
  for (const [lo, hi] of ranges) {
    items.add(rangeStr(lo, hi));
    if (!ci) continue;
    // add the other case for the parts of the range inside A-Z / a-z
    const overlap = (a: number, b: number, shift: number) => {
      const l = Math.max(lo, a);
      const h = Math.min(hi, b);
      if (l <= h) items.add(rangeStr(l + shift, h + shift));
    };
    overlap(0x41, 0x5a, 0x20);
    overlap(0x61, 0x7a, -0x20);
    if (lo <= 0x6b && 0x6b <= hi) items.add('\u212a');
    if (lo <= 0x73 && 0x73 <= hi) items.add('\u017f');
  }
  const cls = '[' + (neg ? '^' : '') + parts.join('') + [...items].join('') + ']';
  return [neg ? anyRuneOr(cls) : cls, j + 1];
}

/** Translates Go regexp source into JavaScript regexp source. */
export function translateGo(p: string): { source: string; names: (string | null)[] } {
  let out = '';
  const names: (string | null)[] = [];
  const stack: boolean[] = [];
  let ci = false;
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    switch (c) {
      case '\\': {
        if (p[i + 1] === 'Q') {
          let end = p.indexOf('\\E', i + 2);
          if (end === -1) end = p.length;
          for (const ch of p.slice(i + 2, end)) out += literal(ch, ci);
          i = end + 2;
          continue;
        }
        const [kind, v, len] = readEscape(p, i);
        if (kind === 'char') out += literal(v, ci);
        else if (kind === 'class') {
          if (v === '\\d' || v === '\\w') out += v;
          else if (v === '\\D' || v === '\\W') out += anyRuneOr(v);
          else if (v.startsWith('^')) out += anyRuneOr('[' + v + ']');
          else out += '[' + v + ']';
        }
        else out += v;
        i += len;
        continue;
      }
      case '[': {
        const [cls, next] = translateClass(p, i, ci);
        out += cls;
        i = next;
        continue;
      }
      case '(': {
        if (p[i + 1] !== '?') {
          names.push(null);
          stack.push(ci);
          out += '(';
          i++;
          continue;
        }
        if (p[i + 2] === 'P' && p[i + 3] === '<') {
          const close = p.indexOf('>', i + 4);
          names.push(p.slice(i + 4, close));
          stack.push(ci);
          out += '(';
          i = close + 1;
          continue;
        }
        if (p[i + 2] === '<' && p[i + 3] !== '=' && p[i + 3] !== '!') {
          const close = p.indexOf('>', i + 3);
          names.push(p.slice(i + 3, close));
          stack.push(ci);
          out += '(';
          i = close + 1;
          continue;
        }
        // flags: (?flags) or (?flags:...)
        const m = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?([:)])/.exec(p.slice(i));
        if (!m) throw new Error('unsupported group syntax in ' + JSON.stringify(p));
        const on = m[1];
        const off = m[2] ?? '';
        for (const f of on + off) {
          if (f !== 'i') throw new Error(`unsupported flag ${f} in ${JSON.stringify(p)}`);
        }
        const nextCi: boolean = on.includes('i') ? true : off.includes('i') ? false : ci;
        if (m[3] === ')') {
          ci = nextCi;
        } else {
          stack.push(ci);
          ci = nextCi;
          out += '(?:';
        }
        i += m[0].length;
        continue;
      }
      case ')':
        if (stack.length === 0) throw new Error('unbalanced ) in ' + JSON.stringify(p));
        ci = stack.pop()!;
        out += ')';
        i++;
        continue;
      case '.':
        out += anyRuneOr('[^\\n]');
        i++;
        continue;
      case '^':
      case '$':
      case '|':
      case '*':
      case '+':
      case '?':
      case '{':
      case '}':
        out += c;
        i++;
        continue;
    }
    const ch = charAt(p, i);
    out += literal(ch, ci);
    i += ch.length;
  }
  return { source: out, names };
}

const cache = new Map<string, GoRegexp>();

/** Compiles a Go regexp. Pass global for find-all / replace-all use. */
export function goRegexp(pattern: string, global = false): GoRegexp {
  const key = (global ? 'g:' : ':') + pattern;
  let v = cache.get(key);
  if (!v) {
    const { source, names } = translateGo(pattern);
    v = { re: new RegExp(source, global ? 'g' : ''), names };
    cache.set(key, v);
  }
  return v;
}

/** Shorthand for goRegexp(pattern).re. */
export function goRe(pattern: string): RegExp {
  return goRegexp(pattern).re;
}

/** Shorthand for goRegexp(pattern, true).re. */
export function goReG(pattern: string): RegExp {
  return goRegexp(pattern, true).re;
}

/** Runs re against s, returning Go-style submatches ('' for unmatched groups) or null. */
export function findSubmatch(re: RegExp, s: string): string[] | null {
  const m = re.exec(s);
  if (!m) return null;
  const v = new Array<string>(m.length);
  for (let k = 0; k < m.length; k++) v[k] = m[k] ?? '';
  return v;
}

/** Go FindAllSubmatch: all non-overlapping matches. re must be global. */
export function findAllSubmatch(re: RegExp, s: string): string[][] {
  const out: string[][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const v = new Array<string>(m.length);
    for (let k = 0; k < m.length; k++) v[k] = m[k] ?? '';
    out.push(v);
    if (m[0] === '') re.lastIndex++;
  }
  re.lastIndex = 0;
  return out;
}
