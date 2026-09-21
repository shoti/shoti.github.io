#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildUpdatedIndex,
  loadNewsIndex,
  stableJson
} = require('../lib/news');
const { extractPayload, parseAllowedSenders } = require('./extract-news-issue');
const { payloadDigest } = require('./record-news-authorization');

const MAX_QUEUED_ISSUES = 50;

function flattenPages(value) {
  if (!Array.isArray(value)) throw new Error('GitHub issues response must be an array');
  return value.flatMap(item => Array.isArray(item) ? item : [item]);
}

function authorizedDigests(commentsResponse) {
  const digests = new Map();
  for (const comment of flattenPages(commentsResponse)) {
    if (comment?.user?.login !== 'github-actions[bot]' || typeof comment.body !== 'string' ||
        typeof comment.issue_url !== 'string') continue;
    const numberMatch = comment.issue_url.match(/\/issues\/(\d+)$/);
    const digestMatch = comment.body.match(/<!-- news-payload-authorization sha256=([a-f0-9]{64}) -->/);
    if (!numberMatch || !digestMatch) continue;
    const number = Number(numberMatch[1]);
    if (!digests.has(number)) digests.set(number, new Set());
    digests.get(number).add(digestMatch[1]);
  }
  return digests;
}

function collectIssues(apiResponse, commentsResponse, allowedValue) {
  const allowed = parseAllowedSenders(allowedValue);
  const receipts = authorizedDigests(commentsResponse);
  const candidates = flattenPages(apiResponse).filter(issue =>
    issue && !issue.pull_request && typeof issue.title === 'string' &&
    issue.title.startsWith('[news]') && typeof issue.user?.login === 'string' &&
    allowed.has(issue.user.login.toLowerCase()) && typeof issue.body === 'string' &&
    receipts.get(issue.number)?.has(payloadDigest(issue.body))
  );
  const valid = [];
  for (const issue of candidates) {
    try {
      const payload = extractPayload(issue.body);
      valid.push({ number: issue.number, digest: payloadDigest(issue.body), payload });
    } catch (error) {
      console.warn(`Skipping invalid authorized news issue #${issue.number}: ${error.message}`);
    }
  }
  return valid.sort((a, b) =>
    a.payload.edition_date.localeCompare(b.payload.edition_date) ||
    a.payload.revision - b.payload.revision ||
    a.number - b.number
  );
}

function filterImportable(issues, rootDir) {
  let index = loadNewsIndex(rootDir);
  const accepted = [];
  const plannedContents = new Map();
  for (const issue of issues) {
    try {
      const relativePath = `data/${issue.payload.edition_date}/r${issue.payload.revision}.json`;
      const editionPath = path.join(rootDir, 'news', relativePath);
      const payloadContent = stableJson(issue.payload);
      const existingContent = plannedContents.has(relativePath)
        ? plannedContents.get(relativePath)
        : fs.existsSync(editionPath) ? fs.readFileSync(editionPath, 'utf8') : null;
      if (existingContent !== null && existingContent !== payloadContent) {
        throw new Error(`revision collision at news/${relativePath}`);
      }
      index = buildUpdatedIndex(index, issue.payload);
      plannedContents.set(relativePath, payloadContent);
      accepted.push(issue);
    } catch (error) {
      console.warn(`Skipping import-ineligible news issue #${issue.number}: ${error.message}`);
    }
  }
  return accepted;
}

function boundedImportableIssues(issues, rootDir, limit = MAX_QUEUED_ISSUES) {
  const importable = filterImportable(issues, rootDir);
  if (importable.length > limit) {
    throw new Error(`Refusing to process more than ${limit} importable news issues`);
  }
  return importable;
}

function run(inputPath, commentsPath, outputDir, allowedValue = process.env.NEWS_ALLOWED_SENDERS,
  rootDir = path.join(__dirname, '..'), allowEmpty = false) {
  if (!inputPath || !commentsPath || !outputDir) {
    throw new Error('Usage: node scripts/collect-news-issues.js <issues.json> <comments.json> <output-directory>');
  }
  const response = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const comments = JSON.parse(fs.readFileSync(path.resolve(commentsPath), 'utf8'));
  const issues = boundedImportableIssues(collectIssues(response, comments, allowedValue), rootDir);
  if (!issues.length && !allowEmpty) {
    throw new Error('No valid authorized open news issues are available to publish');
  }
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const manifest = issues.map(issue => {
    const payloadPath = path.join(path.resolve(outputDir), `issue-${issue.number}.json`);
    fs.writeFileSync(payloadPath, `${JSON.stringify(issue.payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { number: issue.number, digest: issue.digest, path: payloadPath };
  });
  const manifestPath = path.join(path.resolve(outputDir), 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Collected ${manifest.length} authorized news issue(s)`);
  return manifestPath;
}

if (require.main === module) {
  try {
    run(process.argv[2], process.argv[3], process.argv[4], process.env.NEWS_ALLOWED_SENDERS,
      path.join(__dirname, '..'), process.argv[5] === '--allow-empty');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  MAX_QUEUED_ISSUES,
  authorizedDigests,
  boundedImportableIssues,
  collectIssues,
  filterImportable,
  flattenPages,
  run
};
