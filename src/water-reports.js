// Community reports are observations, not sensor readings or a replacement for the schedule.
// Only the latest report per Telegram account is retained, with short-lived aggregation.
export const REPORT_WINDOW_MINUTES = 45;

export function classifyWaterReports(onCount, offCount) {
  const on = Math.max(0, Number(onCount) || 0);
  const off = Math.max(0, Number(offCount) || 0);
  if (!on && !off) return 'empty';
  if (on >= 2 && on >= off * 3) return 'on';
  if (off >= 2 && off >= on * 3) return 'off';
  if (on && off) return 'mixed';
  return 'limited';
}

export function communityWaterLine(stats) {
  const on = Number(stats?.on || 0);
  const off = Number(stats?.off || 0);
  const kind = classifyWaterReports(on, off);
  const labels = {
    empty: 'немає свіжих повідомлень',
    limited: 'поки недостатньо повідомлень',
    mixed: 'повідомлення суперечливі',
    on: 'переважно повідомляють, що є',
    off: 'переважно повідомляють, що немає'
  };
  const counts = on + off ? ' (💧 ' + on + ' / 🚱 ' + off + ' за 45 хв)' : '';
  return '👥 За словами мешканців: <b>' + labels[kind] + '</b>' + counts;
}

export function reportTimeKyiv(stamp) {
  if (!stamp) return null;
  const date = new Date(String(stamp).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

export async function getCommunityWaterReports(env) {
  const r = await env.DB.prepare(
    "SELECT " +
    "SUM(CASE WHEN state='on' THEN 1 ELSE 0 END) AS on_count, " +
    "SUM(CASE WHEN state='off' THEN 1 ELSE 0 END) AS off_count, " +
    "MAX(reported_at) AS latest_at " +
    "FROM water_reports WHERE reported_at >= datetime('now','-45 minutes')"
  ).first();
  return {
    on: Number(r?.on_count || 0),
    off: Number(r?.off_count || 0),
    latestAt: r?.latest_at || null
  };
}

export async function saveCommunityWaterReport(env, telegramId, state) {
  if (!/^[0-9]+$/.test(String(telegramId || ''))) throw new Error('Invalid reporter');
  if (!['on', 'off'].includes(state)) throw new Error('Invalid water report');
  // Atomic upsert prevents repeat-clicks from extending a vote's freshness.
  // Same state can be reaffirmed after 10 minutes; a changed state after 2 minutes.
  const r = await env.DB.prepare(
    "INSERT INTO water_reports (telegram_user_id,state,reported_at) VALUES (?,?,CURRENT_TIMESTAMP) " +
    "ON CONFLICT(telegram_user_id) DO UPDATE SET state=excluded.state,reported_at=excluded.reported_at " +
    "WHERE (water_reports.state=excluded.state AND water_reports.reported_at <= datetime('now','-10 minutes')) " +
    "OR (water_reports.state<>excluded.state AND water_reports.reported_at <= datetime('now','-2 minutes'))"
  ).bind(String(telegramId), state).run();
  return Number(r?.meta?.changes || 0) > 0;
}

export async function pruneCommunityWaterReports(env) {
  await env.DB.prepare("DELETE FROM water_reports WHERE reported_at < datetime('now','-14 days')").run();
}
