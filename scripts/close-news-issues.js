#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { readJson } = require('../lib/news');
const { payloadDigest } = require('./record-news-authorization');

function closeIssues(manifestPath, repository = process.env.GITHUB_REPOSITORY, spawn = spawnSync) {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is missing or invalid');
  }
  const manifest = readJson(path.resolve(manifestPath), 'news issue manifest');
  if (!Array.isArray(manifest) || manifest.some(item =>
    !Number.isSafeInteger(item?.number) || item.number < 1 ||
    typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest))) {
    throw new Error('News issue manifest contains an invalid issue number or digest');
  }
  for (const item of manifest) {
    const current = spawn('gh', [
      'api', `repos/${repository}/issues/${item.number}`
    ], { encoding: 'utf8' });
    if (!current || current.status !== 0) {
      throw new Error(`Could not verify published news issue #${item.number}`);
    }
    let issue;
    try {
      issue = JSON.parse(current.stdout);
    } catch {
      throw new Error(`GitHub returned invalid data for news issue #${item.number}`);
    }
    if (typeof issue.body !== 'string' || payloadDigest(issue.body) !== item.digest) {
      console.warn(`Leaving news issue #${item.number} open because its body changed during publication`);
      continue;
    }
    if (issue.state === 'closed') continue;
    const result = spawn('gh', [
      'api', '--method', 'PATCH', `repos/${repository}/issues/${item.number}`,
      '-f', 'state=closed', '-f', 'state_reason=completed'
    ], { encoding: 'utf8' });
    if (!result || result.status !== 0) throw new Error(`Could not close published news issue #${item.number}`);
    let closedIssue;
    try {
      closedIssue = JSON.parse(result.stdout);
    } catch {
      throw new Error(`GitHub returned invalid close data for news issue #${item.number}`);
    }
    if (typeof closedIssue.body === 'string' && payloadDigest(closedIssue.body) === item.digest) continue;

    const reopen = spawn('gh', [
      'api', '--method', 'PATCH', `repos/${repository}/issues/${item.number}`,
      '-f', 'state=open'
    ], { encoding: 'utf8', stdio: 'inherit' });
    if (!reopen || reopen.status !== 0) {
      throw new Error(`News issue #${item.number} changed during close and could not be reopened`);
    }
    console.warn(`Reopened news issue #${item.number} because its body changed during publication`);
  }
}

if (require.main === module) {
  try {
    closeIssues(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { closeIssues };
