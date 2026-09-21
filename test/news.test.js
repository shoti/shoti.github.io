'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  applyImportPlan,
  loadNewsIndex,
  localDate,
  planImport,
  readJson,
  validateBriefing
} = require('../lib/news');
const { closeIssues } = require('../scripts/close-news-issues');
const {
  MAX_QUEUED_ISSUES,
  boundedImportableIssues,
  collectIssues,
  filterImportable
} = require('../scripts/collect-news-issues');
const { authorizeIssueEvent, extractPayload } = require('../scripts/extract-news-issue');
const { publishBriefing, publishBriefings } = require('../scripts/publish-news');
const { payloadDigest, recordAuthorization } = require('../scripts/record-news-authorization');

const repositoryRoot = path.join(__dirname, '..');
const examplePath = path.join(repositoryRoot, 'news', 'examples', 'briefing.example.json');
const fixture = readJson(examplePath, 'fictional news fixture');
const taskPrompt = fs.readFileSync(path.join(repositoryRoot, 'news', 'CHATGPT_TASK_PROMPT.md'), 'utf8');

assert.match(taskPrompt, /especially demanding, constructive scrutiny to Georgia's current ruling/);
assert.match(taskPrompt, /those\s+who hold state power deserve the closest accountability reporting/);
assert.match(taskPrompt, /reasonable classical-liberal or libertarian perspective/);
assert.match(taskPrompt, /do not let the perspective outrun the facts/);
assert.match(taskPrompt, /A little dry, gentle humor is welcome/);

assert.doesNotThrow(() => validateBriefing(structuredClone(fixture)));
assert.strictEqual(localDate('2026-09-20T19:59:59Z'), '2026-09-20');
assert.strictEqual(localDate('2026-09-20T20:00:00Z'), '2026-09-21');

const wrongTbilisiDate = structuredClone(fixture);
wrongTbilisiDate.generated_at = '2026-09-20T23:59:00-04:00';
assert.throws(() => validateBriefing(wrongTbilisiDate), /must match generated_at in Asia\/Tbilisi for revision 1/);

const laterCorrection = structuredClone(fixture);
laterCorrection.revision = 2;
laterCorrection.corrects_revision = 1;
laterCorrection.generated_at = '2026-09-21T12:00:00+04:00';
assert.doesNotThrow(() => validateBriefing(laterCorrection));

for (const invalidTimestamp of [
  '2026-02-30T10:00:00+04:00',
  '2026-09-20T24:00:00+04:00',
  '2026-09-20T20:00:00+14:30'
]) {
  const invalid = structuredClone(fixture);
  invalid.stories[0].event_at = invalidTimestamp;
  assert.throws(() => validateBriefing(invalid), /real calendar date and time|invalid UTC offset/);
}

const duplicateStories = structuredClone(fixture);
duplicateStories.stories.push({ ...structuredClone(fixture.stories[0]), importance: 2 });
assert.throws(() => validateBriefing(duplicateStories), /duplicates story ID/);

const unexpectedCriticalTopic = structuredClone(fixture);
unexpectedCriticalTopic.stories[0].category = 'space-weather';
assert.doesNotThrow(() => validateBriefing(unexpectedCriticalTopic));
const invalidCategory = structuredClone(fixture);
invalidCategory.stories[0].category = 'Space weather';
assert.throws(() => validateBriefing(invalidCategory), /lowercase hyphenated slug/);

const missingSources = structuredClone(fixture);
missingSources.stories[0].sources = [];
assert.throws(() => validateBriefing(missingSources), /must contain 1-8 sources/);

for (const unsafeUrl of [
  'http://example.com/story',
  'javascript:alert(1)',
  'https://localhost/story',
  'https://127.0.0.1/story',
  'https://user:password@example.com/story'
]) {
  const unsafe = structuredClone(fixture);
  unsafe.stories[0].sources[0].url = unsafeUrl;
  assert.throws(() => validateBriefing(unsafe), /must use https|valid absolute URL|local host|IP literal|credentials/);
}

const unsupportedClaim = structuredClone(fixture);
unsupportedClaim.stories[0].sources[0].supports = ['summary'];
assert.throws(() => validateBriefing(unsupportedClaim), /must support why_it_matters/);

const event = {
  issue: { user: { login: 'connected-news-bot[bot]' }, body: JSON.stringify(fixture) },
  sender: { login: 'connected-news-bot[bot]' }
};
assert.strictEqual(authorizeIssueEvent(event, 'shoti, connected-news-bot[bot]'), 'connected-news-bot[bot]');
assert.throws(() => authorizeIssueEvent(event, 'shoti'), /Unauthorized news submission/);
assert.throws(() => authorizeIssueEvent({ ...event, sender: { login: 'someone-else' } }, 'connected-news-bot[bot]'), /do not match/);
assert.deepStrictEqual(extractPayload('```json\n' + JSON.stringify(fixture) + '\n```'), fixture);
assert.throws(() => extractPayload('please publish\n```json\n{}\n```'), /exactly one fenced json block/);

const queuedCorrection = structuredClone(fixture);
queuedCorrection.revision = 2;
queuedCorrection.corrects_revision = 1;
queuedCorrection.generated_at = '2026-09-20T20:30:00+04:00';
const queuedIssues = [[{
  number: 12,
  title: '[news] 2026-09-20 r2',
  body: JSON.stringify(queuedCorrection),
  user: { login: 'connected-news-bot[bot]' }
}, {
  number: 11,
  title: '[news] 2026-09-20 r1',
  body: JSON.stringify(fixture),
  user: { login: 'connected-news-bot[bot]' }
}, {
  number: 10,
  title: '[news] unauthorized',
  body: JSON.stringify(fixture),
  user: { login: 'someone-else' }
}, {
  number: 9,
  title: '[news] pull request',
  body: JSON.stringify(fixture),
  user: { login: 'connected-news-bot[bot]' },
  pull_request: {}
}]];
const authorizationComments = [[11, fixture], [12, queuedCorrection]].map(([number, payload]) => ({
  user: { login: 'github-actions[bot]' },
  issue_url: `https://api.github.com/repos/shoti/shoti.github.io/issues/${number}`,
  body: `<!-- news-payload-authorization sha256=${payloadDigest(JSON.stringify(payload))} -->`
}));
const collected = collectIssues(queuedIssues, authorizationComments, 'connected-news-bot[bot]');
assert.deepStrictEqual(collected.map(item => item.number), [11, 12]);
assert.strictEqual(collected[0].digest, payloadDigest(JSON.stringify(fixture)));
const editedQueue = structuredClone(queuedIssues);
editedQueue[0][1].body = JSON.stringify({ ...fixture, introduction: fixture.introduction + ' შეცვლილია.' });
assert.deepStrictEqual(
  collectIssues(editedQueue, authorizationComments, 'connected-news-bot[bot]').map(item => item.number),
  [12]
);

const authorizationCalls = [];
const authorizationEventRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'news-authorization-test-'));
try {
  const authorizationEventPath = path.join(authorizationEventRoot, 'event.json');
  fs.writeFileSync(authorizationEventPath, JSON.stringify({ issue: { number: 11, body: JSON.stringify(fixture) } }));
  recordAuthorization(authorizationEventPath, 'shoti/shoti.github.io', (command, args) => {
    authorizationCalls.push({ command, args });
    return { status: 0 };
  });
  assert.strictEqual(authorizationCalls[0].command, 'gh');
  assert.ok(authorizationCalls[0].args.includes('state=open'));
  assert.match(authorizationCalls[1].args.at(-1), new RegExp(payloadDigest(JSON.stringify(fixture))));
} finally {
  fs.rmSync(authorizationEventRoot, { recursive: true, force: true });
}

const closeManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'news-close-test-'));
try {
  const closeManifest = path.join(closeManifestRoot, 'manifest.json');
  const originalBody = JSON.stringify(fixture);
  fs.writeFileSync(closeManifest, JSON.stringify([{
    number: 11,
    digest: payloadDigest(originalBody),
    path: '/tmp/ignored.json'
  }]));
  const closeCalls = [];
  closeIssues(closeManifest, 'shoti/shoti.github.io', (command, args) => {
    closeCalls.push({ command, args });
    if (!args.includes('--method')) {
      return { status: 0, stdout: JSON.stringify({ body: originalBody, state: 'open' }) };
    }
    return { status: 0, stdout: JSON.stringify({ body: originalBody, state: 'closed' }) };
  });
  assert.strictEqual(closeCalls.length, 2);
  assert.deepStrictEqual(closeCalls[1], {
      command: 'gh',
      args: ['api', '--method', 'PATCH', 'repos/shoti/shoti.github.io/issues/11', '-f', 'state=closed', '-f', 'state_reason=completed']
  });

  const editedCalls = [];
  closeIssues(closeManifest, 'shoti/shoti.github.io', (command, args) => {
    editedCalls.push({ command, args });
    return { status: 0, stdout: JSON.stringify({ body: `${originalBody} edited`, state: 'open' }) };
  });
  assert.strictEqual(editedCalls.length, 1);

  const changedDuringCloseCalls = [];
  const changedBody = `${originalBody} edited during close`;
  closeIssues(closeManifest, 'shoti/shoti.github.io', (command, args) => {
    changedDuringCloseCalls.push({ command, args });
    if (!args.includes('--method')) {
      return { status: 0, stdout: JSON.stringify({ body: originalBody, state: 'open' }) };
    }
    if (args.includes('state=closed')) {
      return { status: 0, stdout: JSON.stringify({ body: changedBody, state: 'closed' }) };
    }
    return { status: 0, stdout: JSON.stringify({ body: changedBody, state: 'open' }) };
  });
  assert.strictEqual(changedDuringCloseCalls.length, 3);
  assert.ok(changedDuringCloseCalls[2].args.includes('state=open'));
} finally {
  fs.rmSync(closeManifestRoot, { recursive: true, force: true });
}

function makeRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'news'), { recursive: true });
  fs.writeFileSync(path.join(root, 'news', 'index.json'), JSON.stringify({
    schema_version: 1,
    latest: null,
    editions: []
  }, null, 2) + '\n');
  return root;
}

const importRoot = makeRoot('news-import-test-');
try {
  const firstPlan = planImport(importRoot, structuredClone(fixture));
  assert.strictEqual(firstPlan.duplicate, false);
  applyImportPlan(firstPlan);
  const firstIndex = loadNewsIndex(importRoot);
  assert.strictEqual(firstIndex.latest.edition_date, fixture.edition_date);
  assert.strictEqual(firstIndex.editions[0].revisions.length, 1);

  const retryPlan = planImport(importRoot, structuredClone(fixture));
  assert.strictEqual(retryPlan.duplicate, true);
  applyImportPlan(retryPlan);
  assert.strictEqual(loadNewsIndex(importRoot).editions[0].revisions.length, 1);

  const collision = structuredClone(fixture);
  collision.introduction += ' შეცვლილი ტექსტი.';
  assert.throws(() => planImport(importRoot, collision), /Revision collision/);

  const correction = structuredClone(fixture);
  correction.revision = 2;
  correction.corrects_revision = 1;
  correction.generated_at = '2026-09-20T20:22:00+04:00';
  correction.introduction += ' შესწორებულ ვერსიაში დამატებულია დაზუსტება.';
  applyImportPlan(planImport(importRoot, correction));
  const correctedIndex = loadNewsIndex(importRoot);
  assert.strictEqual(correctedIndex.latest.revision, 2);
  assert.deepStrictEqual(correctedIndex.editions[0].revisions.map(item => item.revision), [1, 2]);

  const skippedCorrection = structuredClone(correction);
  skippedCorrection.revision = 4;
  skippedCorrection.corrects_revision = 3;
  assert.throws(() => planImport(importRoot, skippedCorrection), /skips revision 3/);

  const collisionPayload = structuredClone(fixture);
  collisionPayload.introduction += ' განსხვავებული შინაარსი.';
  const nextEdition = structuredClone(fixture);
  nextEdition.edition_date = '2026-09-21';
  nextEdition.briefing_id = 'example-2026-09-21-evening';
  nextEdition.generated_at = '2026-09-21T20:12:00+04:00';
  nextEdition.coverage = { start: fixture.coverage.end, end: '2026-09-21T20:00:00+04:00' };
  const eligible = filterImportable([
    { number: 20, payload: collisionPayload },
    { number: 21, payload: nextEdition }
  ], importRoot);
  assert.deepStrictEqual(eligible.map(item => item.number), [21]);
} finally {
  fs.rmSync(importRoot, { recursive: true, force: true });
}

const rollbackRoot = makeRoot('news-rollback-test-');
const rollbackPayloadPath = path.join(rollbackRoot, 'payload.json');
fs.writeFileSync(rollbackPayloadPath, JSON.stringify(fixture));
try {
  const previousIndex = fs.readFileSync(path.join(rollbackRoot, 'news', 'index.json'), 'utf8');
  let buildCalls = 0;
  assert.throws(() => publishBriefing(rollbackPayloadPath, rollbackRoot, () => {
    buildCalls += 1;
    return { status: buildCalls === 1 ? 1 : 0 };
  }), /restored to the previous edition/);
  assert.strictEqual(buildCalls, 2);
  assert.strictEqual(fs.readFileSync(path.join(rollbackRoot, 'news', 'index.json'), 'utf8'), previousIndex);
  assert.strictEqual(fs.existsSync(path.join(rollbackRoot, 'news', 'data', fixture.edition_date, 'r1.json')), false);
} finally {
  fs.rmSync(rollbackRoot, { recursive: true, force: true });
}

const queueIsolationRoot = makeRoot('news-queue-isolation-test-');
try {
  const conflict = structuredClone(fixture);
  conflict.introduction += ' განსხვავებული შინაარსი.';
  const next = structuredClone(fixture);
  next.edition_date = '2026-09-21';
  next.briefing_id = 'example-2026-09-21-evening';
  next.generated_at = '2026-09-21T20:12:00+04:00';
  next.coverage = { start: fixture.coverage.end, end: '2026-09-21T20:00:00+04:00' };
  const isolated = filterImportable([
    { number: 30, payload: fixture },
    { number: 31, payload: conflict },
    { number: 32, payload: next }
  ], queueIsolationRoot);
  assert.deepStrictEqual(isolated.map(item => item.number), [30, 32]);
} finally {
  fs.rmSync(queueIsolationRoot, { recursive: true, force: true });
}

const staleQueueRoot = makeRoot('news-stale-queue-test-');
try {
  applyImportPlan(planImport(staleQueueRoot, structuredClone(fixture)));
  const staleIssues = Array.from({ length: MAX_QUEUED_ISSUES }, (_, index) => {
    const collision = structuredClone(fixture);
    collision.introduction += ` განსხვავებული შინაარსი ${index}.`;
    return {
      number: 100 + index,
      title: `[news] stale collision ${index}`,
      body: JSON.stringify(collision),
      user: { login: 'connected-news-bot[bot]' }
    };
  });
  const next = structuredClone(fixture);
  next.edition_date = '2026-09-21';
  next.briefing_id = 'example-2026-09-21-evening';
  next.generated_at = '2026-09-21T20:12:00+04:00';
  next.coverage = { start: fixture.coverage.end, end: '2026-09-21T20:00:00+04:00' };
  staleIssues.push({
    number: 200,
    title: '[news] 2026-09-21 r1',
    body: JSON.stringify(next),
    user: { login: 'connected-news-bot[bot]' }
  });
  const staleComments = staleIssues.map(issue => ({
    user: { login: 'github-actions[bot]' },
    issue_url: `https://api.github.com/repos/shoti/shoti.github.io/issues/${issue.number}`,
    body: `<!-- news-payload-authorization sha256=${payloadDigest(issue.body)} -->`
  }));
  const originalWarn = console.warn;
  console.warn = () => {};
  let recovered;
  try {
    recovered = boundedImportableIssues(
      collectIssues(staleIssues, staleComments, 'connected-news-bot[bot]'),
      staleQueueRoot
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepStrictEqual(recovered.map(item => item.number), [200]);
} finally {
  fs.rmSync(staleQueueRoot, { recursive: true, force: true });
}

const boundedQueueRoot = makeRoot('news-bounded-queue-test-');
try {
  const importable = Array.from({ length: MAX_QUEUED_ISSUES + 1 }, (_, index) => {
    const payload = structuredClone(fixture);
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    payload.edition_date = date;
    payload.briefing_id = `${date}-evening`;
    payload.generated_at = `${date}T20:00:00+04:00`;
    payload.coverage = {
      start: `${date}T18:00:00+04:00`,
      end: `${date}T19:59:00+04:00`
    };
    return { number: 300 + index, payload };
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.throws(
      () => boundedImportableIssues(importable, boundedQueueRoot),
      /Refusing to process more than 50 importable news issues/
    );
  } finally {
    console.warn = originalWarn;
  }
} finally {
  fs.rmSync(boundedQueueRoot, { recursive: true, force: true });
}

const batchRollbackRoot = makeRoot('news-batch-rollback-test-');
try {
  const firstPath = path.join(batchRollbackRoot, 'first.json');
  const secondPath = path.join(batchRollbackRoot, 'second.json');
  fs.writeFileSync(firstPath, JSON.stringify(fixture));
  fs.writeFileSync(secondPath, JSON.stringify(queuedCorrection));
  let batchBuildCalls = 0;
  assert.throws(() => publishBriefings([firstPath, secondPath], batchRollbackRoot, () => {
    batchBuildCalls += 1;
    return { status: batchBuildCalls === 1 ? 1 : 0 };
  }), /restored to the previous edition/);
  assert.deepStrictEqual(loadNewsIndex(batchRollbackRoot), { schema_version: 1, latest: null, editions: [] });
  assert.strictEqual(fs.existsSync(path.join(batchRollbackRoot, 'news', 'data', fixture.edition_date, 'r1.json')), false);
  assert.strictEqual(fs.existsSync(path.join(batchRollbackRoot, 'news', 'data', fixture.edition_date, 'r2.json')), false);
} finally {
  fs.rmSync(batchRollbackRoot, { recursive: true, force: true });
}

const partialWriteRoot = makeRoot('news-partial-write-test-');
const partialPayloadPath = path.join(partialWriteRoot, 'payload.json');
fs.writeFileSync(partialPayloadPath, JSON.stringify(fixture));
try {
  const originalRename = fs.renameSync;
  let shouldFail = true;
  fs.renameSync = function (source, destination) {
    if (shouldFail && destination === path.join(partialWriteRoot, 'news', 'index.json')) {
      shouldFail = false;
      throw new Error('simulated index write failure');
    }
    return originalRename.apply(this, arguments);
  };
  try {
    assert.throws(() => publishBriefing(partialPayloadPath, partialWriteRoot, () => ({ status: 0 })), /restored/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.strictEqual(fs.existsSync(path.join(partialWriteRoot, 'news', 'data', fixture.edition_date, 'r1.json')), false);
  assert.deepStrictEqual(loadNewsIndex(partialWriteRoot), { schema_version: 1, latest: null, editions: [] });
} finally {
  fs.rmSync(partialWriteRoot, { recursive: true, force: true });
}

const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'news-site-build-test-'));
try {
  fs.cpSync(repositoryRoot, buildRoot, {
    recursive: true,
    filter: source => !['.git', 'dist', 'node_modules'].includes(path.basename(source))
  });
  fs.rmSync(path.join(buildRoot, 'news', 'data'), { recursive: true, force: true });
  fs.writeFileSync(path.join(buildRoot, 'news', 'index.json'), JSON.stringify({
    schema_version: 1,
    latest: null,
    editions: []
  }, null, 2) + '\n');
  const copiedFixture = readJson(path.join(buildRoot, 'news', 'examples', 'briefing.example.json'));
  applyImportPlan(planImport(buildRoot, copiedFixture));
  const correction = structuredClone(copiedFixture);
  correction.revision = 2;
  correction.corrects_revision = 1;
  correction.generated_at = '2026-09-20T20:30:00+04:00';
  correction.stories[0].category = 'space-weather';
  correction.stories[0].headline += ' — შესწორებული და განზრახ ძალიან გრძელი ქართული სათაური მობილური განლაგების შესამოწმებლად';
  applyImportPlan(planImport(buildRoot, correction));

  const result = spawnSync(process.execPath, ['build.js'], { cwd: buildRoot, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const latest = fs.readFileSync(path.join(buildRoot, 'dist', 'news', 'index.html'), 'utf8');
  const dated = fs.readFileSync(path.join(buildRoot, 'dist', 'news', fixture.edition_date, 'index.html'), 'utf8');
  const archive = fs.readFileSync(path.join(buildRoot, 'dist', 'news', 'archive', 'index.html'), 'utf8');
  assert.match(latest, /<html lang="ka">/);
  assert.match(latest, /შესწორებული და განზრახ ძალიან გრძელი ქართული სათაური/);
  assert.match(latest, /თუ მხოლოდ ერთი წუთი გაქვთ/);
  assert.match(latest, /მნიშვნელოვანი ამბავი/);
  assert.match(latest, /href="#fictional-public-service-update"/);
  assert.match(latest, /<a class="news-story-nav-contents" href="#news-contents-title">\[სარჩევი\]<\/a>/);
  assert.doesNotMatch(latest, /class="news-rail"/);
  assert.match(latest, /https:\/\/example\.com\/fictional-news-fixture/);
  assert.doesNotMatch(latest, /&lt;article class=&quot;news-story&quot;/);
  assert.match(dated, /<link rel="canonical" href="https:\/\/shoti\.github\.io\/news\/2026-09-20\/">/);
  assert.match(dated, /განახლებების ისტორია \(2\)/);
  assert.match(dated, /\/news\/2026-09-20\/revisions\/1\//);
  assert.match(archive, /href="\/news\/2026-09-20\/"/);
  assert.ok(fs.existsSync(path.join(buildRoot, 'dist', 'news', '2026-09-20', 'revisions', '1', 'index.html')));
  assert.ok(fs.existsSync(path.join(buildRoot, 'dist', 'news', 'data', '2026-09-20', 'r2.json')));
  const publicFeed = JSON.parse(fs.readFileSync(path.join(buildRoot, 'dist', 'news', 'feed.json'), 'utf8'));
  assert.strictEqual(publicFeed.latest.revision, 2);
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}

console.log('News tests passed');
