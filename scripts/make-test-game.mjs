// builds test/fixtures/game.json, a made-up game shaped like ESPN's summary feed but with
// the real play timing from test/fixtures/timing.json, so sync tests still see real-world
// logging patterns (the same timing file always produces the same game)
// run with: npm run fixtures
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const timing = JSON.parse(readFileSync(join(fixtures, 'timing.json'), 'utf8')).plays;

const GAME_ID = '900000001';

// small seeded random number generator (mulberry32)
let seed = 20260115;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const int = (min, max) => min + Math.floor(random() * (max - min + 1));

const TEAMS = {
  away: { id: '91', location: 'Harbor City', name: 'Herons', abbreviation: 'HAR', color: '1d4e89' },
  home: { id: '92', location: 'Mesa', name: 'Coyotes', abbreviation: 'MES', color: 'c4622d' },
};
const FIRST = ['Marcus', 'Theo', 'Andre', 'Jalen', 'Owen', 'Darius', 'Felix', 'Isaiah', 'Rafael', 'Quinn', 'Malik', 'Elias', 'Corey', 'Nikola', 'Tobias', 'Dante', 'Reid', 'Kofi', 'Silas', 'Victor', 'Bennett', 'Emeka', 'Lucas', 'Jonah', 'Aaron', 'Marco'];
const LAST = ['Lindqvist', 'Brandt', 'Okafor', 'Whitfield', 'Castellano', 'Mercer', 'Adeyemi', 'Holloway', 'Szabo', 'Pryor', 'Delacroix', 'Vance', 'Kimura', 'Ostrowski', 'Achterberg', 'Fairbanks', 'Nwosu', 'Rasmussen', 'Calloway', 'Ibarra', 'Thornton', 'Lukić', 'Marchetti', 'Haddad', 'Sorensen', 'Bello', 'Quarshie', 'Lindgren', 'Abara', 'Del Toro'];
const POSITIONS = ['G', 'G', 'F', 'F', 'C', 'G', 'F', 'C', 'G', 'F', 'G', 'F', 'C'];
const MINUTES = [36, 34, 33, 32, 30, 24, 20, 14, 7, 5, 3, 2]; // 240 per team

const usedNames = new Set();
function makePlayer(side, i) {
  let first, last;
  do {
    first = pick(FIRST);
    last = pick(LAST);
  } while (usedNames.has(last));
  usedNames.add(last);
  const dnp = i === 12;
  return {
    id: `${TEAMS[side].id}${String(i + 1).padStart(2, '0')}`,
    displayName: `${first} ${last}`,
    shortName: `${first[0]}. ${last}`,
    jersey: String(int(0, 45)),
    position: POSITIONS[i],
    starter: i < 5,
    dnp,
    reason: dnp ? 'LEFT ANKLE SPRAIN' : null,
    weight: dnp ? 0 : MINUTES[i],
    stats: { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0, pts: 0 },
  };
}
const roster = { away: [], home: [] };
for (const side of ['away', 'home']) for (let i = 0; i < 13; i++) roster[side].push(makePlayer(side, i));

// a random active player, weighted roughly by minutes
function player(side, not) {
  const pool = roster[side].filter((p) => p.weight && p !== not);
  let r = random() * pool.reduce((sum, p) => sum + p.weight, 0);
  for (const p of pool) if ((r -= p.weight) < 0) return p;
  return pool[0];
}
const other = (side) => (side === 'home' ? 'away' : 'home');
const ordinal = (n) => ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n - 4}OT`;

const score = { away: 0, home: 0 };
const byPeriod = { away: [], home: [] };
let lead = { away: 0, home: 0 };
let leader = null;
let leadChanges = 0;
const teamTurnovers = { away: 0, home: 0 };
const playsLeading = { away: 0, home: 0 };

const plays = timing.map((t, i) => {
  const seq = i + 1;
  const side = t.side || null;
  let text = '';
  let type = '';
  const participants = [];
  const shooter = side ? player(side) : null;
  const helperSame = side && t.second ? player(side, shooter) : null;
  const helperOther = side && t.second ? player(other(side)) : null;

  switch (t.kind) {
    case 'shot': {
      const three = t.attempt === 3;
      const made = Boolean(t.points);
      const dist = three ? int(23, 28) : int(1, 19);
      const shot = three ? 'three point jumper' : dist < 5 ? 'driving layup' : 'jumper';
      type = three || dist >= 5 ? 'Jump Shot' : 'Driving Layup Shot';
      const s = shooter.stats;
      s.fga++;
      if (three) s.tpa++;
      if (made) {
        s.fgm++;
        if (three) s.tpm++;
        text = `${shooter.displayName} makes ${dist}-foot ${shot}`;
        if (helperSame) {
          helperSame.stats.ast++;
          text += ` (${helperSame.displayName} assists)`;
        }
      } else if (helperOther) {
        helperOther.stats.blk++;
        text = `${helperOther.displayName} blocks ${shooter.displayName} 's ${dist}-foot ${shot}`;
      } else {
        text = `${shooter.displayName} misses ${dist}-foot ${shot}`;
      }
      participants.push(shooter, made ? helperSame : helperOther);
      break;
    }
    case 'ft': {
      type = 'Free Throw - 1 of 2';
      shooter.stats.fta++;
      if (t.points) shooter.stats.ftm++;
      text = `${shooter.displayName} ${t.points ? 'makes' : 'misses'} free throw`;
      participants.push(shooter);
      break;
    }
    case 'oreb':
    case 'dreb': {
      const offensive = t.kind === 'oreb';
      type = offensive ? 'Offensive Rebound' : 'Defensive Rebound';
      if (t.team) text = `${TEAMS[side].name} ${offensive ? 'offensive' : 'defensive'} team rebound`;
      else {
        shooter.stats[offensive ? 'oreb' : 'dreb']++;
        text = `${shooter.displayName} ${offensive ? 'offensive' : 'defensive'} rebound`;
        participants.push(shooter);
      }
      break;
    }
    case 'turnover': {
      type = 'Bad Pass Turnover';
      if (t.team) {
        text = `${TEAMS[side].name} turnover`;
        teamTurnovers[side]++;
      } else {
        shooter.stats.to++;
        text = `${shooter.displayName} bad pass`;
        participants.push(shooter);
        if (helperOther) {
          helperOther.stats.stl++;
          text += ` (${helperOther.displayName} steals)`;
          participants.push(helperOther);
        }
      }
      break;
    }
    case 'foul': {
      type = 'Personal Foul';
      if (t.team) text = `${TEAMS[side].name} team foul`;
      else {
        shooter.stats.pf++;
        text = `${shooter.displayName} personal foul`;
        participants.push(shooter);
      }
      break;
    }
    case 'sub': {
      type = 'Substitution';
      const out = player(side);
      const inn = player(side, out);
      text = `${inn.displayName} enters the game for ${out.displayName}`;
      participants.push(inn, out);
      break;
    }
    case 'timeout':
      type = 'Full Timeout';
      text = `${TEAMS[side || 'home'].name} Full timeout`;
      break;
    case 'jumpball': {
      type = 'Jumpball';
      const a = roster.home[4];
      const b = roster.away[4];
      text = `${a.displayName} vs. ${b.displayName} (${roster.home[0].displayName} gains possession)`;
      participants.push(a, b);
      break;
    }
    case 'endperiod':
      type = 'End Period';
      text = `End of the ${ordinal(t.period)} Quarter`;
      break;
    case 'endgame':
      type = 'End Game';
      text = 'End of Game';
      break;
    default:
      type = 'Official Review';
      text = 'Official review';
  }

  if (t.points) {
    score[side] += t.points;
    shooter.stats.pts += t.points;
    (byPeriod[side][t.period - 1] ??= 0);
    byPeriod[side][t.period - 1] += t.points;
    const margin = score.home - score.away;
    const now = margin > 0 ? 'home' : margin < 0 ? 'away' : leader;
    if (now && leader && now !== leader) leadChanges++;
    leader = now;
    lead.home = Math.max(lead.home, margin);
    lead.away = Math.max(lead.away, -margin);
  }
  if (score.home !== score.away) playsLeading[score.home > score.away ? 'home' : 'away']++;

  // ESPN's short label for the play, as on its Gamecast play cards
  const shortDescription = {
    shot: t.points ? `+${t.points} Points` : t.attempt === 3 ? 'Missed 3PT' : 'Missed FG',
    ft: t.points ? '+1 Point' : 'Missed FT',
    oreb: 'Rebound',
    dreb: 'Rebound',
    turnover: 'Turnover',
    foul: 'Foul',
    sub: 'Substitution',
    timeout: 'Timeout',
    jumpball: 'Jump Ball',
    endperiod: t.period === 2 ? 'Halftime' : `End of ${ordinal(t.period)}`,
    endgame: 'End of Game',
  }[t.kind] ?? 'Challenge';

  return {
    id: `${GAME_ID}${seq}`,
    sequenceNumber: String(seq),
    type: { id: String(100 + i), text: type },
    shortDescription,
    text,
    awayScore: score.away,
    homeScore: score.home,
    period: { number: t.period, displayValue: `${ordinal(t.period)} Quarter` },
    clock: { displayValue: t.clock },
    scoringPlay: Boolean(t.points),
    scoreValue: t.points || 0,
    team: side ? { id: TEAMS[side].id } : undefined,
    participants: participants.filter(Boolean).map((p) => ({ athlete: { id: p.id } })),
    wallclock: t.wallclock,
    shootingPlay: t.kind === 'shot' || t.kind === 'ft',
    pointsAttempted: t.attempt || 0,
  };
});

const periods = Math.max(...timing.map((t) => t.period));
const LABELS = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
const pct = (m, a) => (a ? ((100 * m) / a).toFixed(1) : '0.0');

function teamTotals(side) {
  const sum = (key) => roster[side].reduce((n, p) => n + p.stats[key], 0);
  const t = Object.fromEntries(Object.keys(roster[side][0].stats).map((k) => [k, sum(k)]));
  t.reb = t.oreb + t.dreb;
  return t;
}

function boxRow(p, i) {
  const s = p.stats;
  const plusMinus = int(-12, 12);
  return [String(MINUTES[i]), String(s.pts), `${s.fgm}-${s.fga}`, `${s.tpm}-${s.tpa}`, `${s.ftm}-${s.fta}`, String(s.oreb + s.dreb), String(s.ast), String(s.to), String(s.stl), String(s.blk), String(s.oreb), String(s.dreb), String(s.pf), plusMinus > 0 ? `+${plusMinus}` : String(plusMinus)];
}

function teamJson(side) {
  const t = TEAMS[side];
  return {
    id: t.id,
    location: t.location,
    name: t.name,
    abbreviation: t.abbreviation,
    displayName: `${t.location} ${t.name}`,
    shortDisplayName: t.name,
    color: t.color,
    logos: [{ href: `https://example.com/logos/${t.abbreviation.toLowerCase()}.png` }],
  };
}

function teamStats(side) {
  const t = teamTotals(side);
  const stat = (name, label, abbreviation, displayValue) => ({ name, label, abbreviation, displayValue: String(displayValue) });
  return [
    stat('fieldGoalsMade-fieldGoalsAttempted', 'FG', 'FG', `${t.fgm}-${t.fga}`),
    stat('fieldGoalPct', 'Field Goal %', 'FG%', pct(t.fgm, t.fga)),
    stat('threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT', '3PT', `${t.tpm}-${t.tpa}`),
    stat('threePointFieldGoalPct', 'Three Point %', '3P%', pct(t.tpm, t.tpa)),
    stat('freeThrowsMade-freeThrowsAttempted', 'FT', 'FT', `${t.ftm}-${t.fta}`),
    stat('freeThrowPct', 'Free Throw %', 'FT%', pct(t.ftm, t.fta)),
    stat('totalRebounds', 'Rebounds', 'REB', t.reb),
    stat('offensiveRebounds', 'Offensive Rebounds', 'OR', t.oreb),
    stat('defensiveRebounds', 'Defensive Rebounds', 'DR', t.dreb),
    stat('assists', 'Assists', 'AST', t.ast),
    stat('steals', 'Steals', 'STL', t.stl),
    stat('blocks', 'Blocks', 'BLK', t.blk),
    stat('turnovers', 'Turnovers', 'TO', t.to),
    stat('teamTurnovers', 'Team Turnovers', 'TTO', teamTurnovers[side]),
    stat('totalTurnovers', 'Total Turnovers', 'ToTO', t.to + teamTurnovers[side]),
    stat('fouls', 'Fouls', 'PF', t.pf),
    stat('largestLead', 'Largest Lead', 'LL', lead[side]),
    stat('leadChanges', 'Lead Changes', 'LC', leadChanges),
    stat('leadPercentage', 'Percent Led', 'LPCT', Math.round((100 * playsLeading[side]) / timing.length)),
  ];
}

const game = {
  header: {
    id: GAME_ID,
    competitions: [
      {
        id: GAME_ID,
        date: timing[0].wallclock,
        // ESPN lists the home team first
        competitors: ['home', 'away'].map((side) => ({
          id: TEAMS[side].id,
          homeAway: side,
          winner: score[side] > score[other(side)],
          team: teamJson(side),
          score: String(score[side]),
          linescores: Array.from({ length: periods }, (_, i) => ({ displayValue: String(byPeriod[side][i] ?? 0) })),
          record: [
            { type: 'total', summary: side === 'home' ? '12-6' : '9-9' },
            { type: side === 'home' ? 'home' : 'road', summary: side === 'home' ? '7-2' : '4-5' },
          ],
        })),
        status: { type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final', detail: 'Final', shortDetail: 'Final' } },
      },
    ],
  },
  boxscore: {
    teams: ['away', 'home'].map((side) => ({ team: teamJson(side), homeAway: side, statistics: teamStats(side) })),
    players: ['away', 'home'].map((side) => {
      const t = teamTotals(side);
      return {
        team: teamJson(side),
        statistics: [
          {
            names: LABELS,
            labels: LABELS,
            descriptions: ['Minutes', 'Points', 'Field Goals Made-Attempted', '3-Point Field Goals Made-Attempted', 'Free Throws Made-Attempted', 'Rebounds', 'Assists', 'Turnovers', 'Steals', 'Blocks', 'Offensive Rebounds', 'Defensive Rebounds', 'Personal Fouls', 'Plus/Minus'],
            athletes: roster[side].map((p, i) => ({
              athlete: { id: p.id, displayName: p.displayName, shortName: p.shortName, jersey: p.jersey, position: { abbreviation: p.position } },
              starter: p.starter,
              didNotPlay: p.dnp,
              reason: p.reason ?? '',
              ejected: false,
              stats: p.dnp ? [] : boxRow(p, i),
            })),
            totals: ['', String(t.pts), `${t.fgm}-${t.fga}`, `${t.tpm}-${t.tpa}`, `${t.ftm}-${t.fta}`, String(t.reb), String(t.ast), String(t.to), String(t.stl), String(t.blk), String(t.oreb), String(t.dreb), String(t.pf), ''],
          },
        ],
      };
    }),
  },
  plays,
  // parts of ESPN's feed the extension must never pass on
  winprobability: [{ playId: plays.at(-1).id, homeWinPercentage: 1 }],
  news: { articles: [{ headline: `${TEAMS.home.name} hold off ${TEAMS.away.name}` }] },
};

writeFileSync(join(fixtures, 'game.json'), JSON.stringify(game));
console.log(`test/fixtures/game.json: ${plays.length} plays, final ${TEAMS.away.abbreviation} ${score.away} - ${TEAMS.home.abbreviation} ${score.home}`);
