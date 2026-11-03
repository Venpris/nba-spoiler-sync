// ESPN's public (undocumented) site API, and trimming its responses to what we store
// anything not copied here (win probability, news, odds...) is dropped on arrival so it
// can never reach a page
import { parseClock } from './clock.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const receivedAt = Date.now();
  const json = await res.json();
  return { json, receivedAt, serverDate: res.headers.get('date'), age: res.headers.get('age') };
}

// today's slate as ESPN defines it, with only names and tip-off time
// no scores or status, since even "Final" or "OT" would give something away
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

// estimate ESPN server time minus local time from a response's Date (and Age) headers
export function skewSample({ serverDate, age, receivedAt }) {
  const server = Date.parse(serverDate);
  if (!Number.isFinite(server)) return null;
  // Date has whole-second resolution, so +500ms centers the estimate
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
    label: p.shortDescription ?? '', // ESPN's play-card label, like "+3 Points", "Missed FG" or "Rebound"
    teamId: p.team?.id ?? null,
    athleteId: p.participants?.[0]?.athlete?.id ?? null,
    scoring: Boolean(p.scoringPlay),
    away: p.awayScore,
    home: p.homeScore,
  }));
}

// quarter and clock for a game in progress
// ESPN's header clock runs live but can get stuck (it once read 0.0 well into the 4th
// quarter), so trust it only when it matches the latest play's quarter and shows no more
// time left than that play, otherwise use the play's quarter and clock
function gameClock(status, last) {
  if (!last) return { period: status.period ?? null, clock: status.displayClock ?? null, endOfPeriod: false };
  const headerSec = parseClock(String(status.displayClock ?? ''));
  const lastSec = last.clockSec;
  const agrees =
    status.period === last.period && Number.isFinite(headerSec) && headerSec <= lastSec && !(headerSec === 0 && lastSec > 0);
  return {
    period: agrees ? status.period : last.period,
    clock: agrees ? status.displayClock : last.clock,
    endOfPeriod: last.type === 'End Period',
  };
}

// the parts of ESPN's game state the ESPN-page panel shows
// `plays` (trimmed, from the same response) checks and fills in the quarter and clock
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
    // records change when the game ends, but a snapshot only has them as of capture time,
    // which is before the viewer's point in the game
    record: {
      total: (c.record || []).find((r) => r.type === 'total')?.summary ?? null,
      venue: (c.record || []).find((r) => r.type === (c.homeAway === 'home' ? 'home' : 'road'))?.summary ?? null,
    },
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
      ...gameClock(status, last),
    },
    teams,
    box,
    teamStats,
    lastSeq: last?.seq ?? null,
  };
}
