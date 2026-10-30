// Rebuild data/topic_model.json from data/topic_examples.json:  node scripts/train-topic.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {train} from './topic-model.mjs';
const data = f => new URL('../data/' + f, import.meta.url);
const model = train(JSON.parse(readFileSync(data('topic_examples.json'))));
writeFileSync(data('topic_model.json'), JSON.stringify(model));
console.log(`topic_model.json: ${model.vocab} grams, ${(JSON.stringify(model).length / 1024).toFixed(0)} KB`);
