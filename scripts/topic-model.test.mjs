import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {train, classify, topicFor, CLASSES} from './topic-model.mjs';
import {topicOf} from './reading-guide.mjs';
const read = f => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url)));
const examples = read('topic_examples.json'), held = read('topic_test.json'), model = read('topic_model.json');

// the shipped model is what the examples train to (rerun scripts/train-topic.mjs after editing them)
assert.deepEqual(model, JSON.parse(JSON.stringify(train(examples))), 'topic_model.json is stale');
// the held-out set shares no sentence with the training set
const seen = new Set(CLASSES.flatMap(c => examples[c]));
assert.ok(CLASSES.every(c => held[c].every(q => !seen.has(q))), 'test sentence leaked into training');

const rows = CLASSES.flatMap(c => held[c].map(q => [q, c])), acc = f => rows.filter(([q, c]) => f(q) === c).length / rows.length;
const kw = acc(topicOf), nb = acc(q => classify(model, q).topic), both = acc(q => topicFor(model, q));
// ponytail: the held-out questions are written by the same author as the training ones, so these floors are optimistic;
// retrain and re-check against real questions once they exist.
assert.ok(nb >= 0.85, `model accuracy ${nb}`);
assert.ok(both >= nb - 0.02 && both > kw + 0.15, `model+keywords ${both} vs keywords ${kw}`);

// implicit wording (no topic keyword) is what the model is for
for (const [q, want] of [['เขาคิดยังไงกับฉัน', 'love'], ['เขาจะทักมาไหม', 'love'], ['อยากเปลี่ยนสายอาชีพ', 'work'], ['ช่วงนี้ใจฉันไม่นิ่งเลย', 'self']])
  assert.equal(topicFor(model, q), want, q);
// no model, empty or unknown text all fall back safely
assert.equal(topicFor(undefined, 'ควรลาออกไหม'), topicOf('ควรลาออกไหม'));
assert.deepEqual(classify(model, ''), {topic: 'general', p: 0});
assert.equal(topicFor(model, undefined), 'general');
console.log(`PASS: topic model ${(nb * 100).toFixed(0)}% / with keywords ${(both * 100).toFixed(0)}% vs keywords alone ${(kw * 100).toFixed(0)}% on ${rows.length} held-out questions`);
