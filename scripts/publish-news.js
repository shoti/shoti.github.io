#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const {
  applyImportPlan,
  planImport,
  readJson,
  rollbackImportPlan
} = require('../lib/news');

function defaultBuild(rootDir) {
  return spawnSync(process.execPath, ['build.js'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'inherit'
  });
}

function publishBriefings(inputPaths, rootDir = path.join(__dirname, '..'), build = defaultBuild) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 1) throw new Error('At least one briefing path is required');
  const plans = [];
  try {
    for (const inputPath of inputPaths) {
      const briefing = readJson(path.resolve(inputPath), inputPath);
      const plan = planImport(rootDir, briefing);
      plans.push(plan);
      applyImportPlan(plan);
    }
    const result = build(rootDir);
    if (!result || result.status !== 0) throw new Error('Publication build failed');
    return plans;
  } catch (error) {
    for (const plan of [...plans].reverse()) rollbackImportPlan(plan);
    const restore = build(rootDir);
    if (!restore || restore.status !== 0) {
      throw new Error(`${error.message}; data was rolled back, but the previous local dist could not be rebuilt`);
    }
    throw new Error(`${error.message}; data and the generated site were restored to the previous edition`);
  }
}

function publishBriefing(inputPath, rootDir = path.join(__dirname, '..'), build = defaultBuild) {
  return publishBriefings([inputPath], rootDir, build)[0];
}

function pathsFromArgs(argv) {
  if (argv[0] !== '--manifest') return argv;
  if (argv.length !== 2) throw new Error('Usage: node scripts/publish-news.js --manifest <manifest.json>');
  const manifest = readJson(path.resolve(argv[1]), 'news issue manifest');
  if (!Array.isArray(manifest) || !manifest.length ||
      manifest.some(item => !item || typeof item.path !== 'string')) {
    throw new Error('News issue manifest must contain at least one payload path');
  }
  return manifest.map(item => item.path);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/publish-news.js <briefing.json> [...] | --manifest <manifest.json>');
    process.exit(1);
  }
  try {
    const plans = publishBriefings(pathsFromArgs(args));
    for (const plan of plans) {
      const verb = plan.duplicate ? 'Verified' : 'Published locally';
      console.log(`${verb}: ${plan.briefing.edition_date} revision ${plan.briefing.revision}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { defaultBuild, pathsFromArgs, publishBriefing, publishBriefings };
