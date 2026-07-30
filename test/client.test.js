'use strict';

const assert = require('assert');
const {
  calculateReadingProgress,
  isNavActive,
  readStoredTheme,
  resolveTheme,
  themeControlState,
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

console.log('Client tests passed');
