#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://shoti.github.io';
const POSTS_DIR = path.join(__dirname, 'content', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const STATIC_DIR = path.join(__dirname, 'static');
const DIST_DIR = path.join(__dirname, 'dist');

const REQUIRED_POST_FIELDS = ['title', 'slug', 'date', 'body'];

// --- Minimal Markdown Parser ---

function parseMarkdown(text) {
  return parseMarkdownInner(text, 0);
}

function parseMarkdownInner(text, depth) {
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
      html.push('<h' + level + '>' + inline(headingMatch[2]) + '</h' + level + '>');
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
      html.push('<blockquote>' + parseMarkdownInner(quoteLines.join('\n'), depth + 1) + '</blockquote>');
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
        html.push('<p><img src="' + escapeHtml(imgMatch[2]) + '" alt="' + escapeHtml(imgMatch[1]) + '"></p>');
        i++;
        continue;
      }
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].trim().startsWith('```') &&
           !lines[i].trim().startsWith('#') &&
           !lines[i].trim().startsWith('> ') &&
           !/^[-*]\s+/.test(lines[i].trim()) &&
           !/^\d+\.\s+/.test(lines[i].trim()) &&
           !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      html.push('<p>' + inline(para.join('\n')) + '</p>');
    }
  }

  return html.join('\n');
}

function inline(text) {
  // Escape HTML first to prevent XSS — markdown syntax chars ([], (), *, `) are unaffected
  text = escapeHtml(text);
  // Images
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      if (bodyEnd === -1) break;
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
      if (bodyEnd === -1) break;
      const body = template.slice(bodyStart, bodyEnd);
      if (data[key]) {
        result += render(body, data);
      }
      i = bodyEnd + '{{/if}}'.length;
      continue;
    }

    // {{variable}}
    const varMatch = template.slice(i).match(/^\{\{(\w+)\}\}/);
    if (varMatch) {
      const key = varMatch[1];
      result += data[key] !== undefined ? data[key] : '';
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
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function escapeXml(text) {
  return text
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
  const escapedTitle = escapeHtml(title);
  const fontSize = escapedTitle.length > 50 ? 52 : escapedTitle.length > 30 ? 60 : 72;
  const lines = wrapSvgText(escapedTitle, fontSize, 1000);
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
    return '<tspan x="600" dy="' + (idx === 0 ? 0 : fontSize * 1.25) + '">' + line + '</tspan>';
  }).join('');
}

function validatePost(post, filename) {
  const missing = REQUIRED_POST_FIELDS.filter(f => post[f] === undefined || post[f] === null);
  if (missing.length > 0) {
    console.error('Invalid post ' + filename + ': missing fields: ' + missing.join(', '));
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    console.error('Invalid post ' + filename + ': date must be YYYY-MM-DD, got "' + post.date + '"');
    process.exit(1);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) {
    console.error('Invalid post ' + filename + ': slug contains invalid characters: "' + post.slug + '"');
    process.exit(1);
  }
}

// --- New Post Command ---

if (process.argv[2] === 'new') {
  const title = process.argv.slice(3).join(' ');
  if (!title) {
    console.error('Usage: npm run new "Post Title"');
    process.exit(1);
  }
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const filePath = path.join(POSTS_DIR, slug + '.json');
  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2) + '\n', 'utf-8');
  console.log('Created: ' + filePath);
  process.exit(0);
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

// Load and validate posts
const postFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.json'));
const posts = postFiles.map(f => {
  const post = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8'));
  if (!post.draft) validatePost(post, f);
  return post;
}).filter(p => !p.draft)
  .sort((a, b) => b.date.localeCompare(a.date));

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
  return render(baseTemplate, Object.assign({ content: content }, data));
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
    wordCount: post._words,
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
  const structuredData = JSON.stringify({
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
const aboutData = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'about.json'), 'utf-8'));
const aboutBody = parseMarkdown(aboutData.body);
const aboutContent = render(aboutTemplate, {
  heading: aboutData.heading,
  body: aboutBody
});
const personSchema = JSON.stringify({
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
  { url: BASE_URL + '/about/', date: null }
].concat(posts.map(p => ({ url: BASE_URL + '/posts/' + p.slug + '/', date: p.date })));

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
