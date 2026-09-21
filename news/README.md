# Daily news briefing

This directory contains the durable source for `https://shoti.github.io/news/`.
The site is static: essential briefing content is rendered into HTML during the
existing zero-dependency build. JavaScript is used only for the existing theme
toggle and navigation state.

## What is implemented

- JSON Schema: `news/schema/briefing.schema.json`
- Runtime validation: `lib/news.js`
- Fictional, clearly labelled example: `news/examples/briefing.example.json`
- Append-only editions: `news/data/YYYY-MM-DD/rN.json`
- Latest/archive pointer: `news/index.json`
- Local check/import/publication commands in `scripts/`
- GitHub Issue identity check and JSON extraction
- An authenticated durable issue queue and serialized GitHub Actions publication
  job that validates, tests, commits, builds, and deploys the complete `dist`
  Pages artifact
- Latest page, dated pages, version-history pages, and archive

No sample story is included in `news/index.json`, so fabricated content is never
presented as a real edition.

## Content contract

Schema version `1.0` uses `Asia/Tbilisi`. For revision 1, the edition date must
equal the local Tbilisi date of `generated_at`; a later correction keeps the
original edition date and records its truthful later generation time. Coverage
must end no later than generation. Story
importance values must be sequential and match array order. Story and source IDs
must be unique in their scopes.

`category` is an open lowercase slug used only for navigation. Familiar values
receive a Georgian display label, while a new or unexpected topic remains valid
and is shown as a general important story. Category metadata must never decide
whether a consequential story can be published.

Each source declares which story field it supports through `supports`:
`summary`, `why_it_matters`, or `uncertainty`. Every story must have support for
the first two, and for uncertainty whenever that field is present. URLs must be
HTTPS, must not contain credentials, and must use a public DNS hostname.

JSON Schema supplies the machine-readable shape. Runtime validation additionally
enforces real calendar dates, timestamp ordering, Tbilisi date boundaries,
unique IDs, claim/source coverage, safe URLs, revision sequencing, and path
restrictions. Passing validation does not establish factual accuracy.

## Local commands

Validate without writing:

```bash
npm run news:check -- /absolute/path/briefing.json
```

Import and build, rolling the data and generated site back if the build fails:

```bash
npm run news:publish -- /absolute/path/briefing.json
```

Then run the complete checks:

```bash
npm test
git diff --check
```

The command does not commit or push. Review `news/data/`, `news/index.json`, and
the generated page locally before committing.

## Revisions and retries

The first publication for a date uses `revision: 1` and
`corrects_revision: null`. A correction keeps the same `briefing_id` and date,
increments `revision` by exactly one, and sets `corrects_revision` to the previous
revision. Old JSON and HTML versions remain available. Existing revisions are
never overwritten.

An identical retry is idempotent. The importer reuses the existing revision and
does not add another archive entry. Different content submitted under an existing
date/revision is rejected as a collision.

## Selected delivery path: authenticated GitHub Issue

The scheduled task creates one issue in `shoti/shoti.github.io` with:

- title: `[news] YYYY-MM-DD rN`
- body: exactly one fenced `json` block containing the canonical payload

The title only routes the event. It never authorizes publication. The workflow
requires `issue.user.login` and `sender.login` to match and requires that exact
login in the repository variable `NEWS_ALLOWED_SENDERS`. After validation, the
workflow adds a machine-only authorization receipt containing the exact issue
body's SHA-256 digest. Queue processing requires that receipt to have been posted
by `github-actions[bot]` and to match the current body, so a later unauthorized
edit invalidates the payload. Submitted text is read as data, never interpolated
into commands, templates, or executable code.

The deployment workflow runs on `main` pushes plus `issues.opened` and
`issues.edited`. A first issue-only job authenticates and validates the triggering
issue before it can enter publication concurrency. The open, authorized `[news]`
issues are then the durable queue: every serialized deployment job, including an
ordinary `main` push, re-reads that queue. It orders every valid payload,
publishes them in one transaction, runs the build and tests, commits only
`news/data` and `news/index.json`, pushes the validated commit, and deploys the
already-built complete site. This means a newer push that replaces a pending
deployment still drains the durable queue. The workflow does not expect its
`GITHUB_TOKEN` push to trigger another workflow.

Successfully deployed intake issues are closed only if their current bodies
still match the exact digests that were published. The close response is checked
too; a concurrently edited issue is reopened, and every authorized edit also
reopens its issue before recording the new digest. The next queue sweep therefore
retains the corrected payload. Import-ineligible collisions are skipped and left
open for correction instead of blocking later valid issues.

## Current account setup

The production connection was verified on 2026-09-21:

- the connected GitHub issue author is exactly `shoti`;
- repository variable `NEWS_ALLOWED_SENDERS` is `shoti`;
- Issues are enabled and Actions has read/write `GITHUB_TOKEN` permission;
- GitHub Pages deploys through Actions;
- the manual end-to-end run created issue `#8`, committed a validated edition,
  deployed the dated page, and closed the unchanged intake issue;
- the active ChatGPT task runs daily at **20:00 Asia/Tbilisi**.

If the connection is ever replaced, repeat the disposable issue test before
changing `NEWS_ALLOWED_SENDERS`. Use the exact observed GitHub author login,
including any `[bot]` suffix, keep the GitHub App scoped to this repository, and
rerun the manual end-to-end publication check before re-enabling the schedule.
Preserve branch protection and repository rules rather than weakening them for
automation. The publication time follows research, validation, Actions, and
Pages deployment; 20:00 is the research start, not guaranteed public availability.

Official OpenAI documentation confirms that scheduled tasks can run in the
background and that scheduled tasks may use installed plugins, subject to the
plugin's actual connection and permissions:

- https://learn.chatgpt.com/docs/automations
- https://learn.chatgpt.com/docs/plugins

This design does not use a paid OpenAI API, arbitrary webhooks, browser cookies,
email parsing, or GitHub cron. GitHub scheduled-workflow delays and inactivity
rules therefore do not apply.

## Manual recovery

If the ChatGPT task cannot create the issue, its output must retain the complete
validated JSON. Save it locally and run the local commands above, then open a
normal reviewed PR containing only the new `news/data/...` revision and
`news/index.json` update. Merge through the repository's existing policy; the
normal `main` push workflow will build and deploy the complete site.

If an authorized issue run failed transiently, open that exact failed run in
Actions and choose **Re-run all jobs**. GitHub retains the original issue event,
so the same author/sender check, payload digest, and validation are applied. Do
not copy the payload into a different workflow input.

## Security notes

- There are no publication credentials in public files or client JavaScript.
- The workflow uses GitHub's ephemeral `GITHUB_TOKEN` and a non-secret sender
  allowlist. It never logs a token.
- Only validated paths below `news/data/YYYY-MM-DD/rN.json` and `news/index.json`
  are written.
- HTML rendering escapes every submitted string. URLs are independently
  validated before rendering.
- A failed import, build, test, commit, or push occurs before Pages deployment,
  so the last deployed site remains in place.
- Every Pages deployment shares one non-cancelling concurrency group and drains
  the durable authorized queue, so replacement of a pending job cannot strand a
  validated issue.
