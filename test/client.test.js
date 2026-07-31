'use strict';

const assert = require('assert');
const {
  calculateReadingProgress,
  createFrameScheduler,
  isNavActive,
  readStoredTheme,
  resolveTheme,
  subscribeToMediaChanges,
  themeControlState,
  updateReadingProgressBar,
  writeStoredTheme
} = require('../static/js/main');

assert.strictEqual(readStoredTheme(() => ({ getItem: () => 'dark' })), 'dark');
assert.strictEqual(readStoredTheme(() => ({ getItem: () => 'unexpected' })), null);
assert.strictEqual(readStoredTheme(() => { throw new Error('storage blocked'); }), null);
assert.strictEqual(readStoredTheme(() => ({ getItem: () => { throw new Error('read blocked'); } })), null);

let writtenTheme = null;
assert.strictEqual(writeStoredTheme('light', () => ({
  setItem: (key, value) => {
    assert.strictEqual(key, 'theme');
    writtenTheme = value;
  }
})), true);
assert.strictEqual(writtenTheme, 'light');
assert.strictEqual(writeStoredTheme('dark', () => { throw new Error('storage blocked'); }), false);

assert.strictEqual(resolveTheme('light', true), 'light');
assert.strictEqual(resolveTheme(null, true), 'dark');
assert.deepStrictEqual(themeControlState('dark'), {
  label: 'Switch to light mode',
  pressed: 'true'
});
assert.deepStrictEqual(themeControlState('light'), {
  label: 'Switch to dark mode',
  pressed: 'false'
});

let mediaChangeHandler = null;
let mediaSyncCalls = 0;
assert.strictEqual(subscribeToMediaChanges({
  addEventListener: (event, handler) => {
    assert.strictEqual(event, 'change');
    mediaChangeHandler = handler;
  }
}, () => { mediaSyncCalls++; }), true);
assert.strictEqual(typeof mediaChangeHandler, 'function');
mediaChangeHandler();
assert.strictEqual(mediaSyncCalls, 1);
assert.strictEqual(subscribeToMediaChanges({}, () => {}), false);

assert.strictEqual(isNavActive('/', '/'), true);
assert.strictEqual(isNavActive('/posts/example/', '/'), true);
assert.strictEqual(isNavActive('/archive/', '/archive/'), true);
assert.strictEqual(isNavActive('/about/', '/about/'), true);
assert.strictEqual(isNavActive('/404.html', '/'), false);

assert.strictEqual(calculateReadingProgress(0, 2000, 1000), 0);
assert.strictEqual(calculateReadingProgress(500, 2000, 1000), 50);
assert.strictEqual(calculateReadingProgress(2000, 2000, 1000), 100);
assert.strictEqual(calculateReadingProgress(-100, 2000, 1000), 0);
assert.strictEqual(calculateReadingProgress(100, 800, 1000), 0);
assert.strictEqual(calculateReadingProgress(200, 2000, 1000, 200), 0);
assert.strictEqual(calculateReadingProgress(700, 2000, 1000, 200), 50);
assert.strictEqual(calculateReadingProgress(1200, 2000, 1000, 200), 100);

const progressAttributes = {};
const progressBar = {
  style: {},
  setAttribute: (name, value) => { progressAttributes[name] = value; }
};
assert.strictEqual(updateReadingProgressBar(
  progressBar,
  { offsetHeight: 2000, offsetTop: 200 },
  700,
  1000,
  5000
), 50);
assert.strictEqual(progressBar.style.transform, 'scaleX(0.5)');
assert.strictEqual(progressAttributes['aria-valuenow'], '50');

const scheduledFrames = [];
let scheduledUpdates = 0;
const queueUpdate = createFrameScheduler(
  () => { scheduledUpdates++; },
  callback => { scheduledFrames.push(callback); }
);
assert.strictEqual(queueUpdate(), true);
assert.strictEqual(queueUpdate(), false);
assert.strictEqual(scheduledFrames.length, 1);
assert.strictEqual(scheduledUpdates, 0);
scheduledFrames[0]();
assert.strictEqual(scheduledUpdates, 1);
assert.strictEqual(queueUpdate(), true);
assert.strictEqual(scheduledFrames.length, 2);

console.log('Client tests passed');
