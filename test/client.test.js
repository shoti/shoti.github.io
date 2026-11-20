'use strict';

const assert = require('assert');
const {
  applyReaderPreferences,
  calculateReadingProgress,
  createFrameScheduler,
  dismissReaderSettings,
  findActiveHeadingIndex,
  isNavActive,
  markActiveTocLink,
  minutesLeft,
  normalizeReaderPreferences,
  readReaderPreferences,
  readStoredTheme,
  readerControlState,
  resolveTheme,
  shouldDismissReaderSettings,
  shouldShowReadingDock,
  stepReaderSize,
  subscribeToMediaChanges,
  themeControlState,
  themeRevealRadius,
  updateReadingProgressBar,
  writeReaderPreferences,
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
assert.deepStrictEqual(normalizeReaderPreferences({
  font: 'sans',
  size: 'large',
  spacing: 'relaxed'
}), { font: 'sans', size: 'large', spacing: 'relaxed' });
assert.deepStrictEqual(normalizeReaderPreferences({
  font: 'comic-sans',
  size: 'giant',
  spacing: 'wide'
}), { font: 'serif', size: 'medium', spacing: 'comfortable' });
assert.deepStrictEqual(readReaderPreferences(() => ({
  getItem: key => ({
    'reader-font': 'sans',
    'reader-size': 'x-large',
    'reader-spacing': 'compact'
  })[key]
})), { font: 'sans', size: 'x-large', spacing: 'compact' });
assert.deepStrictEqual(readReaderPreferences(() => { throw new Error('storage blocked'); }), {
  font: 'serif',
  size: 'medium',
  spacing: 'comfortable'
});

const storedReaderPreferences = {};
assert.strictEqual(writeReaderPreferences({ font: 'sans', size: 'large', spacing: 'relaxed' }, () => ({
  setItem: (key, value) => { storedReaderPreferences[key] = value; }
})), true);
assert.deepStrictEqual(storedReaderPreferences, {
  'reader-font': 'sans',
  'reader-size': 'large',
  'reader-spacing': 'relaxed'
});
assert.strictEqual(writeReaderPreferences({}, () => { throw new Error('storage blocked'); }), false);

const readerRoot = { dataset: {} };
assert.deepStrictEqual(applyReaderPreferences(readerRoot, { font: 'sans', size: 'small', spacing: 'compact' }), {
  font: 'sans', size: 'small', spacing: 'compact'
});
assert.deepStrictEqual(readerRoot.dataset, {
  readerFont: 'sans', readerSize: 'small', readerSpacing: 'compact'
});
assert.strictEqual(stepReaderSize('medium', 1), 'large');
assert.strictEqual(stepReaderSize('small', -1), 'small');
assert.strictEqual(stepReaderSize('x-large', 1), 'x-large');
assert.deepStrictEqual(readerControlState({ font: 'serif', size: 'medium', spacing: 'comfortable' }), {
  font: 'serif',
  size: 'medium',
  spacing: 'comfortable',
  sizeLabel: '100%',
  canDecrease: true,
  canIncrease: true
});


let summaryFocused = false;
const readerSettings = {
  open: true,
  contains: target => target === 'inside',
  querySelector: selector => selector === 'summary' ? { focus: () => { summaryFocused = true; } } : null
};
assert.strictEqual(shouldDismissReaderSettings(readerSettings, 'inside'), false);
assert.strictEqual(shouldDismissReaderSettings(readerSettings, 'outside'), true);
assert.strictEqual(dismissReaderSettings(readerSettings, true), true);
assert.strictEqual(readerSettings.open, false);
assert.strictEqual(summaryFocused, true);
assert.strictEqual(dismissReaderSettings(readerSettings, true), false);

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

assert.strictEqual(findActiveHeadingIndex([], 300), -1);
assert.strictEqual(findActiveHeadingIndex([400, 900, 1500], 300), -1);
assert.strictEqual(findActiveHeadingIndex([300, 900, 1500], 300), 0);
assert.strictEqual(findActiveHeadingIndex([-800, -200, 250, 1200], 300), 2);
assert.strictEqual(findActiveHeadingIndex([-3000, -2000, -1000], 300), 2);

const tocLinkAttributes = [{}, {}, {}];
const tocLinks = tocLinkAttributes.map(attributes => ({
  setAttribute: (name, value) => { attributes[name] = value; },
  removeAttribute: name => { delete attributes[name]; }
}));
markActiveTocLink(tocLinks, 1);
assert.deepStrictEqual(tocLinkAttributes, [{}, { 'aria-current': 'location' }, {}]);
markActiveTocLink(tocLinks, -1);
assert.deepStrictEqual(tocLinkAttributes, [{}, {}, {}]);

assert.strictEqual(themeRevealRadius(0, 0, 3, 4), 5);
assert.strictEqual(themeRevealRadius(3, 4, 3, 4), 5);
assert.strictEqual(themeRevealRadius(100, 50, 400, 300), Math.hypot(300, 250));

const dockRange = { start: 500, end: 5000 };
// Outside the article the dock is always hidden.
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 100, previousScrollY: 200, visible: true }), false);
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 5200, previousScrollY: 5300, visible: true }), false);
// Scrolling up reveals it, scrolling down hides it, jitter keeps the current state.
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 1000, previousScrollY: 1040, visible: false }), true);
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 1040, previousScrollY: 1000, visible: true }), false);
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 1003, previousScrollY: 1000, visible: true }), true);
assert.strictEqual(shouldShowReadingDock({ ...dockRange, scrollY: 997, previousScrollY: 1000, visible: false }), false);

assert.strictEqual(minutesLeft(10, 0), 10);
assert.strictEqual(minutesLeft(10, 45), 6);
assert.strictEqual(minutesLeft(10, 100), 0);
assert.strictEqual(minutesLeft(10, -20), 10);
assert.strictEqual(minutesLeft(1, 99), 1);

console.log('Client tests passed');
