#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://shoti.github.io';
const POSTS_DIR = path.join(__dirname, 'content', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const STATIC_DIR = path.join(__dirname, 'static');
const DIST_DIR = path.join(__dirname, 'dist');

// --- Minimal Markdown Parser ---

function parseMarkdown(text) {
  var lines = text.split('\n');
  var html = [];
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      var lang = line.trim().slice(3).trim();
      var code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      var escaped = escapeHtml(code.join('\n'));
      if (lang) {
        html.push('<pre><code class="language-' + lang + '">' + escaped + '</code></pre>');
      } else {
        html.push('<pre><code>' + escaped + '</code></pre>');
      }
      continue;
    }

    // Headings
    var headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      var level = headingMatch[1].length;
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

    // Blockquote
    if (line.trim().startsWith('> ')) {
      var quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      html.push('<blockquote>' + parseMarkdown(quoteLines.join('\n')) + '</blockquote>');
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line.trim())) {
      var items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^[-*]\s+/, '')));
        i++;
      }
      html.push('<ul>' + items.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line.trim())) {
      var items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^\d+\.\s+/, '')));
        i++;
      }
      html.push('<ol>' + items.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ol>');
      continue;
    }

    // Image (standalone)
    if (/^!\[/.test(line.trim())) {
      var imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        html.push('<p><img src="' + imgMatch[2] + '" alt="' + imgMatch[1] + '"></p>');
        i++;
        continue;
      }
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    var para = [];
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
  // Images
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
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
  var depth = 1;
  var i = startIdx;
  while (i < str.length && depth > 0) {
    if (str.slice(i).startsWith(openTag)) {
      depth++;
      i += openTag.length;
    } else if (str.slice(i).startsWith(closeTag)) {
      depth--;
      if (depth === 0) return i;
      i += closeTag.length;
    } else {
      i++;
    }
  }
  return -1;
}

function render(template, data) {
  var result = '';
  var i = 0;

  while (i < template.length) {
    // {{#each key}}
    var eachMatch = template.slice(i).match(/^\{\{#each (\w+)\}\}/);
    if (eachMatch) {
      var key = eachMatch[1];
      var bodyStart = i + eachMatch[0].length;
      var bodyEnd = findBalancedBlock(template, '{{#each ', '{{/each}}', bodyStart);
      if (bodyEnd === -1) break;
      var body = template.slice(bodyStart, bodyEnd);
      var arr = data[key];
      if (Array.isArray(arr)) {
        result += arr.map(function (item) { return render(body, item); }).join('');
      }
      i = bodyEnd + '{{/each}}'.length;
      continue;
    }

    // {{#if key}}
    var ifMatch = template.slice(i).match(/^\{\{#if (\w+)\}\}/);
    if (ifMatch) {
      var key = ifMatch[1];
      var bodyStart = i + ifMatch[0].length;
      var bodyEnd = findBalancedBlock(template, '{{#if ', '{{/if}}', bodyStart);
      if (bodyEnd === -1) break;
      var body = template.slice(bodyStart, bodyEnd);
      if (data[key]) {
        result += render(body, data);
      }
      i = bodyEnd + '{{/if}}'.length;
      continue;
    }

    // {{variable}}
    var varMatch = template.slice(i).match(/^\{\{(\w+)\}\}/);
    if (varMatch) {
      var key = varMatch[1];
      result += data[key] !== undefined ? data[key] : '';
      i += varMatch[0].length;
      continue;
    }

    result += template[i];
    i++;
  }

  return result;
}

// --- Utility ---

function formatDate(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var entry of entries) {
    var srcPath = path.join(src, entry.name);
    var destPath = path.join(dest, entry.name);
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
  var escapedTitle = escapeHtml(title);
  var fontSize = escapedTitle.length > 50 ? 52 : escapedTitle.length > 30 ? 60 : 72;
  var lines = wrapSvgText(escapedTitle, fontSize, 1000);
  var lineCount = (lines.match(/<tspan/g) || []).length || 1;
  var textBlockHeight = lineCount * fontSize * 1.25;
  var textY = (630 - textBlockHeight) / 2 + fontSize;
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
  var charPerLine = Math.floor(maxWidth / (fontSize * 0.52));
  var words = text.split(' ');
  var lines = [];
  var current = '';
  for (var w of words) {
    if ((current + ' ' + w).trim().length > charPerLine && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = current ? current + ' ' + w : w;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.slice(0, 3).map(function (line, i) {
    return '<tspan x="600" dy="' + (i === 0 ? 0 : fontSize * 1.25) + '">' + line + '</tspan>';
  }).join('');
}

// --- New Post Command ---

if (process.argv[2] === 'new') {
  var title = process.argv.slice(3).join(' ');
  if (!title) {
    console.error('Usage: npm run new "Post Title"');
    process.exit(1);
  }
  var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var date = new Date().toISOString().slice(0, 10);
  var post = {
    title: title,
    slug: slug,
    date: date,
    tags: [],
    draft: true,
    description: '',
    body: ''
  };
  var filePath = path.join(POSTS_DIR, slug + '.json');
  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2) + '\n', 'utf-8');
  console.log('Created: ' + filePath);
  process.exit(0);
}

// --- Build ---

var startTime = Date.now();

// Load templates
var baseTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'base.html'), 'utf-8');
var indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf-8');
var postTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf-8');
var archiveTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'archive.html'), 'utf-8');
var aboutTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'about.html'), 'utf-8');
var notFoundTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, '404.html'), 'utf-8');

// Load posts
var postFiles = fs.readdirSync(POSTS_DIR).filter(function (f) { return f.endsWith('.json'); });
var posts = postFiles.map(function (f) {
  return JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8'));
}).filter(function (p) { return !p.draft; })
  .sort(function (a, b) { return b.date.localeCompare(a.date); });

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
var homePosts = posts.slice(0, 10).map(function (p) {
  return {
    title: p.title,
    slug: p.slug,
    date: p.date,
    dateFormatted: formatDate(p.date),
    description: p.description
  };
});
var indexContent = render(indexTemplate, { posts: homePosts });
var homeOgSvg = generateOgImage('Shota Mtvarelishvili');
writeFile(path.join(DIST_DIR, 'og-home.svg'), homeOgSvg);
var indexPage = wrapInBase(indexContent, {
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
posts.forEach(function (post, idx) {
  var body = parseMarkdown(post.body);
  var words = wordCount(post.body);
  var tags = post.tags.map(function (t) { return '#' + t; }).join(' ');

  var prevPost = idx < posts.length - 1 ? posts[idx + 1] : null;
  var nextPost = idx > 0 ? posts[idx - 1] : null;

  var postContent = render(postTemplate, {
    postTitle: post.title,
    date: post.date,
    dateFormatted: formatDate(post.date),
    wordCount: words,
    tags: tags,
    body: body,
    prevPost: prevPost ? true : false,
    prevSlug: prevPost ? prevPost.slug : '',
    prevTitle: prevPost ? prevPost.title : '',
    nextPost: nextPost ? true : false,
    nextSlug: nextPost ? nextPost.slug : '',
    nextTitle: nextPost ? nextPost.title : ''
  });

  // Structured data for blog post
  var structuredData = JSON.stringify({
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

  var headExtra = '<script type="application/ld+json">' + structuredData + '</script>';

  var ogSvg = generateOgImage(post.title);
  writeFile(path.join(DIST_DIR, 'posts', post.slug, 'og.svg'), ogSvg);

  var page = wrapInBase(postContent, {
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
var yearMap = {};
posts.forEach(function (p) {
  var year = p.date.slice(0, 4);
  if (!yearMap[year]) yearMap[year] = [];
  yearMap[year].push({
    title: p.title,
    slug: p.slug,
    date: p.date,
    dateFormatted: formatDate(p.date)
  });
});
var years = Object.keys(yearMap).sort().reverse().map(function (y) {
  return { year: y, posts: yearMap[y] };
});
var archiveContent = render(archiveTemplate, { years: years });
var archivePage = wrapInBase(archiveContent, {
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
var aboutData = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'about.json'), 'utf-8'));
var aboutBody = parseMarkdown(aboutData.body);
var aboutContent = render(aboutTemplate, {
  heading: aboutData.heading,
  body: aboutBody
});
var personSchema = JSON.stringify({
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
var aboutHead = '<script type="application/ld+json">' + personSchema + '</script>';
var aboutPage = wrapInBase(aboutContent, {
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
var notFoundContent = render(notFoundTemplate, { posts: homePosts.slice(0, 5) });
var notFoundPage = wrapInBase(notFoundContent, {
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

var rssItems = posts.slice(0, 20).map(function (p) {
  var body = parseMarkdown(p.body);
  return '    <item>\n' +
    '      <title>' + escapeXml(p.title) + '</title>\n' +
    '      <link>' + BASE_URL + '/posts/' + p.slug + '/</link>\n' +
    '      <guid>' + BASE_URL + '/posts/' + p.slug + '/</guid>\n' +
    '      <pubDate>' + new Date(p.date + 'T00:00:00Z').toUTCString() + '</pubDate>\n' +
    '      <description>' + escapeXml(p.description) + '</description>\n' +
    '      <content:encoded><![CDATA[' + body + ']]></content:encoded>\n' +
    '      <author>mtvarelishvili@proton.me (Shota Mtvarelishvili)</author>\n' +
    '    </item>';
}).join('\n');

var rss = '<?xml version="1.0" encoding="UTF-8"?>\n' +
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

var sitemapUrls = [
  BASE_URL + '/',
  BASE_URL + '/archive/',
  BASE_URL + '/about/'
].concat(posts.map(function (p) { return BASE_URL + '/posts/' + p.slug + '/'; }));

var sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrls.map(function (url) {
    return '  <url>\n    <loc>' + url + '</loc>\n  </url>';
  }).join('\n') + '\n' +
  '</urlset>\n';

writeFile(path.join(DIST_DIR, 'sitemap.xml'), sitemap);

// --- Done ---

var elapsed = Date.now() - startTime;
console.log('Build complete: ' + posts.length + ' posts in ' + elapsed + 'ms');
