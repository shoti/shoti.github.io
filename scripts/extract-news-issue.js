#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, validateBriefing } = require('../lib/news');

function parseAllowedSenders(value) {
  if (!value || !value.trim()) throw new Error('NEWS_ALLOWED_SENDERS is not configured');
  const senders = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!senders.length || senders.some(sender => !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?(?:\[bot\])?$/.test(sender))) {
    throw new Error('NEWS_ALLOWED_SENDERS must be a comma-separated list of exact GitHub logins');
  }
  return new Set(senders);
}

function authorizeIssueEvent(event, allowedValue) {
  const issueLogin = event?.issue?.user?.login;
  const senderLogin = event?.sender?.login;
  if (typeof issueLogin !== 'string' || typeof senderLogin !== 'string') {
    throw new Error('GitHub event does not identify both the issue author and event sender');
  }
  if (issueLogin.toLowerCase() !== senderLogin.toLowerCase()) {
    throw new Error('Issue author and event sender do not match');
  }
  const allowed = parseAllowedSenders(allowedValue);
  if (!allowed.has(issueLogin.toLowerCase())) {
    throw new Error(`Unauthorized news submission from GitHub login: ${issueLogin}`);
  }
  return issueLogin;
}

function extractPayload(body) {
  if (typeof body !== 'string') throw new Error('News issue body is empty');
  const trimmed = body.trim();
  let jsonText = trimmed;
  if (!trimmed.startsWith('```') && trimmed.includes('```')) {
    throw new Error('Issue body must contain exactly one fenced json block and no surrounding text');
  }
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```json\s*\n([\s\S]*?)\n```$/i);
    if (!match) throw new Error('Issue body must contain exactly one fenced json block and no surrounding text');
    jsonText = match[1];
  }
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Issue body is not valid JSON: ${error.message}`);
  }
  validateBriefing(payload);
  return payload;
}

function run(eventPath, outputPath, allowedValue = process.env.NEWS_ALLOWED_SENDERS) {
  if (!eventPath || !outputPath) {
    throw new Error('Usage: node scripts/extract-news-issue.js <event.json> <output.json>');
  }
  const event = readJson(path.resolve(eventPath), 'GitHub event');
  authorizeIssueEvent(event, allowedValue);
  const payload = extractPayload(event.issue.body);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Authorized and extracted ${payload.edition_date} revision ${payload.revision}`);
  return payload;
}

if (require.main === module) {
  try {
    run(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { authorizeIssueEvent, extractPayload, parseAllowedSenders, run };
