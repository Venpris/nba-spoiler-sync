// rewriting a copy of ESPN's own box score with synced stats
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimSnapshot } from '../src/lib/espn.js';
import { espnBoxHtml } from './helpers/espn-box-markup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/espn-copy.js', '../src/content/espn-box.js'].map(read);
const fixture = JSON.parse(read('./fixtures/game.json'));

function setup(markupOptions) {
  const { window } = new JSDOM(`<!doctype html><body>${espnBoxHtml(fixture, markupOptions)}</body>`, { runScripts: 'outside-only' });
  for (const src of sources) window.eval(src);
  return { Box: window.NSSEspnBox, doc: window.document };
}

// a player's stat cells in a box score, by athlete id
function rowFor(root, athleteId) {
  const link = root.querySelector(`a[href*="/player/_/id/${athleteId}/"]`);
  const idx = link.closest('tr').getAttribute('data-idx');
  const block = link.closest('.Wrapper');
  const statsTable = [...block.querySelectorAll('table')].at(-1);
  return [...statsTable.querySelector(`tr[data-idx="${idx}"]`).children].map((td) => td.textContent);
}

test('every number comes from the synced snapshot, laid out in ESPN’s own markup', () => {
  const { Box, doc } = setup();
  const snapshot = trimSnapshot(fixture);
  const original = Box.findOriginal(doc);
  const { copy, result } = Box.buildCopy(original, snapshot);
  assert.deepEqual({ ...result }, { teams: 2, teamsMatched: 2, players: 26, playersMatched: 26, cleared: 0 });
  assert.ok(copy.hasAttribute('data-nss-copy'));

  for (const team of snapshot.box) {
    for (const p of team.players) {
      const cells = rowFor(copy, p.id);
      if (p.dnp) assert.deepEqual(cells, [`DNP-${p.reason}`]);
      else assert.deepEqual(cells, p.stats, p.name);
    }
  }
  // team totals and shooting percentages
  const teamBlock = [...copy.querySelectorAll('.Boxscore__ResponsiveWrapper > .Wrapper')][0];
  const statsRows = [...[...teamBlock.querySelectorAll('table')].at(-1).querySelectorAll('tr')];
  const totals = snapshot.box.find((b) => b.teamId === snapshot.teams.find((t) => t.name === teamBlock.querySelector('.BoxscoreItem__TeamName').textContent).id).totals;
  assert.deepEqual([...statsRows.at(-2).children].map((td) => td.textContent), totals);
  const [fgm, fga] = totals[2].split('-').map(Number);
  assert.equal(statsRows.at(-1).children[2].textContent, `${Math.round((100 * fgm) / fga)}%`);

  // none of ESPN's live data is left, but labels, names and jerseys are
  assert.ok(!/\b99\b/.test(copy.textContent));
  assert.ok(copy.textContent.includes('3PT') && copy.textContent.includes('starters'));
  assert.ok(copy.querySelector('.playerJersey').textContent.length > 0);
  // the original is left alone
  assert.ok(/\b99\b/.test(original.textContent));
});

test('rows that don’t match are blanked, and rows change shape to fit the synced data', () => {
  const benchPlayer = fixture.boxscore.players[0].statistics[0].athletes.find((a) => !a.starter && !a.didNotPlay);
  // ESPN shows this player as DNP (live), but at the synced moment he had played
  const { Box, doc } = setup({ dnpIds: [benchPlayer.athlete.id] });
  const snapshot = trimSnapshot(fixture);
  // and one starter isn't in the synced data at all
  const missing = snapshot.box[0].players.find((p) => p.starter);
  snapshot.box[0].players = snapshot.box[0].players.filter((p) => p !== missing);

  const { copy, result } = Box.buildCopy(Box.findOriginal(doc), snapshot);
  assert.equal(result.playersMatched, 25);
  assert.deepEqual(rowFor(copy, missing.id), Array(14).fill(''));
  assert.deepEqual(rowFor(copy, benchPlayer.athlete.id), snapshot.box[0].players.find((p) => p.id === benchPlayer.athlete.id).stats);
  assert.ok(!/\b99\b/.test(copy.textContent));
});

test('a team that can’t be matched means no copy (the panel is shown instead)', () => {
  const { Box, doc } = setup();
  const snapshot = trimSnapshot(fixture);
  snapshot.teams[0].name = 'Somewhere Else';
  snapshot.teams[0].shortName = 'Else';
  snapshot.teams[0].abbrev = 'ELS';
  assert.equal(Box.buildCopy(Box.findOriginal(doc), snapshot), null);
});
