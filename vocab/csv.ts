// The vocab entries as CSV in taginfo.csv's format, for ../go/vocab.csv.

import { vocabRows } from './index';

const field = (s: string) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

/** go/vocab.csv as it should be for the current vocab files. */
export function vocabCsv(): string {
  const rows = [['Type', 'Tag', 'Title', 'Regexp', 'Other', 'ReleaseType', 'TypeExclusive'], ...vocabRows()];
  return rows.map((r) => r.map(field).join(',')).join('\n') + '\n';
}
