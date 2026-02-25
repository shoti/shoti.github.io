# mtvarelishvili.com

Personal blog. Static HTML/CSS/JS. Zero runtime dependencies.

## Setup

```bash
git clone https://github.com/shoti/blog.git
cd blog
```

No `npm install` needed — the build script uses only Node.js built-ins.

## Write a New Post

```bash
npm run new "Your Post Title"
```

This creates `content/posts/your-post-title.json` with the current date and `"draft": true`. Edit the file, write your content in the `body` field using Markdown, and set `"draft": false` when ready to publish.

## Build

```bash
npm run build
```

Generates the site into `dist/`.

## Preview Locally

```bash
npx serve dist
```

Then open `http://localhost:3000`.

## Deploy

Push to `main`. GitHub Actions builds and deploys to GitHub Pages automatically.

## Custom Domain

The `CNAME` file is set to `mtvarelishvili.com`. To use a custom domain:

1. Add an A record pointing to GitHub Pages IPs (`185.199.108-111.153`)
2. Or add a CNAME record pointing to `smtvarelishvili.github.io`
3. Enable "Enforce HTTPS" in the repository's Pages settings

## Structure

```
content/posts/*.json   Blog posts (JSON with Markdown body)
content/about.json     About page content
templates/             HTML templates
static/                CSS, JS, favicon (copied to dist/)
build.js               Build script (zero dependencies)
dist/                  Generated output (git-ignored)
```
