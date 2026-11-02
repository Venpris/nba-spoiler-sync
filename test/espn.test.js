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

test('trimSnapshot falls back to the latest play for period and clock', () => {
  const live = structuredClone(fixture);
  live.header.competitions[0].status = { type: { state: 'in', shortDetail: '' } };
  live.plays = live.plays.slice(0, 50);
  const snap = trimSnapshot(live);
  const last = live.plays.at(-1);
  assert.equal(snap.status.period, last.period.number);
  assert.equal(snap.status.clock, last.clock.displayValue);
});

test('skewSample measures server time minus local time', () => {
  const server = Date.parse('Mon, 02 Nov 2026 04:18:59 GMT');
  assert.equal(skewSample({ serverDate: 'Mon, 02 Nov 2026 04:18:59 GMT', age: null, receivedAt: server + 200 }), 300);
  assert.equal(skewSample({ serverDate: 'Mon, 02 Nov 2026 04:18:59 GMT', age: '2', receivedAt: server }), 2500);
  assert.equal(skewSample({ serverDate: null, receivedAt: 0 }), null);
});
