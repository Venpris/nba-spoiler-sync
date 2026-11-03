// Runs the real content scripts against skeletons of ESPN's game page in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/nav-hook.js', '../src/content/view.js', '../src/content/shield.js'].map(read);
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

// The rules in shield.css that hide things, and a check of whether an element ends up
// hidden by them (or by an inline display: none, standing in for ESPN's own CSS).
const rules = [...css.matchAll(/^(html\[[^{]+)\{([^}]*)\}/gm)]
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
  // jsdom has no layout; answer Chrome's checkVisibility() from the hiding rules.
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
    // Elements standing in for live data (their text says LIVE).
    live: () => [...doc.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('LIVE'))),
  };
}

for (const [layout, html] of Object.entries(layouts)) {
  test(`synced game page, ${layout} layout: blank until known, then ESPN content replaced by ours`, async () => {
    const page = load(html, BOX_URL);
    const { doc } = page;

    // Before the background answers, the whole page is blank and the ticker hidden.
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

    // Every live element is hidden; our panel, ESPN's game tabs and site header are not.
    const live = page.live();
    assert.ok(live.length >= 4);
    for (const el of live) assert.ok(page.isHidden(el), `visible: ${el.className || el.tagName} "${el.textContent.trim()}"`);
    for (const sel of ['#nss-strip', '#nss-root', '.NavSecondary--GamePackage', '.Site__Header']) {
      assert.ok(!page.isHidden(doc.querySelector(sel)), `${sel} is hidden`);
    }

    // Our panel shows the synced box score; the tab title is ours.
    const root = doc.getElementById('nss-root');
    assert.ok(root.textContent.includes('Starters'));
    assert.ok(doc.getElementById('nss-strip').textContent.includes('synced to your stream'));
    assert.equal(doc.title, 'HAR @ MES · Spoiler Sync');

    // ESPN re-rendering over the panel, or retitling the tab, gets undone.
    root.remove();
    doc.title = 'Herons 101-99 Coyotes';
    await wait(10);
    assert.ok(doc.getElementById('nss-root')?.isConnected);
    assert.ok(!page.isHidden(doc.getElementById('nss-root')));
    assert.equal(doc.title, 'HAR @ MES · Spoiler Sync');

    // In-page navigation: leaving the game removes our panel...
    page.window.history.pushState({}, '', '/nba/scoreboard');
    assert.ok(!page.attrs().includes('data-nss-here'));
    assert.equal(doc.getElementById('nss-root'), null);
    assert.equal(doc.querySelectorAll('[data-nss-keep]').length, 0);

    // ...and coming back to another tab of it shows that tab's synced view.
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
    // The other game shows normally; only the ticker stays hidden.
    const visible = page.live().filter((el) => !page.isHidden(el)).map((el) => el.textContent.trim());
    assert.ok(visible.includes('LIVE score strip') && visible.includes('LIVE box score'), visible.join(', '));
    assert.ok(!visible.includes('LIVE ticker'));
  });
}

test('if ESPN hides the spot the panel was put in, it shows on its own instead', async () => {
  // Stand-in for ESPN CSS hiding the area below the tabs.
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
  // Every card is hidden until the synced game is known...
  assert.equal(page.matches(rule('section.Scoreboard')).length, 2);
  page.send({ type: 'config', game: GAME });
  assert.equal(page.matches(rule('section.Scoreboard')).length, 0);

  // ...then only the synced game's ESPN content stays hidden.
  const style = doc.getElementById('nss-dynamic').textContent;
  const espnRule = /([^{}]+> :not\(#nss-scorecard\))\s*\{/.exec(style)[1].trim();
  const hiddenNow = () => page.matches(espnRule);
  assert.deepEqual(hiddenNow().map((el) => el.className), ['Scoreboard__RowContainer', 'Scoreboard__Callouts']);

  // Our card goes on top once the page has settled, and says what's going on.
  await wait(MOUNT_WAIT);
  const card = () => doc.getElementById('nss-scorecard');
  assert.equal(card().parentElement.id, '900000001');
  assert.ok(!hiddenNow().includes(card()));
  page.send({ type: 'view', view: { status: 'unsynced' } });
  assert.match(card().textContent, /Sync to your stream/);
  assert.ok(card().querySelector('a[href="/nba/boxscore/_/gameId/900000001"]'));

  // Ready: synced score, status and links to the game's pages.
  page.send({ type: 'view', view: readyView });
  const away = readyView.snapshot.teams.find((t) => t.homeAway === 'away');
  assert.ok(card().textContent.includes(away.score));
  assert.match(card().textContent, /Synced to your stream/);
  assert.deepEqual(
    [...card().querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ['/nba/game/_/gameId/900000001', '/nba/boxscore/_/gameId/900000001', '/nba/playbyplay/_/gameId/900000001'],
  );

  // ESPN re-rendering the card puts ours back.
  card().remove();
  await wait(10);
  assert.equal(card()?.parentElement.id, '900000001');
  assert.ok(card().textContent.includes(away.score));
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
