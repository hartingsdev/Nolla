import { describe, expect, it } from 'vitest';
import { resources } from './index';

function keys(o: unknown, prefix = ''): string[] {
  if (typeof o !== 'object' || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('catalogues', () => {
  it('every locale has exactly the keys of the English source (D10, NFR-8)', () => {
    const source = keys(resources.en.translation).sort();
    for (const [locale, { translation }] of Object.entries(resources)) {
      expect(keys(translation).sort(), `locale ${locale}`).toEqual(source);
    }
  });
  it('placeholders match between locales', () => {
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const flat = (o: unknown, prefix = ''): [string, string][] =>
      typeof o === 'string' ? [[prefix, o]] : Object.entries(o as object).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k));
    const en = new Map(flat(resources.en.translation));
    for (const [k, v] of flat(resources.de.translation)) expect(ph(v), k).toEqual(ph(en.get(k) ?? ''));
  });
});
