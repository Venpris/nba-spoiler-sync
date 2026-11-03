// Rewriting copies of ESPN's Gamecast widgets with synced data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';
import { lastPlaysHtml, leadersHtml, teamStatsHtml, gameInfoHtml, playByPlayHtml, matchupTableHtml, MATCHUP_ROWS } from './helpers/espn-gamecast-markup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/espn-copy.js', '../src/content/espn-gamecast.js'].map(read);
const fixture = JSON.parse(read('./fixtures/game.json'));
const plays = trimPlays(fixture);
const snapshot = { capturedAt: 1, ...trimSnapshot(fixture, plays) };
const away = snapshot.teams.find((t) => t.homeAway === 'away');
const home = snapshot.teams.find((t) => t.homeAway === 'home');

function build(html, widget, synced = snapshot, syncedPlays = plays) {
  const { window } = new JSDOM(`<!doctype html><body><div class="PageLayout__Main">${html}</div></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  for (const src of sources) window.eval(src);
  const lib = window.NSSEspnGamecast[widget];
  const original = lib.findOriginal(window.document);
  return { original, built: original && lib.buildCopy(original, synced, syncedPlays) };
}

const shown = (el) => {
  for (let n = el; n; n = n.parentElement) if (n.style?.display === 'none' || n.style?.visibility === 'hidden') return false;
  return true;
};
const visibleText = (root) => [...root.querySelectorAll('*')].filter((el) => !el.children.length && el.textContent.trim() && shown(el)).map((el) => el.textContent.trim());

test('Last Plays: the newest synced plays, in ESPN’s cards', () => {
  const { built } = build(lastPlaysHtml(), 'lastPlays');
  const cards = [...built.copy.querySelectorAll('div')].filter((d) => d.querySelector(':scope > p'));
  assert.equal(cards.length, 5);
  const newest = [...plays].sort((a, b) => b.seq - a.seq).slice(0, 5);
  cards.forEach((card, i) => {
    const p = newest[i];
    assert.equal(card.querySelector(':scope > span').textContent, p.label);
    assert.equal(card.querySelector(':scope > p').textContent, p.text);
    assert.deepEqual([...card.querySelector(':scope > div:last-child').children].map((s) => s.textContent), [String(p.away), String(p.home)]);
    assert.ok(visibleText(card).some((t) => t === `${p.clock} - ${p.period <= 4 ? ['1st', '2nd', '3rd', '4th'][p.period - 1] : 'OT'}`));
  });
  // Live-only parts: the court animation and win probability.
  assert.ok(!shown(built.copy.querySelector('[data-testid="rive-animation-wrapper"]')));
  assert.ok(!visibleText(built.copy).some((t) => /win %/i.test(t)));
  assert.ok(!visibleText(built.copy).some((t) => /99|LIVE/.test(t)), visibleText(built.copy).join(' | '));
  // The team's color on the card's marker (for plays with a team), and no lazy image source.
  const i = newest.findIndex((p) => p.teamId);
  const team = snapshot.teams.find((t) => t.id === newest[i].teamId);
  assert.match(cards[i].querySelector('div[style*="radial"]').getAttribute('style'), new RegExp(`#${team.color}`));
  assert.ok(!cards[i].querySelector('source'));
});

test('Game Leaders: each team’s synced leader in points, rebounds and assists', () => {
  const { built } = build(leadersHtml({ away, home }), 'leaders');
  assert.equal(built.result.leaders, 6);
  const sections = [...built.copy.querySelectorAll('section section')];
  const [points] = sections;
  const awayEntry = snapshot.box.find((b) => b.teamId === away.id);
  const col = (label) => awayEntry.labels.indexOf(label);
  const top = awayEntry.players.filter((p) => p.stats.length).reduce((a, b) => (Number(b.stats[col('PTS')]) > Number(a.stats[col('PTS')]) ? b : a));
  const link = points.querySelector(':scope > a');
  assert.ok(link.textContent.includes(top.shortName));
  assert.ok(link.textContent.includes(`${top.stats[col('FG')].replace('-', '/')} FG, ${top.stats[col('FT')].replace('-', '/')} FT`));
  assert.match(link.getAttribute('href'), new RegExp(`/id/${top.id}/`));
  assert.deepEqual(
    sections.map((s) => s.querySelector('header span').textContent),
    ['Points', 'Rebounds', 'Assists'],
  );
  assert.ok(!visibleText(built.copy).some((t) => /99|L\. Player/.test(t)), visibleText(built.copy).join(' | '));
  assert.ok(visibleText(built.copy).includes('Game Leaders') && visibleText(built.copy).includes(away.abbrev));
  // The team logos above the leaders are the real ones, not ESPN's lazy placeholders.
  assert.deepEqual([...built.copy.querySelectorAll('a[href*="/team/"] img')].map((img) => img.getAttribute('src')), [away.logo, home.logo]);
});

test('Team Stats: synced values, labels and comparison bars', () => {
  const { built } = build(teamStatsHtml({ away, home }), 'teamStats');
  assert.equal(built.result.rows, 7);
  const stat = (team, name) => snapshot.teamStats.find((s) => s.teamId === team.id).stats.find((s) => s.name === name).value;
  const rows = [...built.copy.querySelectorAll('p')].filter((p) => !p.querySelector('span')).map((label) => label.parentElement);
  const fg = rows[0];
  const [m, a] = stat(away, 'fieldGoalsMade-fieldGoalsAttempted').split('-').map(Number);
  assert.equal(fg.children[1].textContent, 'Field Goal %');
  assert.equal(fg.children[0].textContent, `${Math.round((100 * m) / a)}%(${m}-${a})`);
  const fgBars = [...fg.parentElement.querySelectorAll('[data-testid="prism-ProgressBar"]')];
  assert.equal(parseFloat(fgBars[0].children[0].style.width).toFixed(1), ((100 * m) / a).toFixed(1));
  // Turnovers are ESPN's total turnovers (team turnovers included).
  const turnovers = rows.find((r) => r.children[1].textContent === 'Turnovers');
  assert.equal(turnovers.children[0].textContent, stat(away, 'totalTurnovers'));
  const share = parseFloat(turnovers.parentElement.querySelector('[data-testid="prism-ProgressBar"]').children[0].style.width);
  const [ta, th] = [away, home].map((t) => Number(stat(t, 'totalTurnovers')));
  assert.ok(Math.abs(share - (100 * ta) / (ta + th)) < 0.01);
  assert.equal(rows.find((r) => r.children[1].textContent === 'Percent Led').children[0].textContent, `${stat(away, 'leadPercentage')}%`);
  assert.ok(!visibleText(built.copy).some((t) => /99/.test(t)), visibleText(built.copy).join(' | '));
});

test('Game Information: unchanged, except attendance (posted after the game)', () => {
  const { built } = build(gameInfoHtml(), 'gameInfo');
  const text = visibleText(built.copy);
  assert.ok(text.includes('7:30 PM, November 2, 2026') && text.includes('Mesa, AZ') && text.includes('A. Official'));
  assert.ok(!text.some((t) => /19,812|Attendance/.test(t)));
});

test('Play-by-Play: every synced play, newest first, in ESPN’s list', () => {
  // The synced game a few minutes into the 3rd quarter.
  const synced = plays.slice(0, 300);
  const { built } = build(playByPlayHtml(), 'playByPlay', snapshot, synced);
  const items = [...built.copy.querySelectorAll('[data-testid="prism-Accordion"]')].map((s) => s.parentElement);
  assert.equal(items.length, synced.length);
  const newest = [...synced].sort((a, b) => b.seq - a.seq);
  items.forEach((item, i) => {
    const p = newest[i];
    const button = item.querySelector('button');
    assert.equal(button.querySelector('span').textContent, p.label);
    assert.equal(button.querySelector('p').textContent, p.text);
    const score = [...button.querySelectorAll('div')].find((d) => d.children.length === 2 && [...d.children].every((s) => s.tagName === 'SPAN'));
    if (!p.scoring) return assert.equal(score, undefined, 'only scoring plays show the score');
    assert.deepEqual([...score.children].map((s) => s.textContent), [String(p.away), String(p.home)]);
    // The scoring team's number is the bold one.
    const awayScored = p.teamId === away.id;
    assert.deepEqual([...score.children].map((s) => s.className), awayScored ? ['Bold', ''] : ['', 'Bold']);
  });
  // The shot chart, its filters, the placeholder and live win probability are gone.
  for (const sel of ['.ShotChart', '[data-testid="ShotChartFilterButtons"]']) assert.ok(!shown(built.copy.querySelector(sel)));
  assert.ok(!visibleText(built.copy).some((t) => /Win %|LIVE/.test(t)), visibleText(built.copy).filter((t) => /Win|LIVE/.test(t)).join(' | '));
  assert.ok(visibleText(built.copy).includes('All Plays') && visibleText(built.copy).includes('PLAYS'));
});

test('Team Stats page table: every row synced, away team then home', () => {
  const { built } = build(matchupTableHtml(), 'matchupTable');
  assert.equal(built.result.rows, MATCHUP_ROWS.length);
  const statsFor = (team) => snapshot.teamStats.find((s) => s.teamId === team.id).stats;
  for (const row of built.copy.querySelectorAll('tbody tr')) {
    const [label, a, h] = [...row.children].map((td) => td.textContent);
    const expected = [away, home].map((t) => statsFor(t).find((s) => s.label === label)?.value ?? '');
    assert.deepEqual([a, h], expected, label);
  }
  // Rows the synced data doesn't have stay blank rather than showing ESPN's live value.
  assert.ok(!visibleText(built.copy).some((t) => /99/.test(t)));
  assert.ok(visibleText(built.copy).includes('3PT') && visibleText(built.copy).includes('Team Stats'));
  assert.deepEqual([...built.copy.querySelectorAll('thead img')].map((img) => img.getAttribute('src')), [away.logo, home.logo]);
});

test('widgets that can’t be matched give no copy', () => {
  const noCards = build('<section class="LastPlays__Basketball"><p>LIVE</p></section>', 'lastPlays');
  assert.equal(noCards.built, null);
  const noLeaders = build('<div><section><h2>Game Leaders</h2><p>LIVE 99</p></section></div>', 'leaders');
  assert.equal(noLeaders.built, null);
});
