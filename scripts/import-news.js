#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  applyImportPlan,
  planImport,
  readJson
} = require('../lib/news');

function parseArgs(argv) {
  const args = [...argv];
  const checkOnly = args.includes('--check');
  const filtered = args.filter(arg => arg !== '--check');
  if (filtered.length !== 1) {
    throw new Error('Usage: node scripts/import-news.js <briefing.json> [--check]');
  }
  return { inputPath: path.resolve(filtered[0]), checkOnly };
}

function run(argv = process.argv.slice(2), rootDir = path.join(__dirname, '..')) {
  const { inputPath, checkOnly } = parseArgs(argv);
  const briefing = readJson(inputPath, inputPath);
  const plan = planImport(rootDir, briefing);
  if (!checkOnly) applyImportPlan(plan);
  const verb = checkOnly ? 'Validated' : plan.duplicate ? 'Confirmed existing' : 'Imported';
  process.stdout.write(`${verb} ${briefing.edition_date} revision ${briefing.revision}\n`);
  return plan;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
