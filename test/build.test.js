'use strict';

const assert = require('assert');
const { parseMarkdown } = require('../build');

const flow = parseMarkdown('```flow\nFirst step\nSecond <unsafe> step\n```');

assert.match(flow, /<ol class="flow-diagram" role="list" aria-label="Process flow">/);
assert.match(flow, /<li>First step<\/li>/);
assert.match(flow, /<li>Second &lt;unsafe&gt; step<\/li>/);
assert.doesNotMatch(flow, /<pre>/);
assert.doesNotMatch(flow, /<unsafe>/);

const emptyFlow = parseMarkdown('```flow\n\n```');
assert.strictEqual(emptyFlow, '');

console.log('Build tests passed');
