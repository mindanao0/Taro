/** Question-topic classifier: multinomial Naive Bayes on character 2- and 3-grams (Thai has no word spaces).
 *  Pure JS, no dependencies. Train with scripts/train-topic.mjs; the browser only loads the small JSON it writes. */
import {topicOf} from './reading-guide.mjs';

export const CLASSES = ['love', 'work', 'self', 'general'];
const grams = text => {
  const s = Array.from(String(text ?? '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')), out = [];
  for (const n of [2, 3]) for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n).join(''));
  return out;
};

/** examples = {class: [question, ...]}. Grams seen fewer than minCount times overall are dropped (smaller model, less noise). */
export function train(examples, {alpha = 0.5, minCount = 2} = {}) {
  const raw = {}, total = Object.fromEntries(CLASSES.map(c => [c, 0])), docs = {};
  CLASSES.forEach((c, ci) => {
    docs[c] = examples[c].length;
    for (const q of examples[c]) for (const g of grams(q)) (raw[g] ??= CLASSES.map(() => 0))[ci]++;
  });
  const counts = {};
  for (const g of Object.keys(raw).sort()) if (raw[g].reduce((a, b) => a + b) >= minCount) {
    counts[g] = raw[g]; CLASSES.forEach((c, ci) => total[c] += raw[g][ci]);
  }
  const n = Object.values(docs).reduce((a, b) => a + b);
  return {classes: CLASSES, alpha, vocab: Object.keys(counts).length, total, prior: Object.fromEntries(CLASSES.map(c => [c, Math.log(docs[c] / n)])), counts};
}

/** -> {topic, p} where p is the posterior of the winning class; unknown text (no known grams) gives {topic: 'general', p: 0}. */
export function classify(model, text) {
  const known = grams(text).filter(g => model.counts[g]);
  if (!known.length) return {topic: 'general', p: 0};
  const logp = CLASSES.map((c, ci) => known.reduce((s, g) =>
    s + Math.log((model.counts[g][ci] + model.alpha) / (model.total[c] + model.alpha * model.vocab)), model.prior[c]));
  const max = Math.max(...logp), e = logp.map(x => Math.exp(x - max)), sum = e.reduce((a, b) => a + b), best = e.indexOf(Math.max(...e));
  return {topic: CLASSES[best], p: e[best] / sum};
}

/** The model when it is confident, else the keyword table (which also covers a missing model). */
export function topicFor(model, question, threshold = 0.6) {
  if (model) { const r = classify(model, question); if (r.p >= threshold) return r.topic; }
  return topicOf(question);
}
