# shoti.github.io

Personal blog. Static HTML/CSS/JS. Zero runtime dependencies.

Deployed automatically to GitHub Pages on push to `main`.

## Daily Georgian News Briefing

`/news/` is a server-rendered, static evening briefing with dated editions,
source links, revision history, and a separate archive. No fictional edition is
published when the archive is empty.

The canonical input is versioned JSON. Validate or publish a completed payload
locally with:

```bash
npm run news:check -- /path/to/briefing.json
npm run news:publish -- /path/to/briefing.json
npm test
```

See [`news/README.md`](news/README.md) for the data contract, GitHub Issue intake,
account setup, corrections, and recovery. The copy-ready scheduled-task prompt
is in [`news/CHATGPT_TASK_PROMPT.md`](news/CHATGPT_TASK_PROMPT.md).

## Write a New Post

```bash
npm run new "Your Post Title"
```

Edit the created file in `content/posts/`, write content in the `body` field using Markdown, set `"draft": false`, push.

## Build Locally

```bash
npm test
npm run build
npx serve dist
```

Published posts are validated during the build. Their filename must match the
`slug`, dates must be real `YYYY-MM-DD` calendar dates, and `tags` must be an
array of strings.

## Structure

```
content/posts/*.json   Blog posts (JSON with Markdown body)
content/about.json     About page content
news/                   Briefing schema, archive index, prompt, and editions
lib/news.js             Runtime briefing validation and import planning
scripts/                News intake/import/publication commands
templates/             HTML templates
static/                CSS, JS, favicon (copied to dist/)
build.js               Build script (zero dependencies)
dist/                  Generated output (git-ignored)
```
