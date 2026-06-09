import { describe, it, expect } from 'vitest';
import zh from '../messages/zh-TW.json';
import en from '../messages/en.json';

// TU1: zh-TW and en dictionaries must have a one-to-one key correspondence (no missing keys).

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n key parity (TU1)', () => {
  it('zh-TW and en have identical key sets', () => {
    const zhKeys = keyPaths(zh).sort();
    const enKeys = keyPaths(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('no empty string values', () => {
    for (const [name, dict] of [
      ['zh-TW', zh],
      ['en', en],
    ] as const) {
      for (const path of keyPaths(dict)) {
        const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], dict);
        expect(value, `${name}:${path}`).toBeTruthy();
      }
    }
  });
});
