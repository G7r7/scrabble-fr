import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Dawg } from '../src/dict/dawg';

describe('Dawg', () => {
  test('petite liste', () => {
    const d = new Dawg(['AI', 'AIE', 'AIES', 'BAIE', 'BAIES', 'MAI']);
    expect(d.wordCount).toBe(6);
    for (const w of ['AI', 'AIE', 'AIES', 'BAIE', 'BAIES', 'MAI']) expect(d.has(w)).toBe(true);
    for (const w of ['A', 'BA', 'MAIS', 'AIEZ', '']) expect(d.has(w)).toBe(false);
  });

  test('liste libre complète', () => {
    const words = readFileSync('public/dict/fr-libre.txt', 'utf8').split('\n').filter(Boolean);
    const t = performance.now();
    const d = new Dawg(words);
    const ms = performance.now() - t;
    expect(d.wordCount).toBe(words.length);
    expect(words.every((w) => d.has(w))).toBe(true);
    expect(d.has('MAISON')).toBe(true);
    expect(d.has('QI')).toBe(true);
    expect(d.has('MAISONZ')).toBe(false);
    expect(ms).toBeLessThan(10000);
    // Le graphe ne contient aucun mot en trop : on énumère tout.
    let n = 0;
    const walk = (node: number) => {
      if (d.isFinal(node)) n++;
      for (const [, child] of d.edges(node)) walk(child);
    };
    walk(d.root);
    expect(n).toBe(words.length);
  }, 60000);
});
