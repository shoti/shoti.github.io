'use strict';

const assert = require('assert');
const {
  adjacentStoryIndex,
  applyReaderPreferences,
  calculateReadingProgress,
  createTableOfContentsEntries,
  createFrameScheduler,
  dismissReaderSettings,
  findActiveStoryIndex,
  initializeTableOfContents,
  isNavActive,
  normalizeReaderPreferences,
  pickClosestIntersecting,
  readReaderPreferences,
  readStoredTheme,
  readerControlState,
  resolveTheme,
  shouldDismissReaderSettings,
  slugifyHeading,
  stepReaderSize,
  subscribeToMediaChanges,
  themeControlState,
  updateReadingProgressBar,
  writeReaderPreferences,
  writeStoredTheme
} = require('../static/js/main');

assert.strictEqual(readStoredTheme(() => ({ getItem: () => 'dark' })), 'dark');
assert.strictEqual(themeControlState('dark', 'ka').label, 'ღია ფერზე გადასვლა');
assert.strictEqual(themeControlState('light', 'ka').label, 'მუქ ფერზე გადასვლა');
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

assert.strictEqual(slugifyHeading('A Better Reading Experience!'), 'a-better-reading-experience');
assert.strictEqual(slugifyHeading('...'), 'section');
assert.deepStrictEqual(createTableOfContentsEntries([
  { level: 2, title: 'Why this matters' },
  { level: 3, title: 'The details' },
  { level: 2, title: 'Why this matters' }
]), [
  { id: 'section-why-this-matters', level: 2, title: 'Why this matters' },
  { id: 'section-the-details', level: 3, title: 'The details' },
  { id: 'section-why-this-matters-2', level: 2, title: 'Why this matters' }
]);
assert.deepStrictEqual(createTableOfContentsEntries([
  { id: 'section-existing-anchor', level: 2, title: 'Different text' }
]), [
  { id: 'section-existing-anchor', level: 2, title: 'Different text' }
]);

const fakeHeadings = [
  { id: 'section-first', tagName: 'H2', textContent: 'First' },
  { id: 'section-detail', tagName: 'H3', textContent: 'Detail' },
  { id: 'section-last', tagName: 'H2', textContent: 'Last' }
];
const fakeList = {
  children: [],
  appendChild(child) { this.children.push(child); }
};
const fakeCount = { textContent: '' };
const fakeContainer = {
  hidden: true,
  querySelector: selector => ({
    '#post-toc-list': fakeList,
    '#post-toc-count': fakeCount
  })[selector] || null
};
const originalDocument = global.document;
global.document = {
  createElement: tagName => ({
    tagName,
    children: [],
    appendChild(child) { this.children.push(child); }
  })
};
try {
  const initializedEntries = initializeTableOfContents(
    fakeContainer,
    { querySelectorAll: () => fakeHeadings }
  );
  assert.strictEqual(initializedEntries.length, 3);
  assert.strictEqual(fakeContainer.hidden, false);
  assert.strictEqual(fakeCount.textContent, '(3)');
  assert.strictEqual(fakeList.children.length, 3);
  assert.strictEqual(fakeList.children[0].className, 'toc-level-2');
  assert.strictEqual(fakeList.children[0].children[0].href, '#section-first');
  assert.strictEqual(fakeList.children[0].children[0].textContent, 'First');

  const shortContainer = { hidden: true };
  assert.deepStrictEqual(initializeTableOfContents(
    shortContainer,
    { querySelectorAll: () => fakeHeadings.slice(0, 2) }
  ), []);
  assert.strictEqual(shortContainer.hidden, true);
} finally {
  if (originalDocument === undefined) delete global.document;
  else global.document = originalDocument;
}

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
assert.strictEqual(isNavActive('/archive/', '/archive/'), true);
assert.strictEqual(isNavActive('/news/', '/news/'), true);
assert.strictEqual(isNavActive('/news/2026-09-20/', '/news/'), true);
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

// News story rail: reading position and j/k navigation.
assert.strictEqual(findActiveStoryIndex([-800, -120, 40, 900]), 2);
assert.strictEqual(findActiveStoryIndex([500, 900, 1400]), 0);
assert.strictEqual(findActiveStoryIndex([-500, -300, -50]), 2);
assert.strictEqual(findActiveStoryIndex([]), 0);

assert.strictEqual(adjacentStoryIndex(2, 1, 5), 3);
assert.strictEqual(adjacentStoryIndex(4, 1, 5), 4);
assert.strictEqual(adjacentStoryIndex(0, -1, 5), 0);
assert.strictEqual(adjacentStoryIndex(-1, 1, 5), 0);
assert.strictEqual(adjacentStoryIndex(-1, -1, 5), 0);
assert.strictEqual(adjacentStoryIndex(2, 1, 0), -1);

assert.strictEqual(pickClosestIntersecting([
  { id: 'a', top: 300, isIntersecting: true },
  { id: 'b', top: -50, isIntersecting: true },
  { id: 'c', top: 900, isIntersecting: false }
]), 'b');
assert.strictEqual(pickClosestIntersecting([
  { id: 'a', top: 300, isIntersecting: false }
]), null);
assert.strictEqual(pickClosestIntersecting([]), null);

console.log('Client tests passed');
