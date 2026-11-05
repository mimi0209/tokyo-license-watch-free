import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

// Use the engine bundled with the pinned deployment tool, avoiding version drift.
const require = createRequire(import.meta.url);
const {Miniflare, createFetchMock} = createRequire(require.resolve('wrangler'))('miniflare');
const source = await readFile(new URL('../worker.mjs', import.meta.url), 'utf8');
const repo = 'example-owner/tokyo-license-watch-free';
const root = '/repos/' + repo;
const dispatch = root + '/actions/workflows/monitor.yml/dispatches';
const bindings = {GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'unit-test-token-not-real', ENABLE_MONITOR: 'true'};
const event = {cron: '*/5 * * * *', scheduledTime: new Date('2026-11-06T00:00:00Z')};

function harness(script = source, {redirect = false} = {}) {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const origin = fetchMock.get('https://api.github.com');
  origin.intercept({method: 'GET', path: root}).reply(200, {
    private: false, visibility: 'public', full_name: repo
  });
  const body = JSON.stringify({ref: 'main', inputs: {
    mode: 'scan', source: 'cloud-timer', scheduled_at: '2026-11-06T00:00:00.000Z'
  }});
  const post = origin.intercept({method: 'POST', path: dispatch, body});
  let otherHostRequests = 0;
  if (redirect) {
    post.reply(302, '', {headers: {Location: 'https://token-capture.invalid/steal'}});
    fetchMock.get('https://token-capture.invalid').intercept({method: 'GET', path: '/steal'}).reply(() => {
      otherHostRequests++;
      return {statusCode: 200, data: 'must never be requested'};
    });
  } else {
    post.reply(200, {workflow_run_id: 12345, run_url: 'https://api.github.com' + root + '/actions/runs/12345'});
  }
  const mf = new Miniflare({modules: true, script, compatibilityDate: '2026-01-01', bindings, fetchMock, cf: false});
  return {mf, fetchMock, otherHostRequests: () => otherHostRequests};
}

test('pre-fix redirect:error reproduces a runtime failure before any GitHub request', async () => {
  assert.ok(source.includes("redirect: 'manual'"));
  const h = harness(source.replace("redirect: 'manual'", "redirect: 'error'"));
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'exception');
    assert.equal(h.fetchMock.pendingInterceptors().length, 2);
  } finally { await h.mf.dispose(); }
});

test('real Workers scheduled handler checks public visibility and dispatches a scan', async () => {
  const h = harness();
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'ok');
    h.fetchMock.assertNoPendingInterceptors();
  } finally { await h.mf.dispose(); }
});

test('real Workers fetch never follows a GitHub redirect to another host', async () => {
  const h = harness(source, {redirect: true});
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'exception');
    assert.equal(h.otherHostRequests(), 0);
    assert.equal(h.fetchMock.pendingInterceptors().filter(x => x.origin === 'https://api.github.com').length, 0);
  } finally { await h.mf.dispose(); }
});
