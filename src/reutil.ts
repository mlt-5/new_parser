// Regexp source builders (Go syntax), ported from rls/reutil.

import type { Taginfo } from './taginfo';

/** Joins strings into an alternation, optionally quoting each with \Q…\E. */
export function join(quote: boolean, ...strs: string[]): string {
  return (quote ? strs.map((s) => '\\Q' + s + '\\E') : strs).join('|');
}

/**
 * Builds a regexp for strings.
 *
 * Config: i ignore case, ^ start anchor, a \b start, q quote, b \b end, $ end anchor.
 */
export function build(config: string, ...strs: string[]): string {
  let s = '';
  if (config.includes('i')) s += '(?i)';
  if (config.includes('^')) s += '^';
  if (config.includes('a')) s += '\\b';
  s += '(' + join(config.includes('q'), ...strs) + ')';
  if (config.includes('b')) s += '\\b';
  if (config.includes('$')) s += '$';
  return s;
}

/** Builds a regexp for tag info. See build for config. */
export function taginfoRe(config: string, infos: Taginfo[]): string {
  return build(config, ...infos.map((info) => info.RE()));
}
