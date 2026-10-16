/**
 * Reliable Cloudflare Cron bridge for the DTEK Telegram publisher.
 *
 * GitHub's own schedule event is best-effort and may not run. This worker
 * already has a five-minute Cloudflare Cron Trigger for the water bot.
 * When DTEK_GITHUB_TOKEN is set as a Cloudflare *secret*, request a GitHub
 * workflow_dispatch run. The existing DTEK GitHub workflow is responsible
 * for reading DTEK, deduplication, and Telegram publishing.
 *
 * DTEK_GITHUB_TOKEN must have Actions:write for XOTT69/dtek only.
 * Never include the token or authorization headers in logs.
 */
const GITHUB_DISPATCH_URL =
  'https://api.github.com/repos/XOTT69/dtek/actions/workflows/publish.yml/dispatches';

export async function dispatchDtekPublisher(env, {
  fetchFn = fetch, logger = console
} = {}) {
  const token = env?.DTEK_GITHUB_TOKEN;
  if (!token) {
    logger.warn('DTEK scheduler not enabled: set Cloudflare secret DTEK_GITHUB_TOKEN.');
    return {status: 'not-configured'};
  }

  try {
    const response = await fetchFn(GITHUB_DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'botvoda-dtek-scheduler'
      },
      body: JSON.stringify({ref:'main'}),
      signal: AbortSignal.timeout(14000)
    });
    if (response.status !== 204) {
      // May be denied by token permissions or disabled Actions. Do not
      // print HTTP body because responses can contain account metadata.
      logger.warn('DTEK scheduler: workflow dispatch rejected, HTTP ' + response.status);
      return {status: 'rejected', code: response.status};
    }
    logger.log('DTEK scheduler: GitHub Actions dispatch accepted.');
    return {status: 'dispatched'};
  } catch (error) {
    logger.warn('DTEK scheduler: GitHub dispatch network error (' +
      (error?.name || 'unknown') + ').');
    return {status: 'network-error'};
  }
}
