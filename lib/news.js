'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = '1.0';
const TIMEZONE = 'Asia/Tbilisi';
const CATEGORIES = new Set([
  'georgia-politics',
  'world-politics',
  'science',
  'technology',
  'ai',
  'other'
]);
const CLAIM_FIELDS = new Set(['summary', 'why_it_matters', 'uncertainty']);
const EMPTY_INDEX = Object.freeze({ schema_version: 1, latest: null, editions: [] });

function fail(location, message) {
  throw new Error(`Invalid briefing at ${location}: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, location) {
  if (!isObject(value)) fail(location, 'must be an object');
}

function requireExactKeys(value, allowed, location) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length) fail(location, `unknown field(s): ${extras.join(', ')}`);
  const missing = allowed.filter(key => !(key in value));
  if (missing.length) fail(location, `missing field(s): ${missing.join(', ')}`);
}

function requireString(value, location, { min = 1, max = 10000, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string') fail(location, nullable ? 'must be a string or null' : 'must be a string');
  const length = value.trim().length;
  if (length < min || length > max) fail(location, `must contain ${min}-${max} non-whitespace characters`);
}

function parseCalendarDate(value, location) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(location, 'must be a YYYY-MM-DD date');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(location, 'must be a real calendar date');
  }
  return value;
}

function parseTimestamp(value, location, nullable = false) {
  if (nullable && value === null) return null;
  const match = typeof value === 'string' && value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/
  );
  if (!match) {
    fail(location, nullable ? 'must be an ISO 8601 timestamp with an offset, or null' : 'must be an ISO 8601 timestamp with an offset');
  }
  const [, year, month, day, hour, minute, second, fraction = '0', zone, , offsetHour = '0', offsetMinute = '0'] = match;
  const components = [year, month, day, hour, minute, second].map(Number);
  const wallClock = new Date(Date.UTC(
    components[0], components[1] - 1, components[2], components[3], components[4], components[5]
  ));
  const realComponents = [
    wallClock.getUTCFullYear(), wallClock.getUTCMonth() + 1, wallClock.getUTCDate(),
    wallClock.getUTCHours(), wallClock.getUTCMinutes(), wallClock.getUTCSeconds()
  ];
  if (components.some((component, index) => component !== realComponents[index])) {
    fail(location, 'must contain a real calendar date and time');
  }
  if (zone !== 'Z' && (Number(offsetHour) > 14 || Number(offsetMinute) > 59 ||
      (Number(offsetHour) === 14 && Number(offsetMinute) !== 0))) {
    fail(location, 'has an invalid UTC offset');
  }
  if (fraction.length > 3) fail(location, 'supports at most millisecond precision');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(location, 'must be a real timestamp');
  return date;
}

function localDate(timestamp, timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function validateSafeSourceUrl(value, location) {
  requireString(value, location, { max: 2048 });
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(location, 'must be a valid absolute URL');
  }
  if (url.protocol !== 'https:') fail(location, 'must use https');
  if (url.username || url.password) fail(location, 'must not contain credentials');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    fail(location, 'must not target a local host');
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    fail(location, 'must use a public DNS hostname, not an IP literal');
  }
  return url.toString();
}

function validateBriefing(briefing) {
  requireObject(briefing, '$');
  requireExactKeys(briefing, [
    'schema_version', 'briefing_id', 'edition_date', 'timezone', 'revision',
    'corrects_revision', 'generated_at', 'coverage', 'introduction', 'takeaways',
    'coverage_note', 'stories'
  ], '$');

  if (briefing.schema_version !== SCHEMA_VERSION) fail('$.schema_version', `must equal "${SCHEMA_VERSION}"`);
  requireString(briefing.briefing_id, '$.briefing_id', { min: 3, max: 80 });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(briefing.briefing_id)) {
    fail('$.briefing_id', 'must contain lowercase letters, digits, and single hyphens only');
  }
  parseCalendarDate(briefing.edition_date, '$.edition_date');
  if (briefing.timezone !== TIMEZONE) fail('$.timezone', `must equal "${TIMEZONE}"`);
  if (!Number.isSafeInteger(briefing.revision) || briefing.revision < 1) {
    fail('$.revision', 'must be a positive integer');
  }
  if (briefing.revision === 1 && briefing.corrects_revision !== null) {
    fail('$.corrects_revision', 'must be null for revision 1');
  }
  if (briefing.revision > 1 && briefing.corrects_revision !== briefing.revision - 1) {
    fail('$.corrects_revision', 'must identify the immediately preceding revision');
  }

  const generatedAt = parseTimestamp(briefing.generated_at, '$.generated_at');
  const generationDate = localDate(generatedAt, briefing.timezone);
  if (briefing.revision === 1 && generationDate !== briefing.edition_date) {
    fail('$.edition_date', 'must match generated_at in Asia/Tbilisi for revision 1');
  }
  if (briefing.revision > 1 && generationDate < briefing.edition_date) {
    fail('$.generated_at', 'a correction cannot be generated before its edition date');
  }

  requireObject(briefing.coverage, '$.coverage');
  requireExactKeys(briefing.coverage, ['start', 'end'], '$.coverage');
  const coverageStart = parseTimestamp(briefing.coverage.start, '$.coverage.start');
  const coverageEnd = parseTimestamp(briefing.coverage.end, '$.coverage.end');
  if (coverageStart >= coverageEnd) fail('$.coverage', 'start must be earlier than end');
  if (coverageEnd > generatedAt) fail('$.coverage.end', 'must not be later than generated_at');

  requireString(briefing.introduction, '$.introduction', { min: 20, max: 1000 });
  if (!Array.isArray(briefing.takeaways) || briefing.takeaways.length < 1 || briefing.takeaways.length > 5) {
    fail('$.takeaways', 'must contain 1-5 items');
  }
  briefing.takeaways.forEach((item, index) => requireString(item, `$.takeaways[${index}]`, { min: 5, max: 350 }));
  requireString(briefing.coverage_note, '$.coverage_note', { min: 10, max: 1000, nullable: true });

  if (!Array.isArray(briefing.stories) || briefing.stories.length < 1 || briefing.stories.length > 10) {
    fail('$.stories', 'must contain 1-10 stories');
  }
  const storyIds = new Set();
  briefing.stories.forEach((story, storyIndex) => {
    const location = `$.stories[${storyIndex}]`;
    requireObject(story, location);
    requireExactKeys(story, [
      'id', 'category', 'importance', 'headline', 'summary', 'why_it_matters',
      'uncertainty', 'event_at', 'sources'
    ], location);
    requireString(story.id, `${location}.id`, { min: 3, max: 80 });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) fail(`${location}.id`, 'has an invalid stable ID');
    if (storyIds.has(story.id)) fail(`${location}.id`, `duplicates story ID "${story.id}"`);
    storyIds.add(story.id);
    if (!CATEGORIES.has(story.category)) fail(`${location}.category`, 'is not an allowed category');
    if (story.importance !== storyIndex + 1) {
      fail(`${location}.importance`, `must be ${storyIndex + 1} to match story order`);
    }
    requireString(story.headline, `${location}.headline`, { min: 8, max: 240 });
    requireString(story.summary, `${location}.summary`, { min: 20, max: 1600 });
    requireString(story.why_it_matters, `${location}.why_it_matters`, { min: 20, max: 1200 });
    requireString(story.uncertainty, `${location}.uncertainty`, { min: 10, max: 800, nullable: true });
    parseTimestamp(story.event_at, `${location}.event_at`, true);

    if (!Array.isArray(story.sources) || story.sources.length < 1 || story.sources.length > 8) {
      fail(`${location}.sources`, 'must contain 1-8 sources');
    }
    const sourceIds = new Set();
    const supportedClaims = new Set();
    story.sources.forEach((source, sourceIndex) => {
      const sourceLocation = `${location}.sources[${sourceIndex}]`;
      requireObject(source, sourceLocation);
      requireExactKeys(source, ['id', 'publisher', 'title', 'url', 'published_at', 'supports'], sourceLocation);
      requireString(source.id, `${sourceLocation}.id`, { min: 1, max: 40 });
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) fail(`${sourceLocation}.id`, 'has an invalid stable ID');
      if (sourceIds.has(source.id)) fail(`${sourceLocation}.id`, `duplicates source ID "${source.id}"`);
      sourceIds.add(source.id);
      requireString(source.publisher, `${sourceLocation}.publisher`, { max: 120 });
      requireString(source.title, `${sourceLocation}.title`, { max: 300 });
      validateSafeSourceUrl(source.url, `${sourceLocation}.url`);
      parseTimestamp(source.published_at, `${sourceLocation}.published_at`, true);
      if (!Array.isArray(source.supports) || source.supports.length < 1 || source.supports.length > 3) {
        fail(`${sourceLocation}.supports`, 'must name 1-3 supported claim fields');
      }
      const uniqueSupports = new Set(source.supports);
      if (uniqueSupports.size !== source.supports.length || source.supports.some(claim => !CLAIM_FIELDS.has(claim))) {
        fail(`${sourceLocation}.supports`, 'must contain unique summary, why_it_matters, or uncertainty values');
      }
      source.supports.forEach(claim => supportedClaims.add(claim));
    });
    for (const requiredClaim of ['summary', 'why_it_matters']) {
      if (!supportedClaims.has(requiredClaim)) fail(`${location}.sources`, `must support ${requiredClaim}`);
    }
    if (story.uncertainty !== null && !supportedClaims.has('uncertainty')) {
      fail(`${location}.sources`, 'must support uncertainty when uncertainty is present');
    }
  });
  return briefing;
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}`);
  }
}

function loadNewsIndex(rootDir) {
  const indexPath = path.join(rootDir, 'news', 'index.json');
  if (!fs.existsSync(indexPath)) return JSON.parse(JSON.stringify(EMPTY_INDEX));
  const index = readJson(indexPath, 'news/index.json');
  requireObject(index, 'news/index.json');
  if (index.schema_version !== 1 || !Array.isArray(index.editions) ||
      !(index.latest === null || isObject(index.latest))) {
    throw new Error('Invalid news/index.json structure');
  }
  return index;
}

function revisionRecord(briefing) {
  return {
    revision: briefing.revision,
    path: `data/${briefing.edition_date}/r${briefing.revision}.json`,
    briefing_id: briefing.briefing_id,
    generated_at: briefing.generated_at
  };
}

function latestRecord(briefing) {
  return {
    edition_date: briefing.edition_date,
    revision: briefing.revision,
    path: `data/${briefing.edition_date}/r${briefing.revision}.json`,
    briefing_id: briefing.briefing_id,
    generated_at: briefing.generated_at
  };
}

function buildUpdatedIndex(index, briefing) {
  const next = JSON.parse(JSON.stringify(index));
  let edition = next.editions.find(item => item.edition_date === briefing.edition_date);
  if (!edition) {
    if (briefing.revision !== 1) throw new Error('A new edition must start at revision 1');
    edition = {
      edition_date: briefing.edition_date,
      briefing_id: briefing.briefing_id,
      latest_revision: 0,
      revisions: []
    };
    next.editions.push(edition);
  } else {
    if (edition.briefing_id !== briefing.briefing_id) {
      throw new Error(`Edition ${briefing.edition_date} already uses briefing_id ${edition.briefing_id}`);
    }
    if (briefing.revision > edition.latest_revision + 1) {
      throw new Error(`Correction skips revision ${edition.latest_revision + 1}`);
    }
  }

  const existing = edition.revisions.find(item => item.revision === briefing.revision);
  if (!existing) edition.revisions.push(revisionRecord(briefing));
  edition.revisions.sort((a, b) => a.revision - b.revision);
  edition.latest_revision = Math.max(edition.latest_revision, briefing.revision);
  next.editions.sort((a, b) => b.edition_date.localeCompare(a.edition_date));

  const newest = next.editions[0];
  const newestRevision = newest.revisions.find(item => item.revision === newest.latest_revision);
  next.latest = {
    edition_date: newest.edition_date,
    revision: newest.latest_revision,
    path: newestRevision.path,
    briefing_id: newest.briefing_id,
    generated_at: newestRevision.generated_at
  };
  return next;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function planImport(rootDir, briefing) {
  validateBriefing(briefing);
  const index = loadNewsIndex(rootDir);
  const editionPath = path.join(rootDir, 'news', 'data', briefing.edition_date, `r${briefing.revision}.json`);
  const indexPath = path.join(rootDir, 'news', 'index.json');
  const editionContent = stableJson(briefing);
  let duplicate = false;
  if (fs.existsSync(editionPath)) {
    const existingContent = fs.readFileSync(editionPath, 'utf8');
    if (existingContent !== editionContent) {
      throw new Error(`Revision collision: ${path.relative(rootDir, editionPath)} already exists with different content`);
    }
    duplicate = true;
  }
  const updatedIndex = buildUpdatedIndex(index, briefing);
  return {
    rootDir,
    briefing,
    duplicate,
    editionPath,
    editionContent,
    indexPath,
    previousIndexContent: fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null,
    indexContent: stableJson(updatedIndex),
    editionExisted: fs.existsSync(editionPath)
  };
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function applyImportPlan(plan) {
  if (!plan.editionExisted) atomicWrite(plan.editionPath, plan.editionContent);
  atomicWrite(plan.indexPath, plan.indexContent);
  return plan;
}

function rollbackImportPlan(plan) {
  if (!plan.editionExisted && fs.existsSync(plan.editionPath)) fs.unlinkSync(plan.editionPath);
  if (plan.previousIndexContent === null) {
    if (fs.existsSync(plan.indexPath)) fs.unlinkSync(plan.indexPath);
  } else {
    atomicWrite(plan.indexPath, plan.previousIndexContent);
  }
}

function loadEdition(rootDir, relativePath) {
  if (typeof relativePath !== 'string' || !/^data\/\d{4}-\d{2}-\d{2}\/r\d+\.json$/.test(relativePath)) {
    throw new Error(`Unsafe news data path: ${relativePath}`);
  }
  const filePath = path.join(rootDir, 'news', relativePath);
  const briefing = readJson(filePath, `news/${relativePath}`);
  validateBriefing(briefing);
  return briefing;
}

module.exports = {
  CATEGORIES,
  EMPTY_INDEX,
  SCHEMA_VERSION,
  TIMEZONE,
  applyImportPlan,
  buildUpdatedIndex,
  loadEdition,
  loadNewsIndex,
  localDate,
  planImport,
  readJson,
  rollbackImportPlan,
  stableJson,
  validateBriefing,
  validateSafeSourceUrl
};
