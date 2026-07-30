# shoti.github.io

Personal blog. Static HTML/CSS/JS. Zero runtime dependencies.

Deployed automatically to GitHub Pages on push to `main`.

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
templates/             HTML templates
static/                CSS, JS, favicon (copied to dist/)
build.js               Build script (zero dependencies)
dist/                  Generated output (git-ignored)
```
