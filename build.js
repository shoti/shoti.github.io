#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEdition, loadNewsIndex, validateSafeSourceUrl } = require('./lib/news');

const BASE_URL = 'https://shoti.github.io';
const POSTS_DIR = path.join(__dirname, 'content', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const STATIC_DIR = path.join(__dirname, 'static');
const DIST_DIR = path.join(__dirname, 'dist');
const NEWS_DIR = path.join(__dirname, 'news');

const REQUIRED_POST_FIELDS = ['title', 'slug', 'date', 'description', 'body', 'tags'];

// --- Minimal Markdown Parser ---

function parseMarkdown(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Markdown content must be a string');
  }
  return parseMarkdownInner(text, 0, new Map());
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

function uniqueHeadingId(text, headingCounts) {
  const base = 'section-' + slugifyHeading(text);
  const count = (headingCounts.get(base) || 0) + 1;
  headingCounts.set(base, count);
  return count === 1 ? base : base + '-' + count;
}

function isBlockStart(line, depth) {
  const trimmed = line.trim();
  return trimmed.startsWith('```') ||
    /^(#{1,4})\s+(.+)$/.test(line) ||
    (depth < 10 && trimmed.startsWith('> ')) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function parseMarkdownInner(text, depth, headingCounts) {
  const lines = text.split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      if (lang === 'flow') {
        const steps = code.map(step => step.trim()).filter(Boolean);
        html.push(renderFlowDiagram(steps));
        continue;
      }
      const escaped = escapeHtml(code.join('\n'));
      if (lang && /^[a-zA-Z0-9-]+$/.test(lang)) {
        html.push('<pre><code class="language-' + lang + '">' + escaped + '</code></pre>');
      } else {
        html.push('<pre><code>' + escaped + '</code></pre>');
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const id = uniqueHeadingId(headingMatch[2], headingCounts);
      html.push('<h' + level + ' id="' + id + '">' + inline(headingMatch[2]) + '</h' + level + '>');
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html.push('<hr>');
      i++;
      continue;
    }

    // Blockquote (max 10 levels deep to prevent stack overflow)
    if (line.trim().startsWith('> ') && depth < 10) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      html.push('<blockquote>' + parseMarkdownInner(quoteLines.join('\n'), depth + 1, headingCounts) + '</blockquote>');
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^[-*]\s+/, '')));
        i++;
      }
      html.push('<ul>' + items.map(item => '<li>' + item + '</li>').join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^\d+\.\s+/, '')));
        i++;
      }
      html.push('<ol>' + items.map(item => '<li>' + item + '</li>').join('') + '</ol>');
      continue;
    }

    // Image (standalone)
    if (/^!\[/.test(line.trim())) {
      const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        const image = renderImage(imgMatch[1], imgMatch[2]);
        html.push('<p>' + image + '</p>');
        i++;
        continue;
      }
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i], depth)) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      html.push('<p>' + inline(para.join('\n')) + '</p>');
    }
  }

  return html.join('\n');
}

function renderFlowDiagram(steps) {
  if (steps.length === 0) return '';
  const items = steps.map(step => '<li>' + escapeHtml(step) + '</li>').join('');
  return '<ol class="flow-diagram" role="list" aria-label="Process flow">' + items + '</ol>';
}

function inline(text) {
  // Escape HTML first to prevent XSS — markdown syntax chars ([], (), *, `) are unaffected
  text = escapeHtml(text);
  // Images
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => renderEscapedImage(alt, url));
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    const safeUrl = sanitizeUrl(url, true);
    if (!safeUrl) return label;
    const externalAttrs = /^https?:/i.test(safeUrl)
      ? ' target="_blank" rel="noopener noreferrer"'
      : '';
    return '<a href="' + safeUrl + '"' + externalAttrs + '>' + label + '</a>';
  });
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  text = text.replace(/  \n/g, '<br>');
  return text;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url, allowMailto) {
  const trimmed = String(url).trim();
  const normalized = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  const allowedSchemes = allowMailto ? ['http', 'https', 'mailto'] : ['http', 'https'];
  if (scheme && !allowedSchemes.includes(scheme[1])) return null;
  return trimmed;
}

function renderEscapedImage(alt, url) {
  const safeUrl = sanitizeUrl(url, false);
  return safeUrl ? '<img src="' + safeUrl + '" alt="' + alt + '" loading="lazy" decoding="async">' : alt;
}

function renderImage(alt, url) {
  return renderEscapedImage(escapeHtml(alt), sanitizeUrl(url, false) ? escapeHtml(String(url).trim()) : '');
}

// --- Template Engine ---

function findBalancedBlock(str, openTag, closeTag, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < str.length && depth > 0) {
    const nextOpen = str.indexOf(openTag, i);
    const nextClose = str.indexOf(closeTag, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      i = nextClose + closeTag.length;
    }
  }
  return -1;
}

function render(template, data) {
  let result = '';
  let i = 0;

  while (i < template.length) {
    const next = template.indexOf('{{', i);
    if (next === -1) {
      result += template.slice(i);
      break;
    }

    // Append everything before the tag
    result += template.slice(i, next);
    i = next;

    // {{#each key}}
    const eachMatch = template.slice(i).match(/^\{\{#each (\w+)\}\}/);
    if (eachMatch) {
      const key = eachMatch[1];
      const bodyStart = i + eachMatch[0].length;
      const bodyEnd = findBalancedBlock(template, '{{#each ', '{{/each}}', bodyStart);
      if (bodyEnd === -1) {
        throw new Error('Unclosed {{#each ' + key + '}} block');
      }
      const body = template.slice(bodyStart, bodyEnd);
      const arr = data[key];
      if (Array.isArray(arr)) {
        result += arr.map(item => render(body, item)).join('');
      }
      i = bodyEnd + '{{/each}}'.length;
      continue;
    }

    // {{#if key}}
    const ifMatch = template.slice(i).match(/^\{\{#if (\w+)\}\}/);
    if (ifMatch) {
      const key = ifMatch[1];
      const bodyStart = i + ifMatch[0].length;
      const bodyEnd = findBalancedBlock(template, '{{#if ', '{{/if}}', bodyStart);
      if (bodyEnd === -1) {
        throw new Error('Unclosed {{#if ' + key + '}} block');
      }
      const body = template.slice(bodyStart, bodyEnd);
      if (data[key]) {
        result += render(body, data);
      }
      i = bodyEnd + '{{/if}}'.length;
      continue;
    }

    // {{{variable}}} — explicitly trusted HTML
    const rawVarMatch = template.slice(i).match(/^\{\{\{(\w+)\}\}\}/);
    if (rawVarMatch) {
      const key = rawVarMatch[1];
      result += data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
      i += rawVarMatch[0].length;
      continue;
    }

    // {{variable}} — escaped by default
    const varMatch = template.slice(i).match(/^\{\{(\w+)\}\}/);
    if (varMatch) {
      const key = varMatch[1];
      result += data[key] !== undefined && data[key] !== null ? escapeHtml(data[key]) : '';
      i += varMatch[0].length;
      continue;
    }

    // Lone {{ that doesn't match any pattern — emit literally
    result += template[i];
    i++;
  }

  return result;
}

// --- Utility ---

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

function formatGeorgianDate(dateStr) {
  return new Intl.DateTimeFormat('ka-GE', {
    timeZone: 'Asia/Tbilisi',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(dateStr + 'T12:00:00+04:00'));
}

function formatGeorgianTimestamp(timestamp) {
  return new Intl.DateTimeFormat('ka-GE', {
    timeZone: 'Asia/Tbilisi',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(timestamp));
}

function formatCoverage(coverage) {
  return `${formatGeorgianTimestamp(coverage.start)} – ${formatGeorgianTimestamp(coverage.end)}`;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function generateOgImage(title) {
  const fontSize = title.length > 50 ? 52 : title.length > 30 ? 60 : 72;
  const lines = wrapSvgText(title, fontSize, 1000);
  const lineCount = (lines.match(/<tspan/g) || []).length || 1;
  const textBlockHeight = lineCount * fontSize * 1.25;
  const textY = (630 - textBlockHeight) / 2 + fontSize;
  return '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="1200" height="630" fill="#1a1a1a"/>' +
    '<line x1="100" y1="80" x2="1100" y2="80" stroke="#333" stroke-width="1"/>' +
    '<line x1="100" y1="550" x2="1100" y2="550" stroke="#333" stroke-width="1"/>' +
    '<text x="600" y="' + textY + '" fill="#d4d4d4" font-family="Georgia, serif" font-size="' + fontSize + '" text-anchor="middle">' +
    lines +
    '</text>' +
    '<text x="600" y="596" fill="#e07a5f" font-family="Helvetica, Arial, sans-serif" font-size="20" text-anchor="middle">shoti.github.io</text>' +
    '</svg>';
}

function wrapSvgText(text, fontSize, maxWidth) {
  const charPerLine = Math.floor(maxWidth / (fontSize * 0.52));
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > charPerLine && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = current ? current + ' ' + w : w;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.slice(0, 3).map((line, idx) => {
    return '<tspan x="600" dy="' + (idx === 0 ? 0 : fontSize * 1.25) + '">' + escapeHtml(line) + '</tspan>';
  }).join('');
}

function validatePost(post, filename) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) {
    throw new Error('Invalid post ' + filename + ': expected a JSON object');
  }
  const missing = REQUIRED_POST_FIELDS.filter(f => post[f] === undefined || post[f] === null);
  if (missing.length > 0) {
    throw new Error('Invalid post ' + filename + ': missing fields: ' + missing.join(', '));
  }
  for (const field of ['title', 'slug', 'date', 'description', 'body']) {
    if (typeof post[field] !== 'string') {
      throw new Error('Invalid post ' + filename + ': ' + field + ' must be a string');
    }
  }
  if (!post.title.trim()) {
    throw new Error('Invalid post ' + filename + ': title cannot be empty');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    throw new Error('Invalid post ' + filename + ': date must be YYYY-MM-DD, got "' + post.date + '"');
  }
  const parsedDate = new Date(post.date + 'T00:00:00Z');
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== post.date) {
    throw new Error('Invalid post ' + filename + ': date is not a real calendar date: "' + post.date + '"');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) {
    throw new Error('Invalid post ' + filename + ': slug contains invalid characters: "' + post.slug + '"');
  }
  if (path.basename(filename, '.json') !== post.slug) {
    throw new Error('Invalid post ' + filename + ': filename must match slug "' + post.slug + '.json"');
  }
  if (!Array.isArray(post.tags) || post.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    throw new Error('Invalid post ' + filename + ': tags must be an array of non-empty strings');
  }
}

// --- New Post Command ---

function createNewPost(titleParts, postsDir = POSTS_DIR) {
  const title = titleParts.join(' ').trim();
  if (!title) {
    throw new Error('Usage: npm run new "Post Title"');
  }
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) {
    throw new Error('Post title must contain at least one letter or number');
  }
  const date = new Date().toISOString().slice(0, 10);
  const post = {
    title: title,
    slug: slug,
    date: date,
    tags: [],
    draft: true,
    description: '',
    body: ''
  };
  const filePath = path.join(postsDir, slug + '.json');
  if (fs.existsSync(filePath)) {
    throw new Error('Post already exists: ' + filePath);
  }
  fs.mkdirSync(postsDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2) + '\n', 'utf-8');
  console.log('Created: ' + filePath);
}

if (require.main === module && process.argv[2] === 'new') {
  try {
    createNewPost(process.argv.slice(3));
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

// --- Build ---

const startTime = Date.now();

// Load templates
const baseTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'base.html'), 'utf-8');
const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf-8');
const postTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf-8');
const archiveTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'archive.html'), 'utf-8');
const aboutTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'about.html'), 'utf-8');
const notFoundTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, '404.html'), 'utf-8');
const newsTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'news.html'), 'utf-8');
const newsEmptyTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'news-empty.html'), 'utf-8');
const newsArchiveTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'news-archive.html'), 'utf-8');

// Load and validate posts
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error('Could not parse ' + label + ': ' + error.message);
  }
}

function loadPosts(postsDir = POSTS_DIR) {
  const postFiles = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
  return postFiles.map(filename => {
    const post = readJson(path.join(postsDir, filename), 'post ' + filename);
    if (!post || typeof post !== 'object' || Array.isArray(post)) {
      throw new Error('Invalid post ' + filename + ': expected a JSON object');
    }
    if (post.draft !== undefined && typeof post.draft !== 'boolean') {
      throw new Error('Invalid post ' + filename + ': draft must be a boolean');
    }
    if (post.draft !== true) validatePost(post, filename);
    return post;
  }).filter(post => post.draft !== true)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function loadAbout(filePath = path.join(__dirname, 'content', 'about.json')) {
  const about = readJson(filePath, 'about content');
  if (!about || typeof about !== 'object' || Array.isArray(about) ||
      typeof about.heading !== 'string' || typeof about.body !== 'string') {
    throw new Error('Invalid ' + path.basename(filePath) + ': heading and body must be strings');
  }
  return about;
}

const posts = loadPosts();

// Parse markdown once per post and cache the HTML
for (const post of posts) {
  post._html = parseMarkdown(post.body);
  post._words = wordCount(post.body);
}

// Clean dist
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// Copy static files
copyDir(STATIC_DIR, DIST_DIR);

// --- Generate Pages ---

function wrapInBase(content, data) {
  return render(baseTemplate, Object.assign({
    content: content,
    lang: 'en',
    ogLocale: 'en_US',
    bodyClass: '',
    skipLabel: 'Skip to content',
    primaryNavLabel: 'Primary',
    blogLabel: 'Blog',
    newsLabel: 'News',
    archiveLabel: 'Archive',
    aboutLabel: 'About',
    themeLabel: 'Switch to dark mode',
    sourceLabel: 'Source',
    showSiteHeader: true,
    newsChrome: false
  }, data));
}

const NEWS_CATEGORY_LABELS = {
  'georgia-politics': 'საქართველო',
  georgia: 'საქართველო',
  'world-politics': 'მსოფლიო',
  world: 'მსოფლიო',
  science: 'მეცნიერება',
  technology: 'ტექნოლოგიები',
  ai: 'ხელოვნური ინტელექტი',
  economy: 'ეკონომიკა',
  business: 'ბიზნესი',
  health: 'ჯანმრთელობა',
  climate: 'გარემო და კლიმატი',
  culture: 'კულტურა',
  society: 'საზოგადოება',
  security: 'უსაფრთხოება',
  other: 'მნიშვნელოვანი ამბავი'
};

const NEWS_CLAIM_LABELS = {
  summary: 'მთავარი ფაქტები',
  why_it_matters: 'მნიშვნელობა',
  uncertainty: 'დასაზუსტებელი ნაწილი'
};

function newsCategoryLabel(category) {
  return NEWS_CATEGORY_LABELS[category] || NEWS_CATEGORY_LABELS.other;
}

function renderNewsSources(story) {
  return story.sources.map(source => {
    const safeUrl = validateSafeSourceUrl(source.url, `source ${source.id}`);
    const published = source.published_at
      ? ` · <time datetime="${escapeHtml(source.published_at)}">${escapeHtml(formatGeorgianTimestamp(source.published_at))}</time>`
      : '';
    const support = source.supports.map(item => NEWS_CLAIM_LABELS[item]).join(', ');
    return '<li>' +
      '<a href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="news-source-publisher">' + escapeHtml(source.publisher) + '</span>' +
      '<span class="news-source-title">' + escapeHtml(source.title) + '</span>' +
      '</a>' + published +
      '<span class="news-source-support">წყაროში ნახავთ: ' + escapeHtml(support) + '</span>' +
      '</li>';
  }).join('');
}

function renderNewsNavigation(briefing) {
  return briefing.stories.map(story =>
    '<li><a href="#' + escapeHtml(story.id) + '">' +
    '<span class="news-contents-number">[' + story.importance + ']</span>' +
    '<span><strong>' + escapeHtml(story.headline) + '</strong>' +
    '<small>' + escapeHtml(newsCategoryLabel(story.category)) + '</small></span>' +
    '</a></li>'
  ).join('');
}

function renderNewsStoryNav(briefing, index) {
  const prevStory = index > 0 ? briefing.stories[index - 1] : null;
  const nextStory = index < briefing.stories.length - 1 ? briefing.stories[index + 1] : null;
  const prevLink = prevStory
    ? '<a class="news-story-nav-prev" href="#' + escapeHtml(prevStory.id) + '" title="' + escapeHtml(prevStory.headline) +
      '">[<span aria-hidden="true">←</span> წინა ამბავი]</a>'
    : '<span class="news-story-nav-spacer" aria-hidden="true"></span>';
  const nextLink = nextStory
    ? '<a class="news-story-nav-next" href="#' + escapeHtml(nextStory.id) + '" title="' + escapeHtml(nextStory.headline) +
      '">[შემდეგი ამბავი <span aria-hidden="true">→</span>]</a>'
    : '<span class="news-story-nav-spacer" aria-hidden="true"></span>';
  return '<nav class="news-story-nav" aria-label="ამბებს შორის ნავიგაცია">' + prevLink +
    '<a class="news-story-nav-contents" href="#news-contents-title">[სარჩევი]</a>' + nextLink + '</nav>';
}

function renderNewsStories(briefing) {
  return briefing.stories.map((story, index) => {
    const eventTime = story.event_at
      ? '<p class="news-event-time">მოვლენის დრო: <time datetime="' + escapeHtml(story.event_at) + '">' +
        escapeHtml(formatGeorgianTimestamp(story.event_at)) + '</time></p>'
      : '';
    const uncertainty = story.uncertainty
      ? '<div class="news-uncertainty"><h3>&gt; რა რჩება დასაზუსტებელი</h3><p>' + escapeHtml(story.uncertainty) + '</p></div>'
      : '';
    return '<article class="news-story" id="' + escapeHtml(story.id) + '">' +
      '<header><div class="news-story-label"><span>[' + story.importance + ']</span>' +
      escapeHtml(newsCategoryLabel(story.category)) + '</div>' +
      '<h2>' + escapeHtml(story.headline) + '</h2>' + eventTime + '</header>' +
      '<div class="news-story-copy"><p>' + escapeHtml(story.summary) + '</p>' +
      '<div class="news-why"><h3>&gt; რატომ უნდა მიაქციოთ ყურადღება</h3><p>' + escapeHtml(story.why_it_matters) + '</p></div>' +
      uncertainty + '</div>' +
      '<div class="news-sources"><h3>&gt; წყაროები</h3><ol>' + renderNewsSources(story) + '</ol></div>' +
      renderNewsStoryNav(briefing, index) +
      '</article>';
  }).join('');
}

function newsWordCount(briefing) {
  const text = [
    briefing.introduction,
    ...briefing.takeaways,
    briefing.coverage_note || '',
    ...briefing.stories.flatMap(story => [story.headline, story.summary, story.why_it_matters, story.uncertainty || ''])
  ].join(' ');
  return wordCount(text);
}

function validateNewsIndexRecords(newsIndex) {
  const editions = newsIndex.editions.map(edition => {
    if (!edition || typeof edition !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(edition.edition_date) ||
        typeof edition.briefing_id !== 'string' || !Number.isSafeInteger(edition.latest_revision) ||
        !Array.isArray(edition.revisions) || edition.revisions.length < 1) {
      throw new Error(`Invalid news index entry for ${edition?.edition_date || 'unknown edition'}`);
    }
    const revisions = edition.revisions.map(record => {
      const briefing = loadEdition(__dirname, record.path);
      if (briefing.edition_date !== edition.edition_date || briefing.briefing_id !== edition.briefing_id ||
          briefing.revision !== record.revision || briefing.generated_at !== record.generated_at) {
        throw new Error(`News index metadata does not match news/${record.path}`);
      }
      return { ...record, briefing };
    }).sort((a, b) => a.revision - b.revision);
    if (!revisions.some(record => record.revision === edition.latest_revision)) {
      throw new Error(`News index latest revision is missing for ${edition.edition_date}`);
    }
    return { ...edition, revisions };
  }).sort((a, b) => b.edition_date.localeCompare(a.edition_date));

  if (editions.length === 0) {
    if (newsIndex.latest !== null) throw new Error('News index latest must be null when the archive is empty');
    return editions;
  }
  const newest = editions[0];
  if (!newsIndex.latest || newsIndex.latest.edition_date !== newest.edition_date ||
      newsIndex.latest.revision !== newest.latest_revision) {
    throw new Error('News index latest pointer does not match the newest valid edition');
  }
  return editions;
}

function renderNewsOrientationBanner(kind, context) {
  if (kind === 'archived') {
    return '<p class="news-orientation-banner">! ეს <strong>' + escapeHtml(context.dateFormatted) +
      '</strong> გამოშვებაა. <a href="/news/">დღევანდელი გამოშვების ნახვა →</a></p>';
  }
  if (kind === 'revision') {
    return '<p class="news-orientation-banner">! თქვენ ათვალიერებთ <strong>' + escapeHtml(context.dateFormatted) +
      '</strong> გამოშვების რედაქცია ' + context.revision + '-ს (სულ ' + context.revisionCount + '). ' +
      '<a href="/news/' + escapeHtml(context.editionDate) + '/">მიმდინარე რედაქციის ნახვა →</a></p>';
  }
  return '';
}

function renderNewsBriefingPage(briefing, edition, options = {}) {
  const revisionHistory = edition.revisions.length > 1;
  const revisionHistoryHtml = edition.revisions.map(record => {
    const current = record.revision === briefing.revision ? ' aria-current="page"' : '';
    return '<li><a href="/news/' + edition.edition_date + '/revisions/' + record.revision + '/"' + current +
      '>რედაქცია ' + record.revision + '</a> · <time datetime="' + escapeHtml(record.generated_at) + '">' +
      escapeHtml(formatGeorgianTimestamp(record.generated_at)) + '</time></li>';
  }).join('');
  const editionJsonUrl = `/news/data/${briefing.edition_date}/r${briefing.revision}.json`;
  const orientationBannerHtml = options.orientationBanner
    ? renderNewsOrientationBanner(options.orientationBanner, {
      dateFormatted: formatGeorgianDate(briefing.edition_date),
      editionDate: briefing.edition_date,
      revision: briefing.revision,
      revisionCount: edition.revisions.length
    })
    : '';
  return render(newsTemplate, {
    editionHeading: formatGeorgianDate(briefing.edition_date),
    editionDate: briefing.edition_date,
    editionNumber: options.editionNumber,
    coverageFormatted: `პერიოდი: ${formatCoverage(briefing.coverage)}`,
    generatedFormatted: formatGeorgianTimestamp(briefing.generated_at),
    readingTime: Math.max(1, Math.round(newsWordCount(briefing) / 180)),
    isLatest: Boolean(options.isLatest),
    hasOrientationBanner: Boolean(orientationBannerHtml),
    orientationBannerHtml,
    introduction: briefing.introduction,
    takeawaysHtml: briefing.takeaways.map(item => '<li>' + escapeHtml(item) + '</li>').join(''),
    storiesNavHtml: renderNewsNavigation(briefing),
    storyCount: briefing.stories.length,
    storiesHtml: renderNewsStories(briefing),
    coverageNote: briefing.coverage_note,
    editionJsonUrl,
    revisionHistory,
    revisionCount: edition.revisions.length,
    revisionHistoryHtml,
    hasStoryRail: briefing.stories.length > 1,
    railStories: briefing.stories.map(story => ({
      id: story.id,
      importance: story.importance,
      headline: story.headline
    }))
  });
}

function newsBaseData(briefing, canonical, options = {}) {
  const description = briefing
    ? briefing.introduction
    : 'დღის მთავარი ამბები ქართულად — მოკლედ, გასაგებად და პირდაპირი წყაროებით.';
  return {
    title: briefing ? `${formatGeorgianDate(briefing.edition_date)} — დღის მთავარი ამბები` : 'დღის მთავარი ამბები',
    ogTitle: briefing ? `${formatGeorgianDate(briefing.edition_date)} — დღის ამბები` : 'დღის მთავარი ამბები',
    description,
    canonical,
    ogType: briefing ? 'article' : 'website',
    ogImage: `${BASE_URL}/images/news-social.jpg`,
    ogImageType: 'image/jpeg',
    ogImageAlt: 'თბილისის საღამოს პანორამა, სამუშაო მაგიდაზე გაშლილი გაზეთი და თბილი სანათი',
    ogImageWidth: 1200,
    ogImageHeight: 630,
    head: options.head || '',
    readingProgress: Boolean(briefing),
    lang: 'ka',
    ogLocale: 'ka_GE',
    bodyClass: 'news-page',
    showSiteHeader: false,
    newsChrome: true,
    skipLabel: 'შემცველობაზე გადასვლა'
  };
}

// Homepage
const homePosts = posts.slice(0, 10).map(p => ({
  title: p.title,
  slug: p.slug,
  date: p.date,
  dateFormatted: formatDate(p.date),
  description: p.description
}));
const indexContent = render(indexTemplate, { posts: homePosts });
const homeOgSvg = generateOgImage('Shota Mtvarelishvili');
writeFile(path.join(DIST_DIR, 'og-home.svg'), homeOgSvg);
const indexPage = wrapInBase(indexContent, {
  title: 'Shota Mtvarelishvili',
  ogTitle: 'Shota Mtvarelishvili',
  description: 'Senior Software Engineer writing about code and things.',
  canonical: BASE_URL + '/',
  ogType: 'website',
  ogImage: BASE_URL + '/og-home.svg',
  head: '',
  readingProgress: false
});
writeFile(path.join(DIST_DIR, 'index.html'), indexPage);

// Post pages
posts.forEach((post, idx) => {
  const tags = post.tags.map(t => '#' + t).join(' ');

  const prevPost = idx < posts.length - 1 ? posts[idx + 1] : null;
  const nextPost = idx > 0 ? posts[idx - 1] : null;

  const postContent = render(postTemplate, {
    postTitle: post.title,
    date: post.date,
    dateFormatted: formatDate(post.date),
    readingTime: Math.max(1, Math.round(post._words / 200)),
    tags: tags,
    body: post._html,
    prevPost: prevPost ? true : false,
    prevSlug: prevPost ? prevPost.slug : '',
    prevTitle: prevPost ? prevPost.title : '',
    nextPost: nextPost ? true : false,
    nextSlug: nextPost ? nextPost.slug : '',
    nextTitle: nextPost ? nextPost.title : ''
  });

  // Structured data for blog post
  const structuredData = serializeJsonForHtml({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: {
      '@type': 'Person',
      name: 'Shota Mtvarelishvili',
      url: BASE_URL
    },
    url: BASE_URL + '/posts/' + post.slug + '/'
  });

  const headExtra = '<script type="application/ld+json">' + structuredData + '</script>';

  const ogSvg = generateOgImage(post.title);
  writeFile(path.join(DIST_DIR, 'posts', post.slug, 'og.svg'), ogSvg);

  const page = wrapInBase(postContent, {
    title: post.title + ' \u2014 Shota Mtvarelishvili',
    ogTitle: post.title,
    description: post.description,
    canonical: BASE_URL + '/posts/' + post.slug + '/',
    ogType: 'article',
    ogImage: BASE_URL + '/posts/' + post.slug + '/og.svg',
    head: headExtra,
    readingProgress: true
  });
  writeFile(path.join(DIST_DIR, 'posts', post.slug, 'index.html'), page);
});

// Archive page
const yearMap = {};
posts.forEach(p => {
  const year = p.date.slice(0, 4);
  if (!yearMap[year]) yearMap[year] = [];
  yearMap[year].push({
    title: p.title,
    slug: p.slug,
    date: p.date,
    dateFormatted: formatDate(p.date)
  });
});
const years = Object.keys(yearMap).sort().reverse().map(y => ({
  year: y, posts: yearMap[y]
}));
const archiveContent = render(archiveTemplate, { years: years });
const archivePage = wrapInBase(archiveContent, {
  title: 'Archive \u2014 Shota Mtvarelishvili',
  ogTitle: 'Archive',
  description: 'All posts on shoti.github.io.',
  canonical: BASE_URL + '/archive/',
  ogType: 'website',
  head: '',
  readingProgress: false
});
writeFile(path.join(DIST_DIR, 'archive', 'index.html'), archivePage);

// About page
const aboutData = loadAbout();
const aboutBody = parseMarkdown(aboutData.body);
const aboutContent = render(aboutTemplate, {
  heading: aboutData.heading,
  body: aboutBody
});
const personSchema = serializeJsonForHtml({
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Shota Mtvarelishvili',
  jobTitle: 'Senior Software Engineer',
  url: BASE_URL,
  email: 'mtvarelishvili@proton.me',
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Tbilisi',
    addressCountry: 'GE'
  }
});
const aboutHead = '<script type="application/ld+json">' + personSchema + '</script>';
const aboutPage = wrapInBase(aboutContent, {
  title: 'About \u2014 Shota Mtvarelishvili',
  ogTitle: 'About',
  description: 'About Shota Mtvarelishvili — Senior Software Engineer based in Tbilisi, Georgia.',
  canonical: BASE_URL + '/about/',
  ogType: 'website',
  head: aboutHead,
  readingProgress: false
});
writeFile(path.join(DIST_DIR, 'about', 'index.html'), aboutPage);

// Daily news briefing and archive
const newsIndex = loadNewsIndex(__dirname);
const newsEditions = validateNewsIndexRecords(newsIndex);
writeFile(path.join(DIST_DIR, 'news', 'schema', 'briefing-1.0.json'),
  fs.readFileSync(path.join(NEWS_DIR, 'schema', 'briefing.schema.json'), 'utf8'));
writeFile(path.join(DIST_DIR, 'news', 'feed.json'), serializeJsonForHtml(newsIndex) + '\n');

for (const [editionIndex, edition] of newsEditions.entries()) {
  const editionNumber = newsEditions.length - editionIndex;
  const isLatestEdition = newsIndex.latest.edition_date === edition.edition_date;

  for (const record of edition.revisions) {
    writeFile(
      path.join(DIST_DIR, 'news', 'data', edition.edition_date, `r${record.revision}.json`),
      JSON.stringify(record.briefing, null, 2) + '\n'
    );
    const revisionContent = renderNewsBriefingPage(record.briefing, edition, {
      isLatest: false,
      editionNumber,
      orientationBanner: 'revision'
    });
    const revisionPage = wrapInBase(revisionContent, newsBaseData(
      record.briefing,
      `${BASE_URL}/news/${edition.edition_date}/revisions/${record.revision}/`
    ));
    writeFile(
      path.join(DIST_DIR, 'news', edition.edition_date, 'revisions', String(record.revision), 'index.html'),
      revisionPage
    );
  }

  const latestRevision = edition.revisions.find(record => record.revision === edition.latest_revision);
  const datedContent = renderNewsBriefingPage(latestRevision.briefing, edition, {
    isLatest: isLatestEdition,
    editionNumber,
    orientationBanner: isLatestEdition ? null : 'archived'
  });
  const newsArticleSchema = serializeJsonForHtml({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: `${formatGeorgianDate(edition.edition_date)} — დღის მთავარი ამბები`,
    datePublished: latestRevision.briefing.generated_at,
    dateModified: latestRevision.briefing.generated_at,
    inLanguage: 'ka',
    url: `${BASE_URL}/news/${edition.edition_date}/`,
    isAccessibleForFree: true
  });
  const datedPage = wrapInBase(datedContent, newsBaseData(
    latestRevision.briefing,
    `${BASE_URL}/news/${edition.edition_date}/`,
    { head: `<script type="application/ld+json">${newsArticleSchema}</script>` }
  ));
  writeFile(path.join(DIST_DIR, 'news', edition.edition_date, 'index.html'), datedPage);
}

let latestNewsPage;
if (newsEditions.length) {
  const latestEdition = newsEditions[0];
  const latestRevision = latestEdition.revisions.find(record => record.revision === latestEdition.latest_revision);
  const latestContent = renderNewsBriefingPage(latestRevision.briefing, latestEdition, {
    isLatest: true,
    editionNumber: newsEditions.length,
    orientationBanner: null
  });
  latestNewsPage = wrapInBase(latestContent, newsBaseData(latestRevision.briefing, `${BASE_URL}/news/`));
} else {
  latestNewsPage = wrapInBase(newsEmptyTemplate, newsBaseData(null, `${BASE_URL}/news/`));
}
writeFile(path.join(DIST_DIR, 'news', 'index.html'), latestNewsPage);

const newsArchiveItems = newsEditions.map((edition, index) => {
  const latestRevision = edition.revisions.find(record => record.revision === edition.latest_revision);
  const revisionLabel = edition.latest_revision > 1 ? ` · რედაქცია ${edition.latest_revision}` : '';
  const editionNumber = newsEditions.length - index;
  const currentLabel = newsIndex.latest.edition_date === edition.edition_date ? ' · დღევანდელი' : '';
  return '<li><a href="/news/' + edition.edition_date + '/">' +
    '<span class="news-archive-number">#' + editionNumber + '</span>' +
    '<time datetime="' + edition.edition_date + '">' +
    escapeHtml(formatGeorgianDate(edition.edition_date)) + '</time>' +
    '<span class="news-archive-intro">' + escapeHtml(latestRevision.briefing.introduction) + '</span><small>' +
    latestRevision.briefing.stories.length + ' ამბავი · დაახლოებით ' +
    Math.max(1, Math.round(newsWordCount(latestRevision.briefing) / 180)) + ' წუთი' + revisionLabel + currentLabel +
    '</small></a></li>';
}).join('');
const newsArchiveContent = render(newsArchiveTemplate, {
  hasEditions: newsEditions.length > 0,
  isEmpty: newsEditions.length === 0,
  editionsHtml: newsArchiveItems
});
const newsArchivePage = wrapInBase(newsArchiveContent, newsBaseData(null, `${BASE_URL}/news/archive/`));
writeFile(path.join(DIST_DIR, 'news', 'archive', 'index.html'), newsArchivePage);

// 404 page
const notFoundContent = render(notFoundTemplate, { posts: homePosts.slice(0, 5) });
const notFoundPage = wrapInBase(notFoundContent, {
  title: '404 \u2014 Shota Mtvarelishvili',
  ogTitle: '404',
  description: 'Page not found.',
  canonical: BASE_URL + '/404.html',
  ogType: 'website',
  head: '',
  readingProgress: false
});
writeFile(path.join(DIST_DIR, '404.html'), notFoundPage);

// --- RSS Feed ---

const rssItems = posts.slice(0, 20).map(p => {
  return '    <item>\n' +
    '      <title>' + escapeXml(p.title) + '</title>\n' +
    '      <link>' + BASE_URL + '/posts/' + p.slug + '/</link>\n' +
    '      <guid>' + BASE_URL + '/posts/' + p.slug + '/</guid>\n' +
    '      <pubDate>' + new Date(p.date + 'T00:00:00Z').toUTCString() + '</pubDate>\n' +
    '      <description>' + escapeXml(p.description) + '</description>\n' +
    '      <content:encoded><![CDATA[' + p._html + ']]></content:encoded>\n' +
    '      <author>mtvarelishvili@proton.me (Shota Mtvarelishvili)</author>\n' +
    '    </item>';
}).join('\n');

const rss = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
  '  <channel>\n' +
  '    <title>Shota Mtvarelishvili</title>\n' +
  '    <link>' + BASE_URL + '</link>\n' +
  '    <description>Senior Software Engineer writing about code and things.</description>\n' +
  '    <language>en</language>\n' +
  '    <managingEditor>mtvarelishvili@proton.me (Shota Mtvarelishvili)</managingEditor>\n' +
  '    <atom:link href="' + BASE_URL + '/rss.xml" rel="self" type="application/rss+xml"/>\n' +
  (posts.length > 0 ? '    <lastBuildDate>' + new Date(posts[0].date + 'T00:00:00Z').toUTCString() + '</lastBuildDate>\n' : '') +
  rssItems + '\n' +
  '  </channel>\n' +
  '</rss>\n';

writeFile(path.join(DIST_DIR, 'rss.xml'), rss);

// --- Sitemap ---

const sitemapEntries = [
  { url: BASE_URL + '/', date: posts.length > 0 ? posts[0].date : null },
  { url: BASE_URL + '/archive/', date: posts.length > 0 ? posts[0].date : null },
  { url: BASE_URL + '/about/', date: null },
  { url: BASE_URL + '/news/', date: newsIndex.latest ? newsIndex.latest.edition_date : null },
  { url: BASE_URL + '/news/archive/', date: newsIndex.latest ? newsIndex.latest.edition_date : null }
].concat(posts.map(p => ({ url: BASE_URL + '/posts/' + p.slug + '/', date: p.date })))
  .concat(newsEditions.map(edition => ({
    url: BASE_URL + '/news/' + edition.edition_date + '/',
    date: edition.edition_date
  })));

const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapEntries.map(entry => {
    let xml = '  <url>\n    <loc>' + entry.url + '</loc>';
    if (entry.date) xml += '\n    <lastmod>' + entry.date + '</lastmod>';
    xml += '\n  </url>';
    return xml;
  }).join('\n') + '\n' +
  '</urlset>\n';

writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemap);

// --- robots.txt ---

writeFile(path.join(DIST_DIR, 'robots.txt'),
  'User-agent: *\nAllow: /\n\nSitemap: ' + BASE_URL + '/sitemap.xml\n');

// --- Done ---

const elapsed = Date.now() - startTime;
console.log('Build complete: ' + posts.length + ' posts in ' + elapsed + 'ms');

function serializeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
  })[character]);
}

module.exports = {
  createNewPost,
  generateOgImage,
  loadAbout,
  loadPosts,
  parseMarkdown,
  render,
  renderNewsOrientationBanner,
  serializeJsonForHtml,
  validatePost
};
