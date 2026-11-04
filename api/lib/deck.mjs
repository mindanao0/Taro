// The deck and spreads the API validates against, bundled from the same JSON the website loads.
import cardsFile from '../../data/cards.public.json' with {type: 'json'};
import spreadsFile from '../../data/spreads.json' with {type: 'json'};
import {sha256Hex} from './crypto.mjs';

export const CARDS = [...cardsFile.cards].sort((a, b) => a.order - b.order);
export const CARD_IDS = new Set(CARDS.map(c => c.id));
export const SPREADS = new Map(spreadsFile.spreads.map(s => [s.id, s]));

// Short content hash of what the API was built with; stored on every saved reading so old history stays interpretable.
let version;
export const deckVersion = () => (version ||= sha256Hex(JSON.stringify([CARDS.map(c => [c.id, c.order, c.name_en]), [...SPREADS.values()].map(s => [s.id, s.positions.map(p => p.id)])])).then(h => h.slice(0, 12)));
