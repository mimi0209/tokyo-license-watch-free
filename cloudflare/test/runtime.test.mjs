import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

// Use the engine bundled with the pinned deployment tool, avoiding version drift.
const require = createRequire(import.meta.url);
const engine = createRequire(require.resolve('wrangler'))('miniflare');
const source = await readFile(new URL('../worker.mjs', import.meta.url), 'utf8');
const repo = 'example-owner/tokyo-license-watch-free';
const root = '/repos/' + repo;
const dispatch = root + '/actions/workflows/monitor.yml/dispatches';
const bindings = {GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'unit-test-token-not-real', ENABLE_MONITOR: 'true'};
const event = {cron: '*/5 * * * *', scheduledTime: new Date('2026-11-06T00:00:00Z')};

function harness(script = source, {redirect = false, enabled = 'true'} = {}) {
  const calls = [];
  // All outbound requests terminate here. The runtime tests cannot reach the Internet.
  const outboundService = async request => {
    const url = new URL(request.url);
    calls.push({url, method: request.method, authorization: request.headers.get('authorization'),
      body: request.method === 'POST' ? await request.text() : null});
    if (url.origin !== 'https://api.github.com') return new Response('unexpected host', {status: 500});
    if (url.pathname === root && request.method === 'GET') {
      return Response.json({private: false, visibility: 'public', full_name: repo});
    }
    if (url.pathname === dispatch && request.method === 'POST') {
      if (redirect) return new Response(null, {status: 302, headers: {Location: 'https://token-capture.invalid/steal'}});
      return Response.json({workflow_run_id: 12345, run_url: 'https://api.github.com' + root + '/actions/runs/12345'});
    }
    return new Response('unexpected endpoint', {status: 500});
  };
  const options = {modules: true, script, compatibilityDate: '2026-01-01', bindings: {...bindings, ENABLE_MONITOR: enabled}, outboundService, cf: false};
  // Miniflare v5 supplies an explicit converter for the v4 options shape.
  const mf = new engine.Miniflare(engine.convertV4MiniflareOptions ? engine.convertV4MiniflareOptions(options) : options);
  return {mf, calls};
}

test('pre-fix redirect:error reproduces a runtime failure before any GitHub request', async () => {
  assert.ok(source.includes("redirect: 'manual'"));
  const h = harness(source.replace("redirect: 'manual'", "redirect: 'error'"));
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'exception');
    assert.equal(h.calls.length, 0);
  } finally { await h.mf.dispose(); }
});

test('real Workers scheduled handler checks public visibility and dispatches a scan', async () => {
  const h = harness();
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'ok');
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls.map(x => x.method), ['GET', 'POST']);
    for (const call of h.calls) assert.equal(call.authorization, 'Bearer ' + bindings.GITHUB_TOKEN);
    assert.deepEqual(JSON.parse(h.calls[1].body), {ref: 'main', inputs: {
      mode: 'scan', source: 'cloud-timer', scheduled_at: '2026-11-06T00:00:00.000Z'
    }});
  } finally { await h.mf.dispose(); }
});

test('real Workers fetch never follows a GitHub redirect to another host', async () => {
  const h = harness(source, {redirect: true});
  try {
    const worker = await h.mf.getWorker();
    const result = await worker.scheduled(event);
    assert.equal(result.outcome, 'exception');
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(x => x.url.origin === 'https://api.github.com'));
  } finally { await h.mf.dispose(); }
});

test('real Workers midnight scan survives a paused monitor and dispatches only once', async () => {
  const h = harness(source, {enabled: 'false'});
  try {
    const worker = await h.mf.getWorker();
    const runAt = iso => worker.scheduled({...event, scheduledTime: new Date(iso)});
    assert.equal((await runAt('2026-11-06T14:55:08.039Z')).outcome, 'ok');
    assert.equal(h.calls.length, 0);
    assert.equal((await runAt('2026-11-06T15:00:08.039Z')).outcome, 'ok');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls.filter(x => x.method === 'POST').length, 1);
    assert.equal(JSON.parse(h.calls[1].body).inputs.scheduled_at, '2026-11-06T15:00:08.039Z');
    assert.equal((await runAt('2026-11-06T15:05:08.039Z')).outcome, 'ok');
    assert.equal(h.calls.length, 2);
  } finally { await h.mf.dispose(); }
});
