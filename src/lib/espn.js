// ESPN's public (undocumented) site API, plus trimming of its responses down to what we
// store. Anything not copied here (win probability, news, team records, odds...) is
// dropped on arrival so it can never reach a page.
import { parseClock } from './clock.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const receivedAt = Date.now();
  const json = await res.json();
  return { json, receivedAt, serverDate: res.headers.get('date'), age: res.headers.get('age') };
}

// Today's slate as ESPN defines it. Only names and tip-off time leave this function:
// no scores, no status (even "Final" or "OT" would give something away).
export async function fetchGames() {
  const { json } = await getJson(`${BASE}/scoreboard`);
  return (json.events || []).map((e) => {
    const competitors = e.competitions?.[0]?.competitors || [];
    const side = (homeAway) => competitors.find((c) => c.homeAway === homeAway)?.team || {};
    return {
      id: e.id,
      name: e.name,
      shortName: e.shortName,
      date: e.date,
      away: side('away').abbreviation,
      home: side('home').abbreviation,
    };
  });
}

export async function fetchSummary(gameId) {
  return getJson(`${BASE}/summary?event=${encodeURIComponent(gameId)}`);
}

// Estimate ESPN server time minus local time from a response's Date (and Age) headers.
export function skewSample({ serverDate, age, receivedAt }) {
  const server = Date.parse(serverDate);
  if (!Number.isFinite(server)) return null;
  // Date has whole-second resolution; +500ms centers the estimate.
  return server + (Number(age) || 0) * 1000 + 500 - receivedAt;
}

export function trimPlays(json) {
  return (json.plays || []).map((p) => ({
    id: String(p.id),
    seq: Number(p.sequenceNumber),
    period: p.period?.number,
    clock: p.clock?.displayValue ?? '',
    clockSec: parseClock(p.clock?.displayValue ?? ''),
    wallclockMs: Date.parse(p.wallclock),
    text: p.text ?? '',
    type: p.type?.text ?? '',
    teamId: p.team?.id ?? null,
    scoring: Boolean(p.scoringPlay),
    away: p.awayScore,
    home: p.homeScore,
  }));
}

// The parts of ESPN's game state the ESPN-page panel shows. `plays` is the trimmed
// play list from the same response, used to fill in period/clock when ESPN omits them.
export function trimSnapshot(json, plays = trimPlays(json)) {
  const comp = json.header?.competitions?.[0] || {};
  const status = comp.status || {};
  const last = plays.reduce((a, b) => (a && a.seq > b.seq ? a : b), null);

  const teams = (comp.competitors || []).map((c) => ({
    id: c.id,
    homeAway: c.homeAway,
    abbrev: c.team?.abbreviation,
    name: c.team?.displayName,
    shortName: c.team?.shortDisplayName || c.team?.name,
    logo: c.team?.logos?.[0]?.href || c.team?.logo || null,
    color: c.team?.color || null,
    score: c.score ?? null,
    linescores: (c.linescores || []).map((l) => l.displayValue),
  }));

  const box = (json.boxscore?.players || []).map((tp) => {
    const s = tp.statistics?.[0] || {};
    return {
      teamId: tp.team?.id,
      labels: s.labels || [],
      descriptions: s.descriptions || [],
      totals: s.totals || [],
      players: (s.athletes || []).map((a) => ({
        id: a.athlete?.id,
        name: a.athlete?.displayName,
        shortName: a.athlete?.shortName,
        jersey: a.athlete?.jersey ?? null,
        position: a.athlete?.position?.abbreviation ?? null,
        starter: Boolean(a.starter),
        dnp: Boolean(a.didNotPlay),
        reason: a.reason || null,
        ejected: Boolean(a.ejected),
        stats: a.stats || [],
      })),
    };
  });

  const teamStats = (json.boxscore?.teams || []).map((t) => ({
    teamId: t.team?.id,
    stats: (t.statistics || []).map((s) => ({ name: s.name, label: s.label, value: s.displayValue })),
  }));

  return {
    status: {
      state: status.type?.state ?? null, // 'pre' | 'in' | 'post'
      detail: status.type?.shortDetail ?? status.type?.detail ?? null,
      period: status.period ?? last?.period ?? null,
      clock: status.displayClock ?? last?.clock ?? null,
    },
    teams,
    box,
    teamStats,
    lastSeq: last?.seq ?? null,
  };
}
