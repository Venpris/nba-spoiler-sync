import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';
import '../src/content/view.js';

const View = globalThis.NSSView;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/summary-401810433.json', import.meta.url), 'utf8'));
const snapshot = { capturedAt: 1, ...trimSnapshot(fixture) };
const plays = trimPlays(fixture);
const game = { id: '401810433', shortName: 'MEM @ ORL', away: 'MEM', home: 'ORL' };

test('recognizes NBA game page URLs', () => {
  assert.equal(View.nbaGameIdFromUrl('https://www.espn.com/nba/boxscore/_/gameId/401810433'), '401810433');
  assert.equal(View.nbaGameIdFromUrl('https://www.espn.com/nba/game/_/gameId/401810433/grizzlies-magic'), '401810433');
  assert.equal(View.nbaGameIdFromUrl('https://www.espn.com/nba/recap?gameId=401810433'), '401810433');
  assert.equal(View.nbaGameIdFromUrl('https://www.espn.com/nfl/game/_/gameId/401810433'), null);
  assert.equal(View.nbaGameIdFromUrl('https://www.espn.com/nba/scoreboard'), null);
  assert.equal(View.pageKind('https://www.espn.com/nba/playbyplay/_/gameId/1'), 'playbyplay');
  assert.equal(View.pageKind('https://www.espn.com/nba/game/_/gameId/1'), 'gamecast');
  assert.equal(View.pageKind('https://www.espn.com/nba/recap/_/gameId/1'), 'other');
});

test('box score lists every player with stats or a DNP note', () => {
  const html = View.renderBox(snapshot);
  for (const team of snapshot.box) {
    for (const p of team.players) assert.ok(html.includes(View.esc(p.shortName)), p.shortName);
  }
  const dnp = snapshot.box.flatMap((t) => t.players).find((p) => p.dnp);
  assert.ok(html.includes(View.esc(`DNP-${dnp.reason}`)));
  assert.ok(html.includes('Starters') && html.includes('Bench'));
});

test('ESPN text is escaped and only https logos are used', () => {
  const evil = structuredClone(snapshot);
  evil.teams[0].name = '<img src=x onerror=alert(1)>';
  evil.teams[0].logo = 'javascript:alert(1)';
  evil.box[0].players[0].shortName = '<script>x</script>';
  const html = View.renderBox(evil) + View.renderStrip({ status: 'ready', snapshot: evil }, game);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
});

test('strip says what is happening before stats are ready', () => {
  assert.match(View.renderStrip({ status: 'unsynced' }, game), /sync to your stream/);
  assert.match(View.renderStrip({ status: 'loading', readyInMs: 65_000 }, game), /about 1:05/);
  const ready = View.renderStrip({ status: 'ready', snapshot }, game);
  assert.match(ready, /Final/);
  assert.ok(ready.includes('nss-linescore'));
});

test('page bodies: hidden until ready, then the right view per tab', () => {
  assert.match(View.renderBody('boxscore', { status: 'loading' }), /Hidden by Spoiler Sync/);
  const view = { status: 'ready', snapshot, plays };
  assert.ok(View.renderBody('boxscore', view).includes('Starters'));
  assert.ok(View.renderBody('playbyplay', view).includes('4th Quarter'));
  assert.match(View.renderBody('gamecast', view), /Last plays/);
  assert.ok(View.renderBody('matchup', view).includes('Field Goal %'));
  assert.match(View.renderBody('other', view), /hidden while Spoiler Sync is on/);
  const last8 = View.renderPlays(snapshot, plays, 8);
  assert.equal((last8.match(/<tr class="/g) || []).length, 8);
});
