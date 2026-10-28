export type Suit = 'wands' | 'cups' | 'swords' | 'pentacles';
export type Orientation = 'upright' | 'reversed';
export type MinorRank = 'ace' | 'two' | 'three' | 'four' | 'five' | 'six' | 'seven' | 'eight' | 'nine' | 'ten' | 'page' | 'knight' | 'queen' | 'king';
export interface Card {
  id: string;
  order: number;
  arcana: 'major' | 'minor';
  suit: Suit | null;
  rank: number | MinorRank;
  name_en: string;
  name_th: string;
  display_mark: string;
  upright_th: string;
  reversed_th: string;
  love_th: string;
  work_th: string;
  advice_th: string;
  reflection_th: string;
  keywords_th: string[];
  image: string;
  image_web: string;
  alt_th: string;
  scene_prompt: string;
  generation_prompt: string;
  source_id: string;
  interpretation_origin: string;
  visual_adaptation: string;
}
export interface SpreadPosition {
  id: string;
  label_th: string;
  x: number;
  y: number;
  layout_rotation: number;
}
export interface Spread {
  id: string;
  name_th: string;
  origin: string;
  positions: SpreadPosition[];
}
export interface Reading {
  schema_version: '1.0.0';
  deck_id: string;
  spread_id: string;
  question: string;
  created_at: string;
  reversed_enabled: boolean;
  cards: Array<{card_id: string; position_id: string; orientation: Orientation}>;
}
