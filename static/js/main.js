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

function shouldDismissReaderSettings(readerSettings, target) {
  return Boolean(readerSettings?.open && !readerSettings.contains(target));
}

function dismissReaderSettings(readerSettings, restoreFocus = false) {
  if (!readerSettings?.open) return false;
  readerSettings.open = false;
  if (restoreFocus) readerSettings.querySelector('summary')?.focus();
  return true;
}

// Index of the section being read: the last heading whose top has scrolled past the
// reading line. -1 while the reader is still above the first heading.
function findActiveHeadingIndex(headingTops, readingLine) {
  let active = -1;
  for (let index = 0; index < headingTops.length; index++) {
    if (headingTops[index] <= readingLine) active = index;
    else break;
  }
  return active;
}

function markActiveTocLink(links, activeIndex) {
  links.forEach((link, index) => {
    if (index === activeIndex) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

// The mobile reading dock stays out of the way while reading forward and comes
// back when the reader scrolls up — but only between the article start and end.
const DOCK_SCROLL_THRESHOLD = 6;

function shouldShowReadingDock({ scrollY, previousScrollY, start, end, visible }) {
  if (scrollY < start || scrollY > end) return false;
  const delta = scrollY - previousScrollY;
  if (Math.abs(delta) < DOCK_SCROLL_THRESHOLD) return visible;
  return delta < 0;
}

function minutesLeft(readingTime, progress) {
  const remaining = Math.ceil(readingTime * (1 - progress / 100));
  return Math.max(0, Math.min(readingTime, remaining));
}

// Radius that lets a circle centred on (x, y) cover the whole viewport.
function themeRevealRadius(x, y, width, height) {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

function resolveTheme(explicitTheme, prefersDark) {
  if (explicitTheme === 'dark' || explicitTheme === 'light') return explicitTheme;
  return prefersDark ? 'dark' : 'light';
}

function themeControlState(theme) {
  const dark = theme === 'dark';
  return {
    label: dark ? 'Switch to light mode' : 'Switch to dark mode',
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

// Progress bar, active section and reading dock share one scroll listener. Layout is
// measured only when the article resizes (fonts, reader settings, viewport), so the
// per-frame work is arithmetic plus a few writes — no layout reads while scrolling.
function initializeReadingTracker(article, bar) {
  const outline = document.getElementById('post-outline');
  const toc = document.getElementById('post-toc');
  const dock = document.getElementById('reading-dock');
  const sheet = document.getElementById('reading-sheet');
  const body = article.querySelector('.post-body');
  const footer = article.querySelector('.post-footer');
  const outlineLinks = outline ? Array.from(outline.querySelectorAll('a')) : [];
  const tocLinks = toc ? Array.from(toc.querySelectorAll('a')) : [];
  const sheetLinks = sheet ? Array.from(sheet.querySelectorAll('.reading-sheet-list a')) : [];
  const headings = outlineLinks.map(link => document.getElementById(link.getAttribute('href').slice(1)));
  const hasOutline = headings.length > 0 && headings.every(Boolean);
  const dockSection = document.getElementById('reading-dock-section');
  const dockLeft = document.getElementById('reading-dock-left');
  const readingTime = Number(dock?.dataset.readingTime) || 1;

  const metrics = { top: 0, height: 0, headingTops: [], dockStart: 0, dockEnd: 0 };
  const measure = () => {
    const y = scrollY;
    const rect = article.getBoundingClientRect();
    metrics.top = rect.top + y;
    metrics.height = rect.height;
    metrics.headingTops = hasOutline ? headings.map(heading => heading.getBoundingClientRect().top + y) : [];
    metrics.dockStart = body ? body.getBoundingClientRect().top + y : metrics.top;
    metrics.dockEnd = (footer ? footer.getBoundingClientRect().top + y : metrics.top + metrics.height) - innerHeight;
  };

  let activeIndex = null;
  let previousY = scrollY;
  let dockVisible = false;
  let shownMinutes = null;
  let shownProgress = null;

  const render = () => {
    const y = scrollY;
    const progress = updateReadingProgressBar(
      bar,
      { offsetTop: metrics.top, offsetHeight: metrics.height },
      y,
      innerHeight,
      0
    );

    if (hasOutline) {
      const nextIndex = findActiveHeadingIndex(metrics.headingTops, y + innerHeight * 0.3);
      if (nextIndex !== activeIndex) {
        activeIndex = nextIndex;
        for (const links of [outlineLinks, tocLinks, sheetLinks]) markActiveTocLink(links, activeIndex);
        if (dockSection) dockSection.textContent = activeIndex >= 0 ? outlineLinks[activeIndex].textContent : 'Contents';
      }
    }

    if (dock) {
      const roundedProgress = Math.round(progress);
      if (roundedProgress !== shownProgress) {
        shownProgress = roundedProgress;
        dock.style.setProperty('--progress', String(roundedProgress));
      }
      const minutes = minutesLeft(readingTime, progress);
      if (minutes !== shownMinutes && dockLeft) {
        shownMinutes = minutes;
        dockLeft.textContent = minutes > 0 ? `${minutes} min left` : 'Done';
      }
      const visible = Boolean(sheet?.open) || shouldShowReadingDock({
        scrollY: y,
        previousScrollY: previousY,
        start: metrics.dockStart,
        end: metrics.dockEnd,
        visible: dockVisible
      });
      if (visible !== dockVisible) {
        dockVisible = visible;
        dock.dataset.visible = String(visible);
      }
    }
    previousY = y;
  };

  const queueRender = createFrameScheduler(render);
  const queueRemeasure = createFrameScheduler(() => {
    measure();
    render();
  });
  window.addEventListener('scroll', queueRender, { passive: true });
  window.addEventListener('resize', queueRemeasure);
  if (typeof ResizeObserver === 'function') new ResizeObserver(queueRemeasure).observe(article);
  measure();
  render();

  if (!dock || !sheet) return;
  dock.querySelector('button')?.addEventListener('click', () => {
    sheet.showModal();
    sheet.querySelector('[aria-current="location"]')?.scrollIntoView({ block: 'center' });
  });
  sheet.querySelector('.reading-sheet-close')?.addEventListener('click', () => sheet.close());
  sheet.querySelector('.reading-sheet-top')?.addEventListener('click', () => {
    sheet.close();
    scrollTo({ top: 0 });
  });
  sheet.addEventListener('click', event => {
    // Taps on the backdrop land on the dialog itself, above its top edge.
    if (event.target === sheet && event.clientY < sheet.getBoundingClientRect().top) sheet.close();
    // Following a section link closes the sheet; the browser then scrolls to it.
    else if (event.target.closest('a')) sheet.close();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    const toggles = [
      document.getElementById('theme-toggle')
    ].filter(Boolean);
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const stored = readStoredTheme();
    if (stored) root.setAttribute('data-theme', stored);

    const effectiveTheme = () => resolveTheme(root.getAttribute('data-theme'), mediaQuery.matches);

    const updateThemeControl = () => {
      const state = themeControlState(effectiveTheme());
      for (const button of toggles) {
        button.hidden = false;
        button.setAttribute('aria-pressed', state.pressed);
        button.setAttribute('aria-label', state.label);
      }
    };
    updateThemeControl();
    subscribeToMediaChanges(mediaQuery, updateThemeControl);

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

    // Keep the mobile browser chrome the same colour as the page.
    const syncThemeColor = () => {
      const color = getComputedStyle(root).getPropertyValue('--bg').trim();
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = color;
    };
    if (stored) syncThemeColor();

    const applyTheme = theme => {
      root.setAttribute('data-theme', theme);
      writeStoredTheme(theme);
      updateThemeControl();
      syncThemeColor();
    };

    // Where supported, the new theme grows out of the toggle as a circle.
    const switchTheme = async (theme, button) => {
      if (typeof document.startViewTransition !== 'function' || reducedMotion.matches) {
        applyTheme(theme);
        return;
      }
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const radius = themeRevealRadius(x, y, innerWidth, innerHeight);
      root.classList.add('theme-switching');
      const transition = document.startViewTransition(() => applyTheme(theme));
      try {
        await transition.ready;
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 480, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
        await transition.finished;
      } catch (error) {
        // The theme is already applied by the update callback; only the animation was lost.
        console.warn('Theme transition animation skipped:', error);
      } finally {
        root.classList.remove('theme-switching');
      }
    };

    for (const button of toggles) {
      button.addEventListener('click', () => {
        const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
        switchTheme(next, button);
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

    // Active nav link
    const { pathname } = location;
    for (const link of document.querySelectorAll('.site-nav a')) {
      const href = link.getAttribute('href');
      if (isNavActive(pathname, href)) {
        link.classList.add('nav-active');
        link.setAttribute('aria-current', 'page');
      }
    }

    // Reading progress, active section and reading dock
    const bar = document.getElementById('reading-progress');
    const article = document.querySelector('.post');
    if (bar && article) initializeReadingTracker(article, bar);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
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
  };
}
