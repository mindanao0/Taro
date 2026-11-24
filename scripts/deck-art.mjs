/** Card identity and RWS meanings are shared; artwork and visual descriptions are not. */
export const DEFAULT_DECK = 'gothic-ivory-rose';
export const CHRISTMAS_DECK = 'christmas-wish';
export const DECKS = Object.freeze({
  [DEFAULT_DECK]: Object.freeze({name: 'Gothic Ivory Rose', back: 'assets/card-back-sm.webp', heightPerWidth: 1678 / 937}),
  // Derived from previews/card-back.webp with Lanczos to 240×360 and WebP quality 78;
  // always face the same direction while hidden so reversed cards cannot be identified.
  [CHRISTMAS_DECK]: Object.freeze({name: 'Christmas Wish', back: 'assets/christmas-wish/card-back-sm.webp', heightPerWidth: 3 / 2})
});
const MAJORS = Object.freeze(["fool", "magician", "high-priestess", "empress", "emperor", "hierophant", "lovers", "chariot", "strength", "hermit", "wheel-of-fortune", "justice", "hanged-man", "death", "temperance", "devil", "tower", "star", "moon", "sun", "judgement", "world"]);
const RANKS = 'ace two three four five six seven eight nine ten page knight queen king'.split(' ');
export const isDeck = value => typeof value === 'string' && Object.hasOwn(DECKS, value);
// Explicit +07:00: Bangkok midnight, independent of browser locale and DST.
const CHRISTMAS_START = Date.parse('2026-12-01T00:00:00+07:00');
const CHRISTMAS_END = Date.parse('2027-01-01T00:00:00+07:00');
export function seasonalDeck(now = Date.now()) {
  return now >= CHRISTMAS_START && now < CHRISTMAS_END ? CHRISTMAS_DECK : DEFAULT_DECK;
}
export function artFor(deck, card) {
  if (deck === DEFAULT_DECK) return card;
  if (deck !== CHRISTMAS_DECK) throw new RangeError('Unknown deck');
  const major = /^major-(\d{2})$/.exec(card.id);
  const minor = /^(cups|pentacles|swords|wands)-([a-z]+)$/.exec(card.id);
  let stem;
  if (major && Number(major[1]) < MAJORS.length) stem = card.id + '-' + MAJORS[Number(major[1])];
  else if (minor && RANKS.includes(minor[2])) stem = minor[1] + '-' + String(RANKS.indexOf(minor[2]) + 1).padStart(2, '0');
  else throw new RangeError('Unknown card');
  const image = 'assets/christmas-wish/previews/' + stem + '.webp';
  return {...card, image, image_web: image, alt_th: 'ไพ่' + card.name_th + ' (' + card.name_en + ') ภาพสีน้ำจากสำรับ Christmas Wish'};
}
