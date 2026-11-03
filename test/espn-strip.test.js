// rewriting a copy of ESPN's own score strip with synced data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimSnapshot } from '../src/lib/espn.js';
import { espnStripHtml } from './helpers/espn-strip-markup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/espn-copy.js', '../src/content/espn-strip.js'].map(read);
const fixture = JSON.parse(read('./fixtures/game.json'));
const base = trimSnapshot(fixture);
const away = base.teams.find((t) => t.homeAway === 'away');
const home = base.teams.find((t) => t.homeAway === 'home');

// the synced game in the 3rd quarter
function midGame() {
  const s = structuredClone(base);
  s.status = { state: 'in', detail: '', period: 3, clock: '7:42', endOfPeriod: false };
  for (const t of s.teams) {
    t.linescores = t.linescores.slice(0, 3);
    t.score = String(t.linescores.reduce((n, v) => n + Number(v), 0));
  }
  return s;
}

function build(markup, snapshot) {
  const { window } = new JSDOM(`<!doctype html><body>${espnStripHtml({ away, home, ...markup })}</body>`, { runScripts: 'outside-only' });
  for (const src of sources) window.eval(src);
  const original = window.NSSEspnStrip.findOriginal(window.document);
  return { original, built: window.NSSEspnStrip.buildCopy(original, snapshot) };
}

const isHidden = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style?.visibility === 'hidden') return true;
  return false;
};
const visibleText = (root) =>
  [...root.querySelectorAll('*')].filter((el) => !el.children.length && el.textContent.trim() && !isHidden(el)).map((el) => el.textContent.replace(/ /g, ' ').trim());

test('live strip, synced to the 3rd quarter: score, clock, quarters and records all synced', () => {
  const snapshot = midGame();
  const { original, built } = build({ state: 'in' }, snapshot);
  const { copy } = built;
  const sAway = snapshot.teams.find((t) => t.homeAway === 'away');
  const sHome = snapshot.teams.find((t) => t.homeAway === 'home');

  assert.equal(copy.querySelector('.half.away .score').textContent, sAway.score);
  assert.equal(copy.querySelector('.half.home .score').textContent, sHome.score);
  assert.deepEqual([...copy.querySelectorAll('.status span')].map((s) => s.textContent), ['7:42', ' - ', '3rd']);
  // quarter table has three synced quarters, the 4th blank, then the total
  const rows = [...copy.querySelectorAll('tbody tr')].map((tr) => [...tr.children].slice(1).map((td) => td.textContent));
  assert.deepEqual(rows[0], [...sAway.linescores, '', sAway.score]);
  assert.deepEqual(rows[1], [...sHome.linescores, '', sHome.score]);
  assert.deepEqual([...copy.querySelectorAll('thead th')].map((th) => th.textContent), ['', '1', '2', '3', '4', 'T']);
  // records as of the synced moment
  assert.deepEqual([...copy.querySelectorAll('.half.away .record')].map((r) => r.textContent), Array(2).fill(`${sAway.record.total}, ${sAway.record.venue} Away`));
  assert.deepEqual([...copy.querySelectorAll('.half.home .record')].map((r) => r.textContent), Array(2).fill(`${sHome.record.total}, ${sHome.record.venue} Home`));

  // ESPN's lazy logo placeholders become the real logos, styling kept
  for (const [side, team] of [['away', away], ['home', home]]) {
    const picture = copy.querySelector(`.half.${side} a.logo picture`);
    assert.equal(picture.querySelector('source'), null);
    assert.equal(picture.querySelector('img').getAttribute('src'), team.logo);
    assert.equal(picture.querySelector('img').className, 'logo-img');
  }

  // live-only details are hidden and none of ESPN's live values show
  for (const el of copy.querySelectorAll('.timeouts > div, .bonus')) assert.ok(isHidden(el));
  assert.ok(!visibleText(copy).some((t) => /99/.test(t)), visibleText(copy).join(' | '));
  // team names and the button stay, and ESPN's original is untouched
  assert.ok(visibleText(copy).includes(away.name) && visibleText(copy).includes('NBA League Pass'));
  assert.equal(original.querySelector('.half.away .score').textContent, '99');
});

test('quarter breaks read like ESPN: end of quarter, halftime', () => {
  for (const [period, text] of [[3, 'End of 3rd'], [2, 'Halftime']]) {
    const snapshot = midGame();
    snapshot.status = { ...snapshot.status, period, endOfPeriod: true };
    const { built } = build({ state: 'in' }, snapshot);
    assert.deepEqual([...built.copy.querySelectorAll('.status span')].map((s) => s.textContent), [text, '', '']);
  }
});

test('live game in overtime, synced to the 4th: no overtime column yet', () => {
  const snapshot = midGame();
  snapshot.status.period = 4;
  for (const t of snapshot.teams) t.linescores.push('20');
  const { built } = build({ state: 'in', periods: 5 }, snapshot);
  assert.deepEqual([...built.copy.querySelectorAll('thead th')].map((th) => th.textContent), ['', '1', '2', '3', '4', 'T']);
  assert.equal(built.copy.querySelector('tbody tr').children.length, 6);
});

test('synced game in overtime adds the column ESPN would show', () => {
  const snapshot = midGame();
  snapshot.status.period = 5;
  for (const t of snapshot.teams) t.linescores.push('20', '9');
  const { built } = build({ state: 'in', periods: 4 }, snapshot);
  assert.deepEqual([...built.copy.querySelectorAll('thead th')].map((th) => th.textContent), ['', '1', '2', '3', '4', 'OT', 'T']);
  assert.equal(built.copy.querySelector('tbody tr').children[5].textContent, '9');
});

test('a finished game on ESPN gives nothing away: winner styling undone, Final replaced', () => {
  const snapshot = midGame();
  const { original, built } = build({ state: 'post' }, snapshot);
  const { copy } = built;
  // ESPN's markup marks the home team as the winner
  assert.ok(original.querySelector('.half.home .score svg'));
  assert.notEqual(original.querySelector('.half.away .score').className, original.querySelector('.half.home .score').className);
  // but the copy doesn't
  for (const sel of ['.score', '.name', '.record']) {
    assert.equal(copy.querySelector(`.half.away ${sel}`).className, copy.querySelector(`.half.home ${sel}`).className, sel);
  }
  assert.ok([...copy.querySelectorAll('svg')].every(isHidden));
  assert.ok(!visibleText(copy).includes('Final'));
  // ESPN's finished strip has two text slots instead of three, but the clock still reads right
  assert.equal(copy.querySelector('.status span').textContent, '7:42 - 3rd');
});

test('notes ESPN adds (like a playoff series score) are cleared', () => {
  const { built } = build({ state: 'in', note: 'Game 4 · HAR leads series 2-1' }, midGame());
  assert.equal(built.copy.querySelector('.note span').textContent, '');
});

test('a team that can’t be matched means no copy (our own strip is shown)', () => {
  const snapshot = midGame();
  snapshot.teams[0].abbrev = 'XYZ';
  assert.equal(build({ state: 'in' }, snapshot).built, null);
});
