import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trimPlays, trimSnapshot, skewSample } from '../src/lib/espn.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/game.json', import.meta.url), 'utf8'));

test('trimPlays keeps timing, score and text for every play', () => {
  const plays = trimPlays(fixture);
  assert.equal(plays.length, fixture.plays.length);
  for (const p of plays) {
    assert.ok(Number.isFinite(p.clockSec), `clock ${p.clock}`);
    assert.ok(Number.isFinite(p.wallclockMs));
    assert.ok(p.period >= 1);
  }
  const three = plays.find((p) => p.text.includes('three point') && p.scoring);
  assert.ok(three);
  assert.equal(typeof three.away, 'number');
});

test('trimSnapshot keeps the box score and drops everything else', () => {
  const snap = trimSnapshot(fixture);
  assert.deepEqual(snap.teams.map((t) => t.homeAway).sort(), ['away', 'home']);
  assert.equal(snap.box.length, 2);
  assert.deepEqual(snap.box[0].labels, ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-']);
  for (const team of snap.box) {
    assert.equal(team.players.filter((p) => p.starter).length, 5);
    assert.equal(team.totals.length, team.labels.length);
  }
  const dnp = snap.box.flatMap((t) => t.players).find((p) => p.dnp);
  assert.ok(dnp && dnp.reason);
  assert.equal(snap.teamStats.length, 2);
  assert.equal(snap.status.state, 'post');
  assert.equal(snap.lastSeq, Math.max(...trimPlays(fixture).map((p) => p.seq)));

  // Team records change when a game ends, so they must not be kept.
  const text = JSON.stringify(snap);
  assert.ok(fixture.header.competitions[0].competitors[0].record);
  assert.ok(!text.includes('"record'));
  assert.ok(fixture.winprobability && fixture.news);
  assert.ok(!text.includes('homeWinPercentage'));
  assert.ok(!text.includes('headline'));
});

test('quarter and clock: ESPN header when it agrees with the plays, latest play when not', () => {
  // The game as it stood a few minutes into the 4th quarter.
  const cut = fixture.plays.findIndex((p) => p.period.number === 4 && p.type.text === 'Jump Shot' && p.clock.displayValue < '9');
  const live = (headerStatus, upTo = cut) => {
    const json = structuredClone(fixture);
    json.plays = json.plays.slice(0, upTo + 1);
    json.header.competitions[0].status = { ...headerStatus, type: { state: 'in', shortDetail: '' } };
    return trimSnapshot(json).status;
  };
  const last = trimPlays(fixture)[cut];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Header clock running a few seconds past the last play: trusted.
  const running = fmt(last.clockSec - 5);
  assert.deepEqual(live({ period: 4, displayClock: running }), { state: 'in', detail: '', period: 4, clock: running, endOfPeriod: false });

  // Header stuck at the end of the previous quarter's 0.0: use the latest play.
  assert.equal(live({ period: 4, displayClock: '0.0' }).clock, last.clock);
  // Header clock showing more time than the last play, or a different quarter: same.
  assert.equal(live({ period: 4, displayClock: fmt(last.clockSec + 30) }).clock, last.clock);
  assert.equal(live({ period: 3, displayClock: '1:00' }).period, 4);
  // No header clock at all.
  assert.equal(live({}).clock, last.clock);

  // Between quarters, even if the header has moved on, it reads as the end of the quarter.
  const endOfThird = fixture.plays.findIndex((p) => p.period.number === 3 && p.type.text === 'End Period');
  assert.deepEqual(
    (({ period, endOfPeriod }) => ({ period, endOfPeriod }))(live({ period: 4, displayClock: '12:00' }, endOfThird)),
    { period: 3, endOfPeriod: true },
  );
});

test('skewSample measures server time minus local time', () => {
  const server = Date.parse('Mon, 02 Nov 2026 04:18:59 GMT');
  assert.equal(skewSample({ serverDate: 'Mon, 02 Nov 2026 04:18:59 GMT', age: null, receivedAt: server + 200 }), 300);
  assert.equal(skewSample({ serverDate: 'Mon, 02 Nov 2026 04:18:59 GMT', age: '2', receivedAt: server }), 2500);
  assert.equal(skewSample({ serverDate: null, receivedAt: 0 }), null);
});
