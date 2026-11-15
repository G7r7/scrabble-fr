/**
 * Graphe de mots minimal (DAWG), construit par l'algorithme incrémental
 * de Daciuk et al. à partir d'une liste triée, puis aplati en tableaux typés.
 * Les lettres sont codées 0..25 (A..Z).
 */

class BuildNode {
  static nextId = 0;
  id = BuildNode.nextId++;
  final = false;
  edges = new Map<number, BuildNode>();
  key(): string {
    let k = this.final ? '1' : '0';
    for (const [l, n] of [...this.edges].sort((a, b) => a[0] - b[0])) k += `_${l}:${n.id}`;
    return k;
  }
}

export class Dawg {
  readonly wordCount: number;
  // Exposés en lecture pour les boucles chaudes du générateur de coups.
  readonly edgeStart: Int32Array;
  readonly edgeCount: Uint8Array;
  readonly finals: Uint8Array;
  readonly edgeLetter: Uint8Array;
  readonly edgeTarget: Int32Array;

  /** `words` doit être trié et sans doublon, en majuscules A–Z. */
  constructor(words: string[]) {
    const root = new BuildNode();
    const register = new Map<string, BuildNode>();
    const unchecked: [BuildNode, number, BuildNode][] = [];
    let prev = '';

    const minimize = (downTo: number) => {
      for (let i = unchecked.length - 1; i >= downTo; i--) {
        const [parent, letter, child] = unchecked[i];
        const k = child.key();
        const existing = register.get(k);
        if (existing) parent.edges.set(letter, existing);
        else register.set(k, child);
        unchecked.pop();
      }
    };

    let count = 0;
    for (const w of words) {
      if (w <= prev && prev !== '') continue; // sécurité : tri/doublons
      let cp = 0;
      while (cp < w.length && cp < prev.length && w[cp] === prev[cp]) cp++;
      minimize(cp);
      let node = unchecked.length ? unchecked[unchecked.length - 1][2] : root;
      for (let i = cp; i < w.length; i++) {
        const next = new BuildNode();
        const l = w.charCodeAt(i) - 65;
        node.edges.set(l, next);
        unchecked.push([node, l, next]);
        node = next;
      }
      node.final = true;
      prev = w;
      count++;
    }
    minimize(0);
    this.wordCount = count;

    // Aplatissement en largeur ; la racine reçoit l'indice 0.
    const index = new Map<BuildNode, number>([[root, 0]]);
    const order: BuildNode[] = [root];
    for (let i = 0; i < order.length; i++) {
      for (const n of order[i].edges.values()) {
        if (!index.has(n)) { index.set(n, order.length); order.push(n); }
      }
    }
    const nEdges = order.reduce((s, n) => s + n.edges.size, 0);
    this.edgeStart = new Int32Array(order.length);
    this.edgeCount = new Uint8Array(order.length);
    this.finals = new Uint8Array(order.length);
    this.edgeLetter = new Uint8Array(nEdges);
    this.edgeTarget = new Int32Array(nEdges);
    let e = 0;
    order.forEach((n, i) => {
      this.edgeStart[i] = e;
      this.edgeCount[i] = n.edges.size;
      this.finals[i] = n.final ? 1 : 0;
      for (const [l, child] of [...n.edges].sort((a, b) => a[0] - b[0])) {
        this.edgeLetter[e] = l;
        this.edgeTarget[e] = index.get(child)!;
        e++;
      }
    });
  }

  get root() { return 0; }
  isFinal(node: number) { return this.finals[node] === 1; }

  /** Nœud atteint par la lettre `l` (0..25), ou -1. */
  child(node: number, l: number): number {
    const s = this.edgeStart[node], n = this.edgeCount[node];
    for (let i = s; i < s + n; i++) if (this.edgeLetter[i] === l) return this.edgeTarget[i];
    return -1;
  }

  /** Itère sur les arcs sortants : [lettre, nœud cible]. */
  *edges(node: number): Generator<[number, number]> {
    const s = this.edgeStart[node], n = this.edgeCount[node];
    for (let i = s; i < s + n; i++) yield [this.edgeLetter[i], this.edgeTarget[i]];
  }

  /** Suit une chaîne depuis `node` ; -1 si impossible. */
  walk(str: string, node = 0): number {
    for (let i = 0; i < str.length && node >= 0; i++) node = this.child(node, str.charCodeAt(i) - 65);
    return node;
  }

  has(word: string): boolean {
    const n = this.walk(word);
    return n >= 0 && this.isFinal(n);
  }
}
