/**
 * Générateur de coups (Appel & Jacobson, 1988) : pour chaque ligne, on calcule
 * les ancres et les contraintes verticales (cross-checks), puis on construit
 * une partie gauche et on étend à droite en suivant le DAWG. Les colonnes sont
 * traitées comme des lignes du plateau transposé.
 */
import { BLANK, SIZE } from '../game/constants';
import { isBoardEmpty } from '../game/board';
import { evaluatePlacement } from '../game/rules';
import type { Board, Move, Placement } from '../game/types';
import type { Dawg } from '../dict/dawg';

const ALL = (1 << 26) - 1;
const BLANK_IDX = 26;

export function generateMoves(dawg: Dawg, board: Board, rack: string[]): Move[] {
  const counts = new Int8Array(27);
  for (const l of rack) counts[l === BLANK ? BLANK_IDX : l.charCodeAt(0) - 65]++;

  const firstMove = isBoardEmpty(board);
  const seen = new Set<string>();
  const moves: Move[] = [];

  for (const vertical of [false, true]) {
    // Grille de lettres dans l'orientation courante (-1 = vide).
    const g = (r: number, c: number): number => {
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
      const t = vertical ? board[c][r] : board[r][c];
      return t ? t.letter.charCodeAt(0) - 65 : -1;
    };

    for (let row = 0; row < SIZE; row++) {
      const cross = new Int32Array(SIZE);
      const anchor = new Uint8Array(SIZE);
      for (let c = 0; c < SIZE; c++) {
        if (g(row, c) >= 0) continue;
        const up = g(row - 1, c) >= 0, down = g(row + 1, c) >= 0;
        if (!up && !down) cross[c] = ALL;
        else {
          let r0 = row - 1;
          while (g(r0 - 1, c) >= 0) r0--;
          let node = dawg.root;
          for (let r = r0; r < row && node >= 0; r++) node = dawg.child(node, g(r, c));
          let mask = 0;
          if (node >= 0) {
            for (const [l, child] of dawg.edges(node)) {
              let n = child;
              for (let r = row + 1; g(r, c) >= 0 && n >= 0; r++) n = dawg.child(n, g(r, c));
              if (n >= 0 && dawg.isFinal(n)) mask |= 1 << l;
            }
          }
          cross[c] = mask;
        }
        if (firstMove) anchor[c] = row === 7 && c === 7 ? 1 : 0;
        else anchor[c] = up || down || g(row, c - 1) >= 0 || g(row, c + 1) >= 0 ? 1 : 0;
      }

      const left: [number, boolean][] = [];
      const right: [number, number, boolean][] = []; // [col, lettre, joker]

      const record = (anchorCol: number) => {
        const ps: Placement[] = [];
        const toPlacement = (col: number, l: number, blank: boolean): Placement => ({
          r: vertical ? col : row,
          c: vertical ? row : col,
          letter: String.fromCharCode(65 + l),
          blank,
        });
        left.forEach(([l, b], i) => ps.push(toPlacement(anchorCol - left.length + i, l, b)));
        for (const [col, l, b] of right) ps.push(toPlacement(col, l, b));
        const key = ps
          .map((p) => `${p.r},${p.c},${p.letter}${p.blank ? '*' : ''}`)
          .sort()
          .join('|');
        if (seen.has(key)) return;
        seen.add(key);
        const res = evaluatePlacement(board, ps);
        if (res.ok) moves.push({ placements: ps, words: res.words, score: res.score });
      };

      const extendRight = (node: number, sq: number, anchorCol: number) => {
        if (sq < SIZE && g(row, sq) >= 0) {
          const child = dawg.child(node, g(row, sq));
          if (child >= 0) extendRight(child, sq + 1, anchorCol);
          return;
        }
        if (sq > anchorCol && dawg.isFinal(node)) record(anchorCol);
        if (sq >= SIZE) return;
        const mask = cross[sq];
        if (!mask) return;
        const s = dawg.edgeStart[node], e = s + dawg.edgeCount[node];
        for (let i = s; i < e; i++) {
          const l = dawg.edgeLetter[i];
          if (!(mask & (1 << l))) continue;
          const child = dawg.edgeTarget[i];
          if (counts[l] > 0) {
            counts[l]--; right.push([sq, l, false]);
            extendRight(child, sq + 1, anchorCol);
            right.pop(); counts[l]++;
          }
          // Le joker n'est essayé que si la vraie lettre manque (meilleur score, moins de coups).
          else if (counts[BLANK_IDX] > 0) {
            counts[BLANK_IDX]--; right.push([sq, l, true]);
            extendRight(child, sq + 1, anchorCol);
            right.pop(); counts[BLANK_IDX]++;
          }
        }
      };

      const leftPart = (node: number, limit: number, anchorCol: number) => {
        extendRight(node, anchorCol, anchorCol);
        if (limit <= 0) return;
        const s = dawg.edgeStart[node], e = s + dawg.edgeCount[node];
        for (let i = s; i < e; i++) {
          const l = dawg.edgeLetter[i], child = dawg.edgeTarget[i];
          if (counts[l] > 0) {
            counts[l]--; left.push([l, false]);
            leftPart(child, limit - 1, anchorCol);
            left.pop(); counts[l]++;
          }
          // Le joker n'est essayé que si la vraie lettre manque (meilleur score, moins de coups).
          else if (counts[BLANK_IDX] > 0) {
            counts[BLANK_IDX]--; left.push([l, true]);
            leftPart(child, limit - 1, anchorCol);
            left.pop(); counts[BLANK_IDX]++;
          }
        }
      };

      for (let a = 0; a < SIZE; a++) {
        if (!anchor[a]) continue;
        if (a > 0 && g(row, a - 1) >= 0) {
          // Partie gauche imposée par les lettres déjà sur le plateau.
          let k = a - 1;
          while (g(row, k - 1) >= 0) k--;
          let node = dawg.root;
          for (let c = k; c < a && node >= 0; c++) node = dawg.child(node, g(row, c));
          if (node >= 0) extendRight(node, a, a);
        } else {
          let limit = 0;
          for (let k = a - 1; k >= 0 && g(row, k) < 0 && !anchor[k]; k--) limit++;
          leftPart(dawg.root, Math.min(limit, rack.length - 1), a);
        }
      }
    }
  }
  return moves;
}
