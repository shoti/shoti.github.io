'use strict';

const READER_DEFAULTS = Object.freeze({
  font: 'serif',
  size: 'medium',
  spacing: 'comfortable'
});
const READER_SIZES = Object.freeze(['small', 'medium', 'large', 'x-large']);
const READER_SIZE_LABELS = Object.freeze({
  small: '90%',
  medium: '100%',
  large: '112%',
  'x-large': '125%'
});
const READER_FONTS = Object.freeze(['serif', 'sans']);
const READER_SPACING = Object.freeze(['compact', 'comfortable', 'relaxed']);

function readStoredTheme(getStorage = () => localStorage) {
  try {
    const stored = getStorage().getItem('theme');
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme, getStorage = () => localStorage) {
  try {
    getStorage().setItem('theme', theme);
    return true;
  } catch {
    return false;
  }
}

function clearStoredTheme(getStorage = () => localStorage) {
  try {
    getStorage().removeItem('theme');
    return true;
  } catch {
    return false;
  }
}

function normalizeReaderPreferences(preferences = {}) {
  return {
    font: READER_FONTS.includes(preferences.font) ? preferences.font : READER_DEFAULTS.font,
    size: READER_SIZES.includes(preferences.size) ? preferences.size : READER_DEFAULTS.size,
    spacing: READER_SPACING.includes(preferences.spacing) ? preferences.spacing : READER_DEFAULTS.spacing
  };
}

function readReaderPreferences(getStorage = () => localStorage) {
  try {
    const storage = getStorage();
    return normalizeReaderPreferences({
      font: storage.getItem('reader-font'),
      size: storage.getItem('reader-size'),
      spacing: storage.getItem('reader-spacing')
    });
  } catch {
    return { ...READER_DEFAULTS };
  }
}

function writeReaderPreferences(preferences, getStorage = () => localStorage) {
  const normalized = normalizeReaderPreferences(preferences);
  try {
    const storage = getStorage();
    storage.setItem('reader-font', normalized.font);
    storage.setItem('reader-size', normalized.size);
    storage.setItem('reader-spacing', normalized.spacing);
    return true;
  } catch {
    return false;
  }
}

function applyReaderPreferences(root, preferences) {
  const normalized = normalizeReaderPreferences(preferences);
  root.dataset.readerFont = normalized.font;
  root.dataset.readerSize = normalized.size;
  root.dataset.readerSpacing = normalized.spacing;
  return normalized;
}

function stepReaderSize(size, direction) {
  const currentIndex = READER_SIZES.indexOf(size);
  const safeIndex = currentIndex === -1 ? READER_SIZES.indexOf(READER_DEFAULTS.size) : currentIndex;
  const nextIndex = Math.min(READER_SIZES.length - 1, Math.max(0, safeIndex + direction));
  return READER_SIZES[nextIndex];
}

function readerControlState(preferences) {
  const normalized = normalizeReaderPreferences(preferences);
  const sizeIndex = READER_SIZES.indexOf(normalized.size);
  return {
    ...normalized,
    sizeLabel: READER_SIZE_LABELS[normalized.size],
    canDecrease: sizeIndex > 0,
    canIncrease: sizeIndex < READER_SIZES.length - 1
  };
}

function slugifyHeading(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function createTableOfContentsEntries(headings) {
  const counts = new Map();
  return headings.map(heading => {
    const base = heading.id || `section-${slugifyHeading(heading.title)}`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    return {
      id: count === 1 ? base : `${base}-${count}`,
      level: heading.level === 3 ? 3 : 2,
      title: String(heading.title).trim()
    };
  });
}

function shouldDismissReaderSettings(readerSettings, target) {
  return Boolean(readerSettings?.open && !readerSettings.contains(target));
}

function dismissReaderSettings(readerSettings, restoreFocus = false) {
  if (!readerSettings?.open) return false;
  readerSettings.open = false;
  if (restoreFocus) readerSettings.querySelector('summary')?.focus();
  return true;
}

function initializeTableOfContents(container, articleBody) {
  if (!container || !articleBody) return [];
  const headings = Array.from(articleBody.querySelectorAll('h2, h3'));
  if (headings.length < 3) return [];

  const entries = createTableOfContentsEntries(headings.map(heading => ({
    id: heading.id,
    level: Number(heading.tagName.slice(1)),
    title: heading.textContent
  })));
  const list = container.querySelector('#post-toc-list');
  const count = container.querySelector('#post-toc-count');
  if (!list || !count) return [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    headings[index].id = entry.id;
    const item = document.createElement('li');
    item.className = `toc-level-${entry.level}`;
    const link = document.createElement('a');
    link.href = `#${entry.id}`;
    link.textContent = entry.title;
    item.appendChild(link);
    list.appendChild(item);
  }
  count.textContent = `(${entries.length})`;
  container.hidden = false;
  return entries;
}

function resolveTheme(explicitTheme, prefersDark) {
  if (explicitTheme === 'dark' || explicitTheme === 'light') return explicitTheme;
  return prefersDark ? 'dark' : 'light';
}

function themeControlState(theme, language = 'en') {
  const dark = theme === 'dark';
  const georgian = language === 'ka';
  return {
    label: georgian
      ? dark ? 'ღია ფონზე გადასვლა' : 'მუქ ფონზე გადასვლა'
      : dark ? 'Switch to light mode' : 'Switch to dark mode',
    text: georgian ? (dark ? 'ღია ფონი' : 'მუქი ფონი') : (dark ? 'Light' : 'Dark'),
    pressed: String(dark)
  };
}

function subscribeToMediaChanges(mediaQuery, listener) {
  if (typeof mediaQuery.addEventListener !== 'function') return false;
  mediaQuery.addEventListener('change', listener);
  return true;
}

function isNavActive(pathname, href) {
  return href === '/'
    ? pathname === '/' || pathname.startsWith('/posts/')
    : pathname.startsWith(href);
}

function calculateReadingProgress(scrollTop, contentHeight, viewportHeight, contentTop = 0) {
  const maxScroll = contentHeight - viewportHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(100, Math.max(0, (scrollTop - contentTop) / maxScroll * 100));
}

function updateReadingProgressBar(bar, content, scrollTop, viewportHeight, documentHeight) {
  const progress = calculateReadingProgress(
    scrollTop,
    content?.offsetHeight || documentHeight,
    viewportHeight,
    content?.offsetTop || 0
  );
  bar.style.transform = `scaleX(${progress / 100})`;
  bar.setAttribute('aria-valuenow', String(Math.round(progress)));
  return progress;
}

function createFrameScheduler(callback, scheduleFrame = requestAnimationFrame) {
  let queued = false;
  return () => {
    if (queued) return false;
    queued = true;
    scheduleFrame(() => {
      callback();
      queued = false;
    });
    return true;
  };
}

// Reading position among a list of story tops (each element's distance from the viewport top).
// The active story is the last one whose top has reached or passed the threshold.
function findActiveStoryIndex(tops, thresholdOffset = 96) {
  let index = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= thresholdOffset) index = i;
    else break;
  }
  return index;
}

function adjacentStoryIndex(currentIndex, direction, length) {
  if (length <= 0) return -1;
  const base = currentIndex === -1 ? (direction > 0 ? -1 : 0) : currentIndex;
  return Math.min(length - 1, Math.max(0, base + direction));
}

// Among intersection entries, the "active" story is the one most recently scrolled into —
// i.e. the largest top still counts as intersecting, not the smallest. A story you've
// mostly scrolled past keeps a deeply negative top while still barely intersecting, and
// must not outrank a story that just entered with a top near zero.
function pickClosestIntersecting(entries) {
  const visible = entries.filter(entry => entry.isIntersecting);
  if (!visible.length) return null;
  return visible.reduce((a, b) => (a.top >= b.top ? a : b)).id;
}

// Move only the index's own scroll area; scrollIntoView would also move the
// article the reader is following. Oversized entries keep their beginning visible.
function revealContentsLink(contents, link) {
  if (!contents?.open || !link || !contents.clientHeight) return;
  const top = contents.getBoundingClientRect().top + contents.clientTop;
  const bottom = top + contents.clientHeight;
  const bounds = link.getBoundingClientRect();
  const delta = bounds.top < top || bounds.height > contents.clientHeight
    ? bounds.top - top
    : Math.max(0, bounds.bottom - bottom);
  if (delta) contents.scrollTop += delta;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    const toggles = [
      document.getElementById('theme-toggle'),
      document.getElementById('news-theme-toggle')
    ].filter(Boolean);
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const stored = readStoredTheme();
    if (stored) root.setAttribute('data-theme', stored);

    const effectiveTheme = () => resolveTheme(root.getAttribute('data-theme'), mediaQuery.matches);

    const updateThemeControl = () => {
      const state = themeControlState(effectiveTheme(), root.lang);
      for (const button of toggles) {
        button.hidden = false;
        button.setAttribute('aria-pressed', state.pressed);
        button.setAttribute('aria-label', state.label);
        const text = button.querySelector('.news-theme-toggle-text');
        if (text) text.textContent = state.text;
      }
    };
    updateThemeControl();
    subscribeToMediaChanges(mediaQuery, updateThemeControl);

    // Enable theme transitions after initial paint to prevent flash
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('transitions-ready');
    }));

    for (const button of toggles) {
      button.addEventListener('click', () => {
        const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        writeStoredTheme(next);
        updateThemeControl();
        if (button.id !== 'theme-toggle') return;
        const rotation = parseInt(button.dataset.r || '0', 10) + 180;
        button.dataset.r = rotation;
        button.style.transform = `rotate(${rotation}deg)`;
      });
    }

    // Reader preferences
    let readerPreferences = applyReaderPreferences(root, readReaderPreferences());
    const sizeOutput = document.getElementById('reader-size-value');
    const sizeButtons = Array.from(document.querySelectorAll('[data-reader-size-step]'));
    const fontButtons = Array.from(document.querySelectorAll('button[data-reader-font]'));
    const spacingButtons = Array.from(document.querySelectorAll('button[data-reader-spacing]'));

    const syncReaderControls = () => {
      const state = readerControlState(readerPreferences);
      if (sizeOutput) sizeOutput.textContent = state.sizeLabel;
      for (const button of sizeButtons) {
        const direction = Number(button.dataset.readerSizeStep);
        button.disabled = direction < 0 ? !state.canDecrease : !state.canIncrease;
      }
      for (const button of fontButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.readerFont === state.font));
      }
      for (const button of spacingButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.readerSpacing === state.spacing));
      }
    };

    const updateReaderPreferences = nextPreferences => {
      readerPreferences = applyReaderPreferences(root, nextPreferences);
      writeReaderPreferences(readerPreferences);
      syncReaderControls();
    };

    for (const button of sizeButtons) {
      button.addEventListener('click', () => updateReaderPreferences({
        ...readerPreferences,
        size: stepReaderSize(readerPreferences.size, Number(button.dataset.readerSizeStep))
      }));
    }
    for (const button of fontButtons) {
      button.addEventListener('click', () => updateReaderPreferences({
        ...readerPreferences,
        font: button.dataset.readerFont
      }));
    }
    for (const button of spacingButtons) {
      button.addEventListener('click', () => updateReaderPreferences({
        ...readerPreferences,
        spacing: button.dataset.readerSpacing
      }));
    }
    const readerReset = document.getElementById('reader-reset');
    readerReset?.addEventListener('click', () => {
      updateReaderPreferences(READER_DEFAULTS);
      if (readerReset.hasAttribute('data-reset-theme')) {
        clearStoredTheme();
        root.removeAttribute('data-theme');
        updateThemeControl();
      }
    });
    const readerSettings = document.querySelector('.reader-settings');
    document.addEventListener('click', event => {
      if (shouldDismissReaderSettings(readerSettings, event.target)) dismissReaderSettings(readerSettings);
    });
    readerSettings?.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      dismissReaderSettings(readerSettings, true);
    });
    readerSettings?.addEventListener('focusout', event => {
      if (event.relatedTarget && !readerSettings.contains(event.relatedTarget)) dismissReaderSettings(readerSettings);
    });
    syncReaderControls();

    // Article outline
    initializeTableOfContents(
      document.getElementById('post-toc'),
      document.querySelector('.post-body')
    );

    // Active nav link
    const { pathname } = location;
    for (const link of document.querySelectorAll('.site-nav a')) {
      const href = link.getAttribute('href');
      if (isNavActive(pathname, href)) {
        link.classList.add('nav-active');
        link.setAttribute('aria-current', 'page');
      }
    }

    // Reading progress bar
    const bar = document.getElementById('reading-progress');
    if (bar) {
      const article = document.querySelector('.post, .news-briefing');
      const updateReadingProgress = () => updateReadingProgressBar(
        bar,
        article,
        scrollY,
        innerHeight,
        document.documentElement.scrollHeight
      );
      const queueReadingProgressUpdate = createFrameScheduler(updateReadingProgress);
      window.addEventListener('scroll', queueReadingProgressUpdate, { passive: true });
      window.addEventListener('resize', updateReadingProgress);
      updateReadingProgress();
    }

    // News: keep the contents index in step with the reading position. The
    // margin rail and the global j/k shortcut are gone — a single-letter
    // shortcut with no way to turn it off is a WCAG 2.1.4 problem, and the
    // sticky contents route covers navigation at every width instead.
    const newsStories = Array.from(document.querySelectorAll('.news-story'));
    const newsContents = document.getElementById('news-contents');
    const wideNews = newsContents ? matchMedia('(min-width: 1080px)') : null;
    const newsChrome = document.querySelector('.news-chrome');

    // The bar can wrap when text is enlarged. Measure it so anchor targets
    // and the sticky index always clear the actual header, not a fixed guess.
    if (newsChrome) {
      const syncChromeHeight = () => root.style.setProperty(
        '--news-header-height', `${newsChrome.getBoundingClientRect().height}px`
      );
      syncChromeHeight();
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(syncChromeHeight).observe(newsChrome);
      } else {
        window.addEventListener('resize', syncChromeHeight);
      }
    }

    if (newsStories.length > 1 && typeof IntersectionObserver === 'function') {
      const contentsLinks = new Map(Array.from(document.querySelectorAll('.news-contents a'))
        .map(link => [link.getAttribute('href').slice(1), link]));
      let activeStoryId = null;
      const revealActiveStory = () => {
        if (wideNews?.matches) revealContentsLink(newsContents, contentsLinks.get(activeStoryId));
      };
      const setActiveStory = id => {
        if (id === activeStoryId) return;
        if (activeStoryId) contentsLinks.get(activeStoryId)?.removeAttribute('aria-current');
        activeStoryId = id;
        contentsLinks.get(id)?.setAttribute('aria-current', 'true');
        revealActiveStory();
      };
      const observer = new IntersectionObserver(entries => {
        const id = pickClosestIntersecting(entries.map(entry => ({
          id: entry.target.id,
          top: entry.boundingClientRect.top,
          isIntersecting: entry.isIntersecting
        })));
        if (id) setActiveStory(id);
      }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
      for (const story of newsStories) observer.observe(story);
      window.addEventListener('resize', createFrameScheduler(revealActiveStory));
      newsContents?.addEventListener('toggle', revealActiveStory);
    }

    if (newsContents) {
      // The contents ship open so the list is complete without scripting. On
      // narrow screens that would push the first story far down the page, so
      // collapse it here and let the summary reopen it.
      const syncContents = () => { newsContents.open = wideNews.matches; };
      syncContents();
      subscribeToMediaChanges(wideNews, syncContents);

      // Reaching the contents from the sticky bar should show them, not just
      // scroll to a collapsed summary.
      const openContents = () => {
        if (location.hash === '#news-contents') newsContents.open = true;
      };
      window.addEventListener('hashchange', openContents);
      openContents();
      document.addEventListener('click', event => {
        const link = event.target instanceof Element
          ? event.target.closest('a[href="#news-contents"]')
          : null;
        if (link) newsContents.open = true;
      });
    }

    // A collapsed disclosure prints as nothing, so open them for printing and
    // put them back afterwards.
    const printDetails = Array.from(document.querySelectorAll('.news-source-detail, .news-revisions'));
    if (printDetails.length) {
      window.addEventListener('beforeprint', () => {
        for (const item of printDetails) {
          item.dataset.reopen = item.open ? 'open' : 'closed';
          item.open = true;
        }
      });
      window.addEventListener('afterprint', () => {
        for (const item of printDetails) {
          if (item.dataset.reopen === 'closed') item.open = false;
          delete item.dataset.reopen;
        }
      });
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    adjacentStoryIndex,
    applyReaderPreferences,
    calculateReadingProgress,
    clearStoredTheme,
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
    revealContentsLink,
    resolveTheme,
    shouldDismissReaderSettings,
    slugifyHeading,
    stepReaderSize,
    subscribeToMediaChanges,
    themeControlState,
    updateReadingProgressBar,
    writeReaderPreferences,
    writeStoredTheme
  };
}
