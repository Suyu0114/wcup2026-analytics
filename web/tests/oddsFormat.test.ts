import { describe, it, expect } from 'vitest';
import golden from './fixtures/golden_vectors.json';
import { toDecimal } from '../lib/value';
import { fromDecimal } from '../lib/oddsFormat';

// fromDecimal must be the exact inverse of value.ts toDecimal (which is parity-locked to
// engine/value.py). Round-trip every to_decimal golden vector: format -> decimal -> format.
describe('fromDecimal inverse of toDecimal (golden round-trip)', () => {
  for (const c of golden.to_decimal) {
    it(`${c.fmt} ${c.value} round-trips`, () => {
      const d = toDecimal(c.value, c.fmt);
      expect(fromDecimal(d, c.fmt)).toBeCloseTo(c.value, 9);
    });
  }
});

describe('fromDecimal direct cases', () => {
  it('decimal 2.5 -> each format', () => {
    expect(fromDecimal(2.5, 'decimal')).toBe(2.5);
    expect(fromDecimal(2.5, 'hongkong')).toBeCloseTo(1.5, 12);
    expect(fromDecimal(2.5, 'american')).toBeCloseTo(150, 12);
    expect(fromDecimal(2.5, 'indonesian')).toBeCloseTo(1.5, 12);
    expect(fromDecimal(2.5, 'malaysian')).toBeCloseTo(-0.6666666667, 8);
  });

  it('favourite (d < 2) american/indonesian negative; malaysian positive', () => {
    expect(fromDecimal(1.5, 'american')).toBeCloseTo(-200, 12);
    expect(fromDecimal(1.5, 'indonesian')).toBeCloseTo(-2, 12);
    expect(fromDecimal(1.5, 'malaysian')).toBeCloseTo(0.5, 12);
  });

  it('boundary d = 2', () => {
    expect(fromDecimal(2, 'american')).toBeCloseTo(100, 12);
    expect(fromDecimal(2, 'indonesian')).toBeCloseTo(1, 12);
    expect(fromDecimal(2, 'malaysian')).toBeCloseTo(1, 12);
  });

  it('rejects d <= 1 and unknown format', () => {
    expect(() => fromDecimal(1, 'decimal')).toThrow();
    expect(() => fromDecimal(0.5, 'hongkong')).toThrow();
    expect(() => fromDecimal(2, 'klingon')).toThrow();
  });
});
