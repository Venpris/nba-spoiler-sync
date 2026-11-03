// runs the real content scripts against skeletons of ESPN's game page in jsdom
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';
import { espnBoxHtml } from './helpers/espn-box-markup.js';
import { espnStripHtml } from './helpers/espn-strip-markup.js';
import { espnCardHtml } from './helpers/espn-card-markup.js';
import { gamecastColumnsHtml, playByPlayHtml, gameInfoHtml, matchupTableHtml, leadersHtml, teamStatsHtml } from './helpers/espn-gamecast-markup.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = [
  '../src/content/nav-hook.js',
  '../src/content/view.js',
  '../src/content/espn-copy.js',
  '../src/content/espn-box.js',
  '../src/content/espn-strip.js',
  '../src/content/espn-card.js',
  '../src/content/espn-gamecast.js',
  '../src/content/shield.js',
].map(read);
const css = read('../src/content/shield.css');
const layouts = {
  'July 2026': read('./fixtures/espn-gamepage-2026-07.html'),
  'October 2026': read('./fixtures/espn-gamepage-2026-10.html'),
};
const fixture = JSON.parse(read('./fixtures/game.json'));
const readyView = { status: 'ready', snapshot: { capturedAt: 1, ...trimSnapshot(fixture) }, plays: trimPlays(fixture) };
const GAME = { id: '900000001', shortName: 'HAR @ MES', away: 'HAR', home: 'MES' };
const BOX_URL = 'https://www.espn.com/nba/boxscore/_/gameId/900000001';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MOUNT_WAIT = 1200;

// the hiding rules in shield.css, and a check for whether an element ends up hidden by
// them (or by an inline display: none, standing in for ESPN's own CSS)
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter((m) => /display:\s*none|visibility:\s*hidden/.test(m[2]))
  .map((m) => m[1].trim());
const rule = (needle) => rules.find((r) => r.includes(needle));
function hiddenCheck(doc) {
  const matched = new Set(rules.flatMap((r) => [...doc.querySelectorAll(r)]));
  return (el) => {
    for (let n = el; n; n = n.parentElement) if (matched.has(n) || n.style?.display === 'none') return true;
    return false;
  };
}

function load(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let listener = null;
  window.chrome = {
    runtime: {
      connect: () => ({
        onMessage: { addListener: (fn) => (listener = fn) },
        onDisconnect: { addListener() {} },
        postMessage() {},
      }),
    },
  };
  // jsdom has no layout, so answer Chrome's checkVisibility() from the hiding rules
  window.Element.prototype.checkVisibility = function () {
    return !hiddenCheck(window.document)(this);
  };
  for (const src of sources) window.eval(src);
  const doc = window.document;
  return {
    window,
    doc,
    send: (msg) => listener(structuredClone(msg)),
    attrs: () => [...doc.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-nss')).sort(),
    matches: (selector) => [...doc.querySelectorAll(selector)],
    isHidden: (el) => hiddenCheck(doc)(el),
    // elements standing in for live data (their text says LIVE)
    live: () => [...doc.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('LIVE'))),
  };
}

for (const [layout, html] of Object.entries(layouts)) {
  test(`synced game page, ${layout} layout: blank until known, then ESPN content replaced by ours`, async () => {
    const page = load(html, BOX_URL);
    const { doc } = page;

    // before the background answers, the page is blank and the ticker hidden
    assert.deepEqual(page.attrs(), ['data-nss-gamepage', 'data-nss-on']);
    assert.ok(page.isHidden(doc.body));

    page.send({ type: 'config', game: GAME });
    assert.ok(page.attrs().includes('data-nss-here'));
    assert.ok(page.isHidden(doc.body), 'still blank until our panel is mounted');

    await wait(MOUNT_WAIT);
    page.send({ type: 'view', view: readyView });
    assert.ok(page.attrs().includes('data-nss-mounted'));
    assert.ok(!page.attrs().includes('data-nss-fallback'));
    const offset = doc.querySelector('.Gamestrip__ContentOffset');
    assert.equal(offset.firstElementChild.id, 'nss-strip');
    assert.ok(doc.getElementById('nss-root').previousElementSibling.matches('.NavSecondary--GamePackage'));

    // every live element is hidden, but not our panel, ESPN's game tabs or the site header
    const live = page.live();
    assert.ok(live.length >= 4);
    for (const el of live) assert.ok(page.isHidden(el), `visible: ${el.className || el.tagName} "${el.textContent.trim()}"`);
    for (const sel of ['#nss-strip', '#nss-root', '.NavSecondary--GamePackage', '.Site__Header']) {
      assert.ok(!page.isHidden(doc.querySelector(sel)), `${sel} is hidden`);
    }

    // our panel shows the synced box score and the tab title is ours
    const root = doc.getElementById('nss-root');
    assert.ok(root.textContent.includes('Starters'));
    assert.ok(doc.getElementById('nss-strip').textContent.includes('synced to your stream'));
    assert.equal(doc.title, 'HAR @ MES · Spoiler Sync');

    // ESPN re-rendering over the panel, or retitling the tab, gets undone
    root.remove();
    doc.title = 'Herons 101-99 Coyotes';
    await wait(10);
    assert.ok(doc.getElementById('nss-root')?.isConnected);
    assert.ok(!page.isHidden(doc.getElementById('nss-root')));
    assert.equal(doc.title, 'HAR @ MES · Spoiler Sync');

    // in-page navigation away from the game removes our panel
    page.window.history.pushState({}, '', '/nba/scoreboard');
    assert.ok(!page.attrs().includes('data-nss-here'));
    assert.equal(doc.getElementById('nss-root'), null);
    assert.equal(doc.querySelectorAll('[data-nss-keep]').length, 0);

    // and coming back to another of its tabs shows that tab's synced view
    page.window.history.pushState({}, '', '/nba/playbyplay/_/gameId/900000001');
    assert.ok(page.attrs().includes('data-nss-here'));
    assert.ok(doc.getElementById('nss-root').textContent.includes('4th Quarter'));
    for (const el of page.live()) assert.ok(page.isHidden(el));
  });

  test(`other games are left alone, ${layout} layout`, () => {
    const page = load(html.replaceAll('900000001', '401810999'), 'https://www.espn.com/nba/boxscore/_/gameId/401810999');
    assert.ok(page.isHidden(page.doc.body));
    page.send({ type: 'config', game: GAME });
    assert.deepEqual(page.attrs(), ['data-nss-gamepage', 'data-nss-on', 'data-nss-ready']);
    // the other game shows normally, only the ticker stays hidden
    const visible = page.live().filter((el) => !page.isHidden(el)).map((el) => el.textContent.trim());
    assert.ok(visible.includes('LIVE score strip') && visible.includes('LIVE box score'), visible.join(', '));
    assert.ok(!visible.includes('LIVE ticker'));
  });
}

test('Box Score page: ESPN’s own box score, rewritten with synced stats', async () => {
  const teams = readyView.snapshot.teams;
  const html = layouts['October 2026']
    .replace(/<section class="Card Card__TableTopBorder">[\s\S]*?<\/section>/, espnBoxHtml(fixture))
    .replace(/<section class="Gamestrip__StickyContainer">[\s\S]*?<\/section>/, espnStripHtml({ away: teams.find((t) => t.homeAway === 'away'), home: teams.find((t) => t.homeAway === 'home') }));
  const page = load(html, BOX_URL);
  const { doc } = page;
  const copy = () => doc.querySelector('[data-nss-copy="box"]');
  const stripCopy = () => doc.querySelector('[data-nss-copy="strip"]');
  const original = () => [...doc.querySelectorAll('.Boxscore__ResponsiveWrapper')].find((el) => !el.closest('[data-nss-copy]')).closest('section');
  const originalStrip = () => [...doc.querySelectorAll('.Gamestrip__StickyContainer')].find((el) => !el.closest('[data-nss-copy]'));
  // ESPN's live numbers (99 in this markup) must never show outside our own panel and copies
  const visible99 = () => {
    const isHidden = hiddenCheck(doc);
    return [...doc.querySelectorAll('body *')].filter(
      (el) => !el.children.length && /99/.test(el.textContent) && !el.closest('#nss-root, #nss-strip, [data-nss-copy]') && !isHidden(el),
    );
  };

  page.send({ type: 'config', game: GAME });
  await wait(MOUNT_WAIT);

  // before syncing, our strip and panel explain while ESPN's strip and box score stay hidden
  page.send({ type: 'view', view: { status: 'loading', readyInMs: 30_000 } });
  assert.equal(copy(), null);
  assert.equal(stripCopy(), null);
  assert.match(doc.getElementById('nss-strip').textContent, /Getting ready/);
  assert.match(doc.getElementById('nss-root').textContent, /Hidden by Spoiler Sync/);
  assert.equal(visible99().length, 0);

  // once synced, the copies sit where ESPN's strip and box score were, and ESPN's
  // originals and our own strip and panel are hidden
  page.send({ type: 'view', view: readyView });
  assert.ok(copy() && !page.isHidden(copy()));
  assert.equal(original().nextElementSibling, copy());
  assert.ok(page.isHidden(original()));
  assert.ok(stripCopy() && !page.isHidden(stripCopy()));
  assert.equal(originalStrip().nextElementSibling, stripCopy());
  assert.ok(page.isHidden(originalStrip()));
  assert.ok(stripCopy().textContent.includes(teams[0].score));
  assert.ok(page.isHidden(doc.getElementById('nss-root')));
  assert.ok(page.isHidden(doc.getElementById('nss-strip')));
  assert.ok(page.isHidden([...doc.querySelectorAll('div')].find((d) => d.textContent === 'LIVE mini score')));
  assert.equal(visible99().length, 0);
  const firstPlayer = readyView.snapshot.box[0].players.find((p) => p.stats.length);
  assert.ok(copy().textContent.includes(firstPlayer.stats[2]));

  // a newer synced moment rebuilds the copy with the new numbers
  const later = structuredClone(readyView);
  later.snapshot.capturedAt = 2;
  later.snapshot.box[0].players.find((p) => p.id === firstPlayer.id).stats[1] = '42';
  page.send({ type: 'view', view: later });
  assert.ok(copy().textContent.includes('42'));

  // if ESPN re-renders its box score, the copy is rebuilt next to the new original
  const replacement = original().cloneNode(true);
  original().replaceWith(replacement);
  await wait(10);
  assert.equal(replacement.nextElementSibling, copy());
  assert.equal(doc.querySelectorAll('[data-nss-copy="box"]').length, 1);
  assert.equal(visible99().length, 0);

  // leaving the Box Score tab for Play-by-Play drops the box score copy and brings the panel back
  // ESPN's strip stays (synced) on every game page
  page.window.history.pushState({}, '', '/nba/playbyplay/_/gameId/900000001');
  assert.equal(copy(), null);
  assert.ok(stripCopy() && !page.isHidden(stripCopy()));
  assert.ok(doc.getElementById('nss-root').textContent.includes('4th Quarter'));
  assert.equal(visible99().length, 0);
});

test('Gamecast page: ESPN’s text widgets, synced; everything else hidden', async () => {
  const teams = readyView.snapshot.teams;
  const pair = { away: teams.find((t) => t.homeAway === 'away'), home: teams.find((t) => t.homeAway === 'home') };
  const html = layouts['October 2026'].replace(/<div class="PageLayout page-container cf PageLayout--desktopLg">[\s\S]*?<\/aside>\s*<\/div>/, gamecastColumnsHtml(pair));
  const page = load(html, 'https://www.espn.com/nba/game/_/gameId/900000001');
  const { doc } = page;
  page.send({ type: 'config', game: GAME });
  await wait(MOUNT_WAIT);

  // before syncing, our panel explains and none of ESPN's widgets show
  page.send({ type: 'view', view: { status: 'loading', readyInMs: 5_000 } });
  assert.equal(doc.querySelectorAll('[data-nss-copy]').length, 0);
  for (const el of page.live()) assert.ok(page.isHidden(el), `visible: "${el.textContent.trim()}"`);

  // once synced, each text widget gets a copy right after its hidden original
  page.send({ type: 'view', view: readyView });
  for (const name of ['lastPlays', 'leaders', 'teamStats', 'gameInfo']) {
    const copy = doc.querySelector(`[data-nss-copy="${name}"]`);
    assert.ok(copy && !page.isHidden(copy), `${name} shown`);
    assert.ok(page.isHidden(copy.previousElementSibling), `${name} original hidden`);
  }
  assert.ok(doc.querySelector('[data-nss-copy="lastPlays"] p').textContent.length > 0);
  // win probability, lineups, highlights, odds and standings stay hidden, as does our panel
  for (const el of page.live()) assert.ok(page.isHidden(el), `visible: "${el.textContent.trim()}"`);
  assert.ok(page.isHidden(doc.getElementById('nss-root')));
});

test('Play-by-Play page: ESPN’s play list, synced; shot chart and the rest hidden', async () => {
  const columns = `
    <div class="PageLayout page-container cf PageLayout--desktopLg">
      <div class="PageLayout__Main">${playByPlayHtml()}</div>
      <div class="PageLayout__RightAside">${gameInfoHtml()}<div class="Standings"><h2>Standings</h2><span>LIVE 99-99</span></div></div>
    </div>`;
  const html = layouts['October 2026'].replace(/<div class="PageLayout page-container cf PageLayout--desktopLg">[\s\S]*?<\/aside>\s*<\/div>/, columns);
  const page = load(html, 'https://www.espn.com/nba/playbyplay/_/gameId/900000001');
  const { doc } = page;
  page.send({ type: 'config', game: GAME });
  await wait(MOUNT_WAIT);
  page.send({ type: 'view', view: readyView });

  const list = doc.querySelector('[data-nss-copy="playByPlay"]');
  assert.ok(list && !page.isHidden(list));
  assert.equal(list.querySelectorAll('[data-testid="prism-Accordion"]').length, readyView.plays.length);
  assert.ok(!page.isHidden(doc.querySelector('[data-nss-copy="gameInfo"]')));
  for (const el of page.live()) assert.ok(page.isHidden(el), `visible: "${el.textContent.trim()}"`);
  assert.ok(page.isHidden(doc.getElementById('nss-root')));
});

test('Team Stats page: ESPN’s table and side widgets, synced; the rest hidden', async () => {
  const teams = readyView.snapshot.teams;
  const pair = { away: teams.find((t) => t.homeAway === 'away'), home: teams.find((t) => t.homeAway === 'home') };
  const columns = `
    <div class="PageLayout page-container cf PageLayout--desktopLg">
      <div class="PageLayout__LeftAside">${leadersHtml(pair)}${teamStatsHtml(pair)}${gameInfoHtml()}</div>
      <div class="PageLayout__Main">${matchupTableHtml()}</div>
      <div class="PageLayout__RightAside"><div class="Standings"><h2>Standings</h2><span>LIVE 99-99</span></div></div>
    </div>`;
  const html = layouts['October 2026'].replace(/<div class="PageLayout page-container cf PageLayout--desktopLg">[\s\S]*?<\/aside>\s*<\/div>/, columns);
  const page = load(html, 'https://www.espn.com/nba/matchup/_/gameId/900000001');
  const { doc } = page;
  page.send({ type: 'config', game: GAME });
  await wait(MOUNT_WAIT);
  page.send({ type: 'view', view: readyView });

  for (const name of ['matchupTable', 'leaders', 'teamStats', 'gameInfo']) {
    const copy = doc.querySelector(`[data-nss-copy="${name}"]`);
    assert.ok(copy && !page.isHidden(copy), `${name} shown`);
  }
  // ESPN's live values (99) show nowhere outside our copies
  const isHidden = (el) => page.isHidden(el);
  const live99 = [...doc.querySelectorAll('body *')].filter((el) => !el.children.length && /99/.test(el.textContent) && !el.closest('[data-nss-copy], #nss-root, #nss-strip') && !isHidden(el));
  assert.deepEqual(live99.map((el) => el.textContent), []);
  for (const el of page.live()) assert.ok(page.isHidden(el), `visible: "${el.textContent.trim()}"`);
  assert.ok(page.isHidden(doc.getElementById('nss-root')));
});

test('if ESPN hides the spot the panel was put in, it shows on its own instead', async () => {
  // stand-in for ESPN CSS hiding the area below the tabs
  const html = layouts['October 2026'].replace('<section class="Gamestrip__ContentOffset">', '<section class="Gamestrip__ContentOffset" style="display: none">');
  const page = load(html, BOX_URL);
  page.send({ type: 'config', game: GAME });
  page.send({ type: 'view', view: readyView });
  await wait(MOUNT_WAIT);
  assert.ok(page.attrs().includes('data-nss-fallback'));
  const root = page.doc.getElementById('nss-root');
  assert.equal(root.parentElement, page.doc.body);
  assert.ok(!page.isHidden(root));
  assert.ok(root.textContent.includes('Starters'));
  for (const el of page.live()) assert.ok(page.isHidden(el));
});

test('scoreboard: the synced game gets our card with the synced score and links', async () => {
  const html = `<!doctype html><html><head></head><body>
    <section class="Scoreboard" id="900000001"><div class="Scoreboard__RowContainer">LIVE 101-99</div><div class="Scoreboard__Callouts">Box Score</div></section>
    <section class="Scoreboard" id="401810434"><div>Other game</div></section>
  </body></html>`;
  const page = load(html, 'https://www.espn.com/nba/scoreboard');
  const { doc } = page;
  // every card is hidden until the synced game is known
  assert.equal(page.matches(rule('section.Scoreboard')).length, 2);
  page.send({ type: 'config', game: GAME });
  assert.equal(page.matches(rule('section.Scoreboard')).length, 0);

  // then only the synced game's ESPN content stays hidden
  const style = doc.getElementById('nss-dynamic').textContent;
  const espnRule = /([^{}]+> :not\(#nss-scorecard\))\s*\{/.exec(style)[1].trim();
  const hiddenNow = () => page.matches(espnRule);
  assert.deepEqual(hiddenNow().map((el) => el.className), ['Scoreboard__RowContainer', 'Scoreboard__Callouts']);

  // our card goes on top once the page has settled, and says what's going on
  await wait(MOUNT_WAIT);
  const card = () => doc.getElementById('nss-scorecard');
  assert.equal(card().parentElement.id, '900000001');
  assert.ok(!hiddenNow().includes(card()));
  page.send({ type: 'view', view: { status: 'unsynced' } });
  assert.match(card().textContent, /Sync to your stream/);
  assert.ok(card().querySelector('a[href="/nba/boxscore/_/gameId/900000001"]'));

  // once ready, it shows the synced score, status and links to the game's pages
  page.send({ type: 'view', view: readyView });
  const away = readyView.snapshot.teams.find((t) => t.homeAway === 'away');
  assert.ok(card().textContent.includes(away.score));
  assert.match(card().textContent, /Synced to your stream/);
  assert.deepEqual(
    [...card().querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ['/nba/game/_/gameId/900000001', '/nba/boxscore/_/gameId/900000001', '/nba/playbyplay/_/gameId/900000001'],
  );

  // ESPN re-rendering the card puts ours back
  card().remove();
  await wait(10);
  assert.equal(card()?.parentElement.id, '900000001');
  assert.ok(card().textContent.includes(away.score));
});

test('scoreboard: once synced, ESPN’s own card shows the synced game', async () => {
  const teams = readyView.snapshot.teams;
  const pair = { away: teams.find((t) => t.homeAway === 'away'), home: teams.find((t) => t.homeAway === 'home') };
  const html = `<!doctype html><html><head></head><body>${espnCardHtml({ id: '900000001', ...pair })}${espnCardHtml({ id: '900000002', ...pair })}</body></html>`;
  const page = load(html, 'https://www.espn.com/nba/scoreboard');
  const { doc } = page;
  const original = doc.getElementById('900000001');
  const copy = () => doc.querySelector('[data-nss-copy="card"]');
  const originalHidden = () => doc.querySelector(`html[data-nss-card-copy] section.Scoreboard[id="900000001"]`) === original;

  page.send({ type: 'config', game: GAME });
  await wait(MOUNT_WAIT);

  // before syncing, our own card covers ESPN's
  page.send({ type: 'view', view: { status: 'unsynced' } });
  assert.equal(copy(), null);
  assert.equal(doc.getElementById('nss-scorecard')?.parentElement, original);

  // once synced, ESPN's card is hidden with a synced copy right after it
  page.send({ type: 'view', view: readyView });
  assert.equal(original.nextElementSibling, copy());
  assert.ok(originalHidden());
  assert.equal(doc.getElementById('nss-scorecard'), null);
  assert.ok(copy().textContent.includes(pair.away.score) && copy().textContent.includes('Top Performers'));
  assert.ok(!/\b99\b/.test(copy().textContent));
  // the other game's card is untouched
  assert.ok(doc.getElementById('900000002').textContent.includes('99'));

  // if ESPN re-renders its list, the copy is put back
  copy().remove();
  await wait(10);
  assert.equal(original.nextElementSibling, copy());
  assert.ok(originalHidden());
});

test('unrecognized layout falls back to showing only our panel', async () => {
  const html = `<!doctype html><html><head><title>Recap</title></head><body><div id="espnfitt">LIVE recap</div></body></html>`;
  const page = load(html, 'https://www.espn.com/nba/recap/_/gameId/900000001');
  page.send({ type: 'config', game: GAME });
  page.send({ type: 'view', view: readyView });
  await wait(MOUNT_WAIT);
  assert.ok(page.attrs().includes('data-nss-fallback'));
  const hidden = page.matches(rule('data-nss-fallback'));
  assert.deepEqual(hidden.map((el) => el.id), ['espnfitt']);
  assert.match(page.doc.getElementById('nss-root').textContent, /hidden while Spoiler Sync is on/);
});
