// Rewriting a copy of ESPN's own scoreboard card with synced data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';
import { espnCardHtml } from './helpers/espn-card-markup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/espn-copy.js', '../src/content/espn-card.js'].map(read);
const fixture = JSON.parse(read('./fixtures/game.json'));
const GAME = { id: '900000001' };

// The synced game in the 3rd quarter: plays up to a 3rd-quarter shot.
function midGame() {
  const cut = fixture.plays.findIndex((p) => p.period.number === 3 && p.scoringPlay);
  const json = structuredClone(fixture);
  json.plays = json.plays.slice(0, cut + 1);
  json.header.competitions[0].status = { period: 3, displayClock: json.plays.at(-1).clock.displayValue, type: { state: 'in', shortDetail: '' } };
  for (const c of json.header.competitions[0].competitors) {
    c.linescores = c.linescores.slice(0, 3);
    c.score = String(json.plays.at(-1)[c.homeAway === 'home' ? 'homeScore' : 'awayScore']);
  }
  const plays = trimPlays(json);
  return { snapshot: { capturedAt: 1, ...trimSnapshot(json, plays) }, plays };
}

// ESPN's card is built from the synced teams; `copyWith` swaps in different synced data.
function build(markup, { snapshot, plays }, copyWith = snapshot) {
  const away = snapshot.teams.find((t) => t.homeAway === 'away');
  const home = snapshot.teams.find((t) => t.homeAway === 'home');
  const { window } = new JSDOM(`<!doctype html><body>${espnCardHtml({ id: GAME.id, away, home, ...markup })}</body>`, { runScripts: 'outside-only' });
  for (const src of sources) window.eval(src);
  const original = window.NSSEspnCard.findOriginal(window.document, GAME);
  return { original, built: window.NSSEspnCard.buildCopy(original, copyWith, plays), away, home };
}

const shown = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style?.display === 'none' || n.style?.visibility === 'hidden') return false;
  return true;
};
const visibleText = (root) => [...root.querySelectorAll('*')].filter((el) => !el.children.length && el.textContent.trim() && shown(el)).map((el) => el.textContent.trim());

test('live card, synced to the 3rd quarter: everything on it is synced', () => {
  const synced = midGame();
  const { built, away, home } = build({ state: 'in' }, synced);
  const { copy } = built;
  const s = synced.snapshot.status;

  const time = copy.querySelector('.ScoreboardScoreCell__Time');
  assert.equal(time.textContent, `${s.clock} - 3rd`);
  assert.match(time.className, /clr-negative/);
  assert.deepEqual([...copy.querySelectorAll('.ScoreboardScoreCell__Heading')].map((h) => h.textContent), ['1', '2', '3', '4', 'T']);
  const rows = [...copy.querySelectorAll('.ScoreboardScoreCell__Item')];
  for (const [row, team] of [[rows[0], away], [rows[1], home]]) {
    assert.deepEqual([...row.querySelectorAll('.ScoreboardScoreCell__Value')].map((v) => v.textContent), [...team.linescores, '']);
    assert.equal(row.querySelector('.ScoreCell__Score').textContent, team.score);
    assert.equal(row.querySelector('.ScoreboardScoreCell__RecordContainer').textContent, `(${team.record.total}${team.record.venue}${team.homeAway === 'home' ? 'Home' : 'Away'})`);
    assert.equal(row.querySelector('img').getAttribute('src'), team.logo);
  }

  // Last play: the synced latest play, with its team.
  const last = synced.plays.at(-1);
  const lastTeam = synced.snapshot.teams.find((t) => t.id === last.teamId);
  assert.equal(copy.querySelector('.LastPlay h1').textContent, `Last Play ${last.clock} - 3rd`);
  assert.equal(copy.querySelector('.LastPlay span span').textContent, `${lastTeam.abbrev} - ${last.text}`);
  assert.match(copy.querySelector('.LastPlay img').getAttribute('src'), new RegExp(`/players/full/${last.athleteId}\\.png$`));

  // Top performers: each team's synced leading scorer.
  const performers = [...copy.querySelectorAll('.ContentList__Item')];
  assert.equal(performers.length, 2);
  for (const [item, team] of [[performers[0], away], [performers[1], home]]) {
    const entry = synced.snapshot.box.find((b) => b.teamId === team.id);
    const pts = (p) => Number(p.stats[entry.labels.indexOf('PTS')]) || 0;
    const top = Math.max(...entry.players.filter((p) => p.stats.length).map(pts));
    assert.equal(item.querySelector('.Athlete__Stats--value').textContent, String(top));
    assert.equal(item.querySelector('.Athlete__Stats--label').textContent, 'PTS');
    assert.match(item.querySelector('.Athlete__NameDetails').textContent, new RegExp(`- ${team.abbrev}$`));
    assert.match(item.querySelector('a').getAttribute('href'), /^\/nba\/player\/_\/id\/\d+\/[a-z-]+$/);
  }

  assert.ok(!visibleText(copy).some((t) => /99|LIVE/.test(t)), visibleText(copy).join(' | '));
  assert.deepEqual([...copy.querySelectorAll('.Scoreboard__Callouts a')].filter(shown).map((a) => a.textContent), ['Gamecast', 'Box Score', 'Highlights']);
});

test('a finished game’s card gives nothing away', () => {
  const synced = midGame();
  const { original, built } = build({ state: 'post' }, synced);
  const { copy } = built;
  assert.ok(original.textContent.includes('beat'));
  assert.ok(!copy.textContent.includes('beat'), 'recap headline removed');
  assert.ok(copy.querySelector('.LastPlay'), 'last play shown instead');
  assert.ok([...copy.querySelectorAll('svg')].every((svg) => !shown(svg)), 'winner icon hidden');
  assert.match(copy.querySelector('.ScoreboardScoreCell').className, /ScoreboardScoreCell--in/);
  assert.match(copy.querySelector('.ScoreboardScoreCell__Time').className, /clr-negative/);
  assert.ok(!visibleText(copy).includes('Final'));
  assert.ok(!visibleText(copy).includes('Recap'));
  assert.ok(!visibleText(copy).some((t) => /99/.test(t)));
});

test('live game in overtime, synced to the 4th: no overtime column yet', () => {
  const synced = midGame();
  synced.snapshot.status.period = 4;
  for (const t of synced.snapshot.teams) t.linescores.push('20');
  const { built } = build({ state: 'in', periods: 5 }, synced);
  assert.deepEqual([...built.copy.querySelectorAll('.ScoreboardScoreCell__Heading')].map((h) => h.textContent), ['1', '2', '3', '4', 'T']);
  assert.equal(built.copy.querySelector('.ScoreboardScoreCell__Item').querySelectorAll('.ScoreboardScoreCell__Value').length, 4);
});

test('top performer line: points, then up to two standout stats in ESPN’s order', () => {
  const synced = midGame();
  const entry = synced.snapshot.box[0];
  const at = (label) => entry.labels.indexOf(label);
  for (const p of entry.players) if (p.stats.length) p.stats = p.stats.map(() => '0');
  const star = entry.players.find((p) => p.stats.length);
  Object.assign(star.stats, { [at('PTS')]: '31', [at('REB')]: '5', [at('AST')]: '9', [at('STL')]: '3', [at('BLK')]: '4' });
  const { built } = build({ state: 'in' }, synced);
  const item = built.copy.querySelectorAll('.ContentList__Item')[0];
  const line = [...item.querySelectorAll('.Athlete__Stats > *')].map((d) => `${d.querySelector('.Athlete__Stats--value').textContent} ${d.querySelector('.Athlete__Stats--label').textContent}`);
  // 5 REB is below the cut-off; of AST, STL and BLK the two that stand out most are kept.
  assert.deepEqual(line, ['31 PTS', '9 AST', '4 BLK']);
});

test('a team that can’t be matched means no copy (our own card is shown)', () => {
  const synced = midGame();
  const other = structuredClone(synced.snapshot);
  other.teams[0].abbrev = 'XYZ';
  assert.equal(build({ state: 'in' }, synced, other).built, null);
});
