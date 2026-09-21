#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { readJson } = require('../lib/news');

function payloadDigest(body) {
  if (typeof body !== 'string') throw new Error('News issue body is empty');
  return crypto.createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

function recordAuthorization(eventPath, repository = process.env.GITHUB_REPOSITORY, spawn = spawnSync) {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is missing or invalid');
  }
  const event = readJson(path.resolve(eventPath), 'authorized GitHub event');
  const issueNumber = event?.issue?.number;
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Authorized event is missing a valid issue number');
  const digest = payloadDigest(event.issue.body);
  const comment = `<!-- news-payload-authorization sha256=${digest} -->\nPayload authorized for publication.`;
  const reopen = spawn('gh', [
    'api', '--method', 'PATCH', `repos/${repository}/issues/${issueNumber}`,
    '-f', 'state=open'
  ], { encoding: 'utf8', stdio: 'inherit' });
  if (!reopen || reopen.status !== 0) throw new Error(`Could not open authorized news issue #${issueNumber}`);
  const result = spawn('gh', [
    'api', '--method', 'POST', `repos/${repository}/issues/${issueNumber}/comments`,
    '-f', `body=${comment}`
  ], { encoding: 'utf8', stdio: 'inherit' });
  if (!result || result.status !== 0) throw new Error(`Could not record authorization for news issue #${issueNumber}`);
  return digest;
}

if (require.main === module) {
  try {
    recordAuthorization(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { payloadDigest, recordAuthorization };
