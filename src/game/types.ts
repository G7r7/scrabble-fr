export interface Tile { letter: string; blank: boolean }
export type Board = (Tile | null)[][];
export interface Placement { r: number; c: number; letter: string; blank: boolean }
export interface FormedWord { word: string; cells: [number, number][]; score: number }
export interface Move { placements: Placement[]; words: FormedWord[]; score: number }
