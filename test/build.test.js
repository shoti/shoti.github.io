'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createNewPost,
  generateOgImage,
  loadAbout,
  loadPosts,
  parseMarkdown,
  parseMarkdownDocument,
  render,
  renderTableOfContents,
  tableOfContentsEntries,
  serializeJsonForHtml,
  validatePost
} = require('../build');

const flow = parseMarkdown('```flow\nFirst step\nSecond <unsafe> step\n```');
assert.match(flow, /<ol class="flow-diagram" role="list" aria-label="Process flow">/);
assert.match(flow, /<li>First step<\/li>/);
assert.match(flow, /<li>Second &lt;unsafe&gt; step<\/li>/);
assert.doesNotMatch(flow, /<pre>/);
assert.doesNotMatch(flow, /<unsafe>/);
assert.strictEqual(parseMarkdown('```flow\n\n```'), '');

// Regression: non-heading hash-prefixed text previously caused an infinite loop.
assert.strictEqual(parseMarkdown('#hashtag'), '<p>#hashtag</p>');
assert.strictEqual(
  parseMarkdown('## Why this matters\n\n## Why this matters'),
  '<h2 id="section-why-this-matters">Why this matters</h2>\n<h2 id="section-why-this-matters-2">Why this matters</h2>'
);
assert.match(parseMarkdown('## Main Content'), /^<h2 id="section-main-content">/);
assert.strictEqual(
  parseMarkdown('## ანგარიშების დაცვა\n\n## ანგარიშების დაცვა'),
  '<h2 id="section-ანგარიშების-დაცვა">ანგარიშების დაცვა</h2>\n<h2 id="section-ანგარიშების-დაცვა-2">ანგარიშების დაცვა</h2>'
);

// The table of contents is built at build time from h2/h3 headings only.
const outlined = parseMarkdownDocument('## First `step`\n\n### Detail\n\n#### Too deep\n\n## ანგარიშების დაცვა\n\n## First `step`');
assert.deepStrictEqual(outlined.headings.map(heading => [heading.level, heading.id, heading.title]), [
  [2, 'section-first-step', 'First step'],
  [3, 'section-detail', 'Detail'],
  [4, 'section-too-deep', 'Too deep'],
  [2, 'section-ანგარიშების-დაცვა', 'ანგარიშების დაცვა'],
  [2, 'section-first-step-2', 'First step']
]);
const outlineEntries = tableOfContentsEntries(outlined.headings);
assert.strictEqual(outlineEntries.length, 4);
assert.strictEqual(
  renderTableOfContents(outlineEntries.slice(0, 2)),
  '<li class="toc-level-2"><a href="#section-first-step">First step</a></li>' +
  '<li class="toc-level-3"><a href="#section-detail">Detail</a></li>'
);
assert.deepStrictEqual(tableOfContentsEntries(parseMarkdownDocument('## One\n\n## Two').headings), []);
assert.strictEqual(
  parseMarkdownDocument('## <img src=x onerror=alert(1)>\n\n## b\n\n## c').headings[0].title,
  '&lt;img src=x onerror=alert(1)&gt;'
);

// Excessive blockquote nesting must degrade to text instead of hanging.
const deeplyNestedQuote = `${'> '.repeat(11)}still finite`;
assert.match(parseMarkdown(deeplyNestedQuote), /still finite/);

// Raw HTML and executable Markdown URLs are never emitted.
assert.strictEqual(parseMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
assert.strictEqual(parseMarkdown('[unsafe](javascript:alert(1))'), '<p>unsafe)</p>');
assert.strictEqual(parseMarkdown('![unsafe](data:text/html,bad)'), '<p>unsafe</p>');
assert.strictEqual(
  parseMarkdown('[external](https://example.com)'),
  '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">external</a></p>'
);
assert.strictEqual(parseMarkdown('[internal](/about/)'), '<p><a href="/about/">internal</a></p>');
assert.strictEqual(
  parseMarkdown('[email](mailto:me@example.com)'),
  '<p><a href="mailto:me@example.com">email</a></p>'
);

// Template values are escaped unless the template explicitly opts into trusted HTML.
assert.strictEqual(render('<h1>{{title}}</h1>', { title: '<unsafe>' }), '<h1>&lt;unsafe&gt;</h1>');
assert.strictEqual(render('<main>{{{content}}}</main>', { content: '<p>trusted</p>' }), '<main><p>trusted</p></main>');
assert.throws(() => render('{{#if enabled}}broken', { enabled: true }), /Unclosed/);

const validPost = {
  title: 'A valid post',
  slug: 'a-valid-post',
  date: '2026-07-30',
  description: 'Description',
  body: 'Body',
  tags: ['testing']
};
assert.doesNotThrow(() => validatePost(validPost, 'a-valid-post.json'));
assert.doesNotThrow(() => validatePost({ ...validPost, lang: 'ka' }, 'a-valid-post.json'));
assert.throws(() => validatePost({ ...validPost, lang: 'invalid' }, 'a-valid-post.json'), /lang must be en or ka/);
assert.throws(() => validatePost(null, 'a-valid-post.json'), /expected a JSON object/);
assert.throws(
  () => validatePost({ ...validPost, title: undefined }, 'a-valid-post.json'),
  /missing fields: title/
);
assert.throws(
  () => validatePost({ ...validPost, title: 123 }, 'a-valid-post.json'),
  /title must be a string/
);
assert.throws(
  () => validatePost({ ...validPost, title: '   ' }, 'a-valid-post.json'),
  /title cannot be empty/
);
assert.throws(
  () => validatePost({ ...validPost, date: '2026-02-30' }, 'a-valid-post.json'),
  /not a real calendar date/
);
assert.throws(
  () => validatePost({ ...validPost, tags: 'testing' }, 'a-valid-post.json'),
  /tags must be an array/
);
assert.throws(
  () => validatePost(validPost, 'wrong-filename.json'),
  /filename must match slug/
);

const jsonForHtml = serializeJsonForHtml({ title: '</script><script>alert(1)</script>' });
assert.doesNotMatch(jsonForHtml, /<\/script>/);
assert.match(jsonForHtml, /\\u003c/);

const ogImage = generateOgImage('A title with <unsafe> & special characters');
assert.doesNotMatch(ogImage, /<unsafe>/);
assert.match(ogImage, /&lt;unsafe&gt; &amp; special/);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-build-test-'));
try {
  const postsDir = path.join(fixtureRoot, 'posts');
  createNewPost(['Isolated', 'Test', 'Post'], postsDir);
  const createdPost = path.join(postsDir, 'isolated-test-post.json');
  assert.ok(fs.existsSync(createdPost));
  assert.throws(() => createNewPost(['Isolated', 'Test', 'Post'], postsDir), /Post already exists/);

  fs.writeFileSync(path.join(postsDir, 'malformed.json'), '{not json', 'utf8');
  assert.throws(() => loadPosts(postsDir), /Could not parse post malformed\.json/);
  fs.rmSync(path.join(postsDir, 'malformed.json'));

  fs.writeFileSync(path.join(postsDir, 'not-an-object.json'), 'null', 'utf8');
  assert.throws(() => loadPosts(postsDir), /expected a JSON object/);

  const aboutFile = path.join(fixtureRoot, 'about.json');
  fs.writeFileSync(aboutFile, JSON.stringify({ heading: 'Missing body' }), 'utf8');
  assert.throws(() => loadAbout(aboutFile), /heading and body must be strings/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

// Requiring the build script performs the end-to-end build. Inspecting its output
// catches template integration and generated-output regressions.
const distDir = path.join(__dirname, '..', 'dist');
const home = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const post = fs.readFileSync(
  path.join(distDir, 'posts', 'break-it-to-make-it', 'index.html'),
  'utf8'
);
const notFound = fs.readFileSync(path.join(distDir, '404.html'), 'utf8');
const themeBootstrapIndex = home.indexOf("localStorage.getItem('theme')");
const readerBootstrapIndex = home.indexOf("localStorage.getItem('reader-' + setting)");
// Asset URLs carry a content hash so new HTML is never paired with a cached old stylesheet.
const crypto = require('crypto');
const assetHash = file => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(__dirname, '..', 'static', file))).digest('hex').slice(0, 10);
const stylesheetTag = '<link rel="stylesheet" href="/css/style.css?v=' + assetHash('css/style.css') + '">';
for (const page of [home, post, notFound]) {
  assert.ok(page.includes(stylesheetTag), 'Pages must link the content-hashed stylesheet');
  assert.ok(page.includes('<script src="/js/main.js?v=' + assetHash('js/main.js') + '"></script>'),
    'Pages must load the content-hashed script');
}
const stylesheetIndex = home.indexOf(stylesheetTag);
assert.ok(themeBootstrapIndex !== -1 && themeBootstrapIndex < stylesheetIndex,
  'Stored theme must be applied before the stylesheet to prevent a theme flash');
assert.ok(readerBootstrapIndex !== -1 && readerBootstrapIndex < stylesheetIndex,
  'Stored reader preferences must be applied before the stylesheet to prevent a typography flash');
assert.match(home, /<a lang="en" class="skip-link" href="#main-content">Skip to content<\/a>/);
assert.doesNotMatch(home, /<meta property="og:image:(?:type|width|height|alt)" content="">/);
assert.match(home, /<main id="main-content">\s*<h1 class="intro">/);
assert.doesNotMatch(home, /&lt;h1 class=&quot;intro&quot;/);
assert.match(post, /<span class="reading-time">\d+ min read<\/span>/);
assert.doesNotMatch(post, /<meta property="og:image:(?:type|width|height|alt)" content="">/);
assert.match(post, /role="progressbar" lang="en" aria-label="Reading progress"/);
assert.match(post, /<details class="reader-settings">/);
assert.match(post, /<details lang="en" class="post-toc" id="post-toc">\s*<summary>Contents <span>\(\d+\)<\/span><\/summary>/);
assert.match(post, /<ol lang="en"><li class="toc-level-2"><a href="#section-[^"]+">/);
// The wide-screen outline is plain HTML so it shows even when scripts are blocked.
assert.match(post, /<nav lang="en" class="post-outline" id="post-outline" aria-label="Table of contents">\s*<ol lang="en"><li class="toc-level-2">/);
// Controls that need JavaScript are hidden until the head script marks <html class="js">.
const css = fs.readFileSync(path.join(distDir, 'css', 'style.css'), 'utf8');
assert.match(css, /\.theme-toggle \{\s*display: none;/);
assert.match(css, /\.js \.theme-toggle \{\s*display: inline-grid;/);
assert.doesNotMatch(css, /@view-transition/);
assert.match(post, /<div class="reading-dock" id="reading-dock" lang="en" data-visible="false" data-reading-time="\d+">/);
assert.match(post, /<dialog class="reading-sheet" id="reading-sheet"/);
// The browser keeps content out of system bars; drawing edge-to-edge hid the footer on Android.
assert.match(home, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
assert.match(post, /<div class="post-body">\s*<p>/);
assert.match(post, /<h2 id="section-[a-z0-9-]+">/);
assert.doesNotMatch(post, /\{\{\{?[\w#/ ]+\}?\}\}/);
assert.match(post, /<html lang="en">/);
// Every published post is listed on the homepage, numbered oldest-first.
const publishedPosts = loadPosts();
assert.strictEqual((home.match(/<article class="post-item"/g) || []).length, publishedPosts.length);
assert.match(home, new RegExp('<span class="post-item-number" aria-hidden="true">' +
  String(publishedPosts.length).padStart(2, '0') + '</span>'));
assert.match(home, /<p class="post-item-meta" lang="en"><time datetime="\d{4}-\d{2}-\d{2}">[^<]+<\/time><span aria-hidden="true"> · <\/span><span>\d+ min read<\/span><\/p>/);
assert.match(notFound, /<a href="\/">Go back to the blog<\/a>/);
// All articles use the same English site navigation and reading controls.
for (const page of [home, post]) {
  assert.match(page, /<header class="site-header" lang="en">/);
  assert.match(page, /<nav class="site-nav" aria-label="Primary">/);
  assert.match(page, /<a href="\/" class="site-name">Shota Mtvarelishvili<\/a>/);
  assert.match(page, /<a href="\/about\/">About<\/a>/);
  assert.match(page, /id="theme-toggle"[^>]+aria-label="Switch to dark mode"/);
  assert.match(page, /github\.com\/shoti\/shoti\.github\.io">Source<\/a>/);
  assert.doesNotMatch(page, /(?:href|src)="\/news(?:\/|")|news-chrome|news-page/);
}
// The archive page and RSS feed are retired: no output, no links, no feed discovery.
for (const page of [home, post, notFound]) {
  assert.doesNotMatch(page, /href="\/archive\/"|href="\/rss\.xml"|application\/rss\+xml/);
}
assert.strictEqual(fs.existsSync(path.join(distDir, 'archive')), false);
assert.strictEqual(fs.existsSync(path.join(distDir, 'rss.xml')), false);
assert.strictEqual(fs.existsSync(path.join(distDir, 'news')), false);
assert.strictEqual(fs.existsSync(path.join(distDir, 'images', 'news-social.jpg')), false);
const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
assert.doesNotMatch(sitemap, /<loc>https:\/\/shoti\.github\.io\/news\//);
assert.doesNotMatch(sitemap, /\/archive\//);

console.log('Build tests passed');
