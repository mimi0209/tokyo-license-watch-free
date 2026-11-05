import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {dispatchScan} from '../worker.mjs';

const repo = 'example-owner/tokyo-license-watch-free';
const env = {GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'unit-test-token-not-real', ENABLE_MONITOR: 'true'};
const eventAt = iso => ({cron: '*/5 * * * *', scheduledTime: Date.parse(iso)});
function mockGitHub({metadata = {private: false, visibility: 'public', full_name: repo}, metadataStatus = 200, dispatchStatus = 200, receipt = {workflow_run_id: 12345, run_url: 'https://api.github.com/repos/' + repo + '/actions/runs/12345'}} = {}) {
  const calls = [];
  return {calls, request: async (url, options) => {
    calls.push({url, options});
    if (calls.length === 1) return new Response(JSON.stringify(metadata), {status: metadataStatus});
    return new Response(dispatchStatus === 204 ? null : dispatchStatus === 200 ? JSON.stringify(receipt) : 'response bodies must not appear in errors', {status: dispatchStatus});
  }};
}

test('five-minute event dispatches only scan, using a scoped fixed GitHub endpoint', async () => {
  const mock = mockGitHub();
  const result = await dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, mock.request);
  assert.equal(result.accepted, true);
  assert.equal(result.runId, 12345);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].url, 'https://api.github.com/repos/' + repo);
  assert.equal(mock.calls[1].url, 'https://api.github.com/repos/' + repo + '/actions/workflows/monitor.yml/dispatches');
  assert.deepEqual(JSON.parse(mock.calls[1].options.body), {ref: 'main', inputs: {mode: 'scan', source: 'cloud-timer', scheduled_at: '2026-11-05T08:30:00.000Z'}});
  for (const {options} of mock.calls) {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer ' + env.GITHUB_TOKEN);
    assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
  }
});

test('disabled regular monitoring makes no GitHub request', async () => {
  let calls = 0;
  const result = await dispatchScan(eventAt('2026-11-05T14:55:00Z'), {...env, ENABLE_MONITOR: 'false'}, async () => { calls++; });
  assert.equal(result.accepted, false);
  assert.equal(calls, 0);
});

test('00:00 Japan remains one check when regular monitoring is disabled', async () => {
  const mock = mockGitHub();
  const result = await dispatchScan(eventAt('2026-11-05T15:00:00Z'), {...env, ENABLE_MONITOR: 'false'}, mock.request);
  assert.equal(result.accepted, true);
  assert.equal(mock.calls.length, 2);
  const next = await dispatchScan(eventAt('2026-11-05T15:05:00Z'), {...env, ENABLE_MONITOR: 'false'}, async () => { throw Error('must not call'); });
  assert.equal(next.accepted, false);
});

test('a private or internal repository is rejected before launching Actions', async () => {
  for (const metadata of [
    {private: true, visibility: 'private', full_name: repo},
    {private: false, visibility: 'internal', full_name: repo},
    {private: false, visibility: 'public', full_name: 'another-owner/another-repo'},
    {visibility: 'public', full_name: repo}
  ]) {
    const mock = mockGitHub({metadata});
    await assert.rejects(dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, mock.request), /must be public/);
    assert.equal(mock.calls.length, 1);
  }
});

test('invalid or incomplete configuration fails before network access', async () => {
  for (const change of [{GITHUB_REPOSITORY: ''}, {GITHUB_REPOSITORY: 'https://untrusted.invalid/x'}, {GITHUB_REPOSITORY: 'owner/..'}, {GITHUB_TOKEN: ''}]) {
    let calls = 0;
    await assert.rejects(dispatchScan(eventAt('2026-11-05T08:30:00Z'), {...env, ...change}, async () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test('unexpected schedule or invalid time never launches Actions', async () => {
  for (const event of [{cron: '* * * * *', scheduledTime: Date.now()}, {cron: '*/5 * * * *', scheduledTime: NaN}]) {
    let calls = 0;
    await assert.rejects(dispatchScan(event, env, async () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test('GitHub refusals are reported without relaying response bodies', async () => {
  const metadataFailure = mockGitHub({metadataStatus: 403});
  await assert.rejects(dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, metadataFailure.request), {message: 'GitHub repository check failed: HTTP 403'});
  assert.equal(metadataFailure.calls.length, 1);
  const dispatchFailure = mockGitHub({dispatchStatus: 422});
  await assert.rejects(dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, dispatchFailure.request), {message: 'GitHub dispatch failed: HTTP 422'});
});

test('network failures do not leak a token embedded in an upstream exception', async () => {
  let failure;
  try {
    await dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, async () => { throw Error(env.GITHUB_TOKEN); });
  } catch (error) { failure = error; }
  assert.equal(failure.message, 'GitHub request failed before a response.');
  assert.ok(!failure.message.includes(env.GITHUB_TOKEN));
});

test('public HTTP endpoint cannot launch a scan or return configuration', async () => {
  const response = await worker.fetch(new Request('https://example.invalid/'), env);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not found');
});

test('scheduled handler waits for the API request to finish', async () => {
  const mock = mockGitHub();
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs = [];
  globalThis.fetch = mock.request;
  console.log = line => logs.push(line);
  try { await worker.scheduled(eventAt('2026-11-05T08:30:00Z'), env); }
  finally { globalThis.fetch = originalFetch; console.log = originalLog; }
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(JSON.parse(logs[0]), {event: 'DISPATCH_ACCEPTED', scheduledAt: '2026-11-05T08:30:00.000Z', runId: 12345});
  assert.ok(!logs.join('').includes(env.GITHUB_TOKEN));
});

test('200 response with an invalid run receipt is rejected', async () => {
  for (const receipt of [{}, {workflow_run_id: -1}, {workflow_run_id: 12345, run_url: 'https://untrusted.invalid/12345'}]) {
    const mock = mockGitHub({receipt});
    await assert.rejects(dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, mock.request), {message: 'Invalid GitHub dispatch receipt.'});
  }
});

test('legacy 204 acceptance is distinguished from a completed scan', async () => {
  const mock = mockGitHub({dispatchStatus: 204});
  const result = await dispatchScan(eventAt('2026-11-05T08:30:00Z'), env, mock.request);
  assert.deepEqual(result, {accepted: true, scheduledAt: '2026-11-05T08:30:00.000Z', runId: null});
});

test('repository case differences use the canonical name returned by GitHub', async () => {
  const mock = mockGitHub();
  const result = await dispatchScan(eventAt('2026-11-05T08:30:00Z'), {...env, GITHUB_REPOSITORY: repo.toUpperCase()}, mock.request);
  assert.equal(result.runId, 12345);
  assert.equal(mock.calls[1].url, 'https://api.github.com/repos/' + repo + '/actions/workflows/monitor.yml/dispatches');
});
