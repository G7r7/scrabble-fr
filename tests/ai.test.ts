import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { Dawg } from '../src/dict/dawg';
import { generateMoves } from '../src/ai/movegen';
import { chooseMove } from '../src/ai/player';
import { emptyBoard, applyPlacements } from '../src/game/board';
import { evaluatePlacement } from '../src/game/rules';
import { draw, newBag } from '../src/game/bag';
import type { Board, Placement } from '../src/game/types';

let dawg: Dawg;
beforeAll(() => {
  dawg = new Dawg(readFileSync('public/dict/fr-libre.txt', 'utf8').split('\n').filter(Boolean));
});

const word = (w: string, r: number, c: number, vertical = false): Placement[] =>
  [...w].map((letter, i) => ({ r: vertical ? r + i : r, c: vertical ? c : c + i, letter, blank: false }));

function checkAll(board: Board, rack: string[]) {
  const moves = generateMoves(dawg, board, rack);
  for (const m of moves) {
    const r = evaluatePlacement(board, m.placements);
    expect(r.ok).toBe(true);
    for (const w of m.words) expect(dawg.has(w.word), w.word).toBe(true);
    // les lettres posées viennent du chevalet
    const left = [...rack];
    for (const p of m.placements) {
      const i = left.indexOf(p.blank ? '?' : p.letter);
      expect(i).toBeGreaterThanOrEqual(0);
      left.splice(i, 1);
    }
  }
  return moves;
}

describe('IA', () => {
  test('premier coup', () => {
    const moves = checkAll(emptyBoard(), [...'MAISONT']);
    expect(moves.some((m) => m.words[0].word === 'MAISON')).toBe(true);
  });

  test('trouve les rallonges et les croisements', () => {
    const b = emptyBoard();
    applyPlacements(b, word('CHAT', 7, 7));
    const moves = checkAll(b, [...'SEREINX']);
    const found = new Set(moves.flatMap((m) => m.words.map((w) => w.word)));
    expect(found.has('CHATS')).toBe(true);
    expect(found.has('CHATES') || found.has('CHATIE') || found.has('ACHAT') || found.size > 10).toBe(true);
  });

  test('joker', () => {
    const moves = checkAll(emptyBoard(), [...'ZZZZZQ?']);
    // Avec un joker seulement deux-lettres impossibles sans voyelle : Q+?=QI
    expect(moves.some((m) => m.words[0].word === 'QI')).toBe(true);
  });

  test('parties simulées IA contre IA', () => {
    for (let g = 0; g < 3; g++) {
      const board = emptyBoard();
      const bag = newBag();
      const racks = [draw(bag, 7), draw(bag, 7)];
      let passes = 0, turn = 0;
      while (passes < 6 && racks.every((r) => r.length > 0) && turn < 100) {
        const rack = racks[turn % 2];
        const t = performance.now();
        const d = chooseMove(dawg, board, rack, bag.length, 'difficile');
        expect(performance.now() - t).toBeLessThan(5000);
        if (d.kind === 'play') {
          const r = evaluatePlacement(board, d.move.placements);
          expect(r.ok).toBe(true);
          for (const w of d.move.words) expect(dawg.has(w.word)).toBe(true);
          applyPlacements(board, d.move.placements);
          for (const p of d.move.placements) rack.splice(rack.indexOf(p.blank ? '?' : p.letter), 1);
          rack.push(...draw(bag, 7 - rack.length));
          passes = 0;
        } else passes++;
        turn++;
      }
      expect(turn).toBeGreaterThan(5);
    }
  }, 120000);
});
