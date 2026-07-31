'use strict';

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

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const stored = readStoredTheme();
    if (stored) root.setAttribute('data-theme', stored);

    const effectiveTheme = () => resolveTheme(root.getAttribute('data-theme'), mediaQuery.matches);

    const updateThemeControl = () => {
      if (!toggle) return;
      const state = themeControlState(effectiveTheme());
      toggle.setAttribute('aria-pressed', state.pressed);
      toggle.setAttribute('aria-label', state.label);
    };
    updateThemeControl();
    subscribeToMediaChanges(mediaQuery, updateThemeControl);

    // Enable theme transitions after initial paint to prevent flash
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('transitions-ready');
    }));

    toggle?.addEventListener('click', () => {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      writeStoredTheme(next);
      updateThemeControl();
      const rotation = parseInt(toggle.dataset.r || '0', 10) + 180;
      toggle.dataset.r = rotation;
      toggle.style.transform = `rotate(${rotation}deg)`;
    });

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
      const article = document.querySelector('.post');
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
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    calculateReadingProgress,
    createFrameScheduler,
    isNavActive,
    readStoredTheme,
    resolveTheme,
    subscribeToMediaChanges,
    themeControlState,
    updateReadingProgressBar,
    writeStoredTheme
  };
}
