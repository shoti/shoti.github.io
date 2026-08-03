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
  render,
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
const stylesheetIndex = home.indexOf('<link rel="stylesheet" href="/css/style.css">');
assert.ok(themeBootstrapIndex !== -1 && themeBootstrapIndex < stylesheetIndex,
  'Stored theme must be applied before the stylesheet to prevent a theme flash');
assert.ok(readerBootstrapIndex !== -1 && readerBootstrapIndex < stylesheetIndex,
  'Stored reader preferences must be applied before the stylesheet to prevent a typography flash');
assert.match(home, /<a class="skip-link" href="#main-content">Skip to content<\/a>/);
assert.match(home, /<main id="main-content">\s*<h1 class="intro">/);
assert.doesNotMatch(home, /&lt;h1 class=&quot;intro&quot;/);
assert.match(post, /<span class="reading-time">\d+ min read<\/span>/);
assert.match(post, /role="progressbar" aria-label="Reading progress"/);
assert.match(post, /<details class="reader-settings">/);
assert.match(post, /<details class="post-toc" id="post-toc" hidden>/);
assert.match(post, /<div class="post-body">\s*<p>/);
assert.match(post, /<h2 id="section-[a-z0-9-]+">/);
assert.doesNotMatch(post, /\{\{\{?[\w#/ ]+\}?\}\}/);
assert.match(notFound, /<a href="\/">Go back to the blog<\/a>/);

console.log('Build tests passed');
