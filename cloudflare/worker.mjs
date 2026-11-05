const API = 'https://api.github.com';
const FIVE_MINUTES = '*/5 * * * *';

function configuration(env) {
  const repository = String(env.GITHUB_REPOSITORY || '').trim();
  const match = repository.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/);
  if (!match || ['.', '..'].includes(match[2])) throw new Error('GITHUB_REPOSITORY must be owner/repository.');
  const token = String(env.GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('GITHUB_TOKEN secret is missing.');
  return {repository, owner: match[1], name: match[2], token};
}

async function githubRequest(url, options, request) {
  let response;
  try {
    // Workers supports manual/follow, but rejects redirect: 'error' before sending.
    response = await request(url, {...options, redirect: 'manual', signal: AbortSignal.timeout(15000)});
  } catch (error) {
    // Only expose known error categories. Upstream messages may contain credentials.
    const type = ['TypeError', 'TimeoutError', 'AbortError'].includes(error?.name) ? ' (' + error.name + ')' : '';
    throw new Error('GitHub request failed before a response' + type + '.');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error('GitHub redirect blocked: HTTP ' + response.status);
  }
  return response;
}

export async function dispatchScan(event, env, request = (url, options) => globalThis.fetch(url, options)) {
  if (event.cron !== FIVE_MINUTES) throw new Error('Unexpected cron expression; use */5 * * * *.');
  if (!Number.isFinite(event.scheduledTime)) throw new Error('Scheduled time is missing.');
  const time = new Date(event.scheduledTime);
  if (Number.isNaN(time.getTime())) throw new Error('Scheduled time is invalid.');
  const scheduledAt = time.toISOString();
  const midnightJapan = time.getUTCHours() === 15 && time.getUTCMinutes() === 0;
  if (env.ENABLE_MONITOR !== 'true' && !midnightJapan) return {accepted: false, reason: 'disabled', scheduledAt};

  const {repository, owner, name, token} = configuration(env);
  let root = API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name);
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'tokyo-license-watch-timer'
  };
  const metadataResponse = await githubRequest(root, {headers}, request);
  if (!metadataResponse.ok) throw new Error('GitHub repository check failed: HTTP ' + metadataResponse.status);
  let metadata;
  try { metadata = await metadataResponse.json(); }
  catch { throw new Error('Invalid GitHub repository metadata.'); }
  if (metadata.private !== false || metadata.visibility !== 'public' ||
      String(metadata.full_name || '').toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Dispatch blocked: the configured repository must be public.');
  }
  root = API + '/repos/' + metadata.full_name.split('/').map(encodeURIComponent).join('/');

  const response = await githubRequest(root + '/actions/workflows/monitor.yml/dispatches', {
    method: 'POST',
    headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({ref: 'main', inputs: {mode: 'scan', source: 'cloud-timer', scheduled_at: scheduledAt}})
  }, request);
  let runId = null;
  if (response.status === 200) {
    let receipt;
    try { receipt = await response.json(); }
    catch { throw new Error('Invalid GitHub dispatch receipt.'); }
    runId = receipt.workflow_run_id;
    if (!Number.isSafeInteger(runId) || runId <= 0 || receipt.run_url !== root + '/actions/runs/' + runId) {
      throw new Error('Invalid GitHub dispatch receipt.');
    }
  } else if (response.status !== 204) {
    throw new Error('GitHub dispatch failed: HTTP ' + response.status);
  }
  return {accepted: true, scheduledAt, runId};
}

export default {
  async scheduled(event, env) {
    const result = await dispatchScan(event, env);
    console.log(JSON.stringify({event: result.accepted ? 'DISPATCH_ACCEPTED' : 'DISPATCH_SKIPPED', scheduledAt: result.scheduledAt, ...(result.accepted ? {runId: result.runId} : {})}));
  },
  async fetch() {
    return new Response('Not found', {status: 404, headers: {'Cache-Control': 'no-store'}});
  }
};
