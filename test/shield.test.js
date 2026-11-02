// Runs the real content scripts against a skeleton of ESPN's game page in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { trimPlays, trimSnapshot } from '../src/lib/espn.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = ['../src/content/nav-hook.js', '../src/content/view.js', '../src/content/shield.js'].map(read);
const css = read('../src/content/shield.css');
const gamePage = read('./fixtures/espn-gamepage.html');
const fixture = JSON.parse(read('./fixtures/summary-401810433.json'));
const readyView = { status: 'ready', snapshot: { capturedAt: 1, ...trimSnapshot(fixture) }, plays: trimPlays(fixture) };
const GAME = { id: '401810433', shortName: 'MEM @ ORL', away: 'MEM', home: 'ORL' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MOUNT_WAIT = 1200;

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
  for (const src of sources) window.eval(src);
  const doc = window.document;
  return {
    window,
    doc,
    send: (msg) => listener(structuredClone(msg)),
    attrs: () => [...doc.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-nss')).sort(),
    matches: (selector) => [...doc.querySelectorAll(selector)],
  };
}

// The hiding selectors from shield.css, keyed by the comment-free rule text.
const rules = [...css.matchAll(/^(html\[[^{]+)\{/gm)].map((m) => m[1].trim());
const rule = (needle) => rules.find((r) => r.includes(needle));

test('the synced game page: blank until known, then ESPN content replaced by ours', async () => {
  const page = load(gamePage, 'https://www.espn.com/nba/boxscore/_/gameId/401810433');
  const { doc } = page;

  // Before the background answers, the whole page is blank and the ticker hidden.
  assert.deepEqual(page.attrs(), ['data-nss-gamepage', 'data-nss-on']);
  assert.equal(page.matches(rule('data-nss-gamepage')).length, 1); // body
  assert.equal(page.matches(rule('HeaderScoreboardWrapper')).length, 1);

  page.send({ type: 'config', game: GAME });
  assert.ok(page.attrs().includes('data-nss-here'));
  // Still blank until our panel is mounted.
  assert.equal(page.matches(rule('not([data-nss-mounted])')).length, 1);

  await wait(MOUNT_WAIT);
  page.send({ type: 'view', view: readyView });
  const offset = doc.querySelector('.Gamestrip__ContentOffset');
  assert.equal(offset.firstElementChild.id, 'nss-strip');
  assert.equal(doc.getElementById('nss-root').previousElementSibling.tagName, 'NAV');
  assert.ok(page.attrs().includes('data-nss-mounted'));
  assert.equal(page.matches(rule('not([data-nss-mounted])')).length, 0);

  // ESPN's score strip and everything below the tabs is hidden; the tabs and ours are not.
  const hiddenStrip = page.matches(rule('Gamestrip__StickyContainer'));
  assert.equal(hiddenStrip.length, 1);
  const hiddenContent = page.matches(rule('Gamestrip__ContentOffset'));
  assert.equal(hiddenContent.length, 2);
  assert.ok(hiddenContent.every((el) => el.tagName !== 'NAV' && !el.id.startsWith('nss-')));
  assert.ok(hiddenContent.some((el) => el.querySelector('.Boxscore')));
  const hiddenExtras = page.matches(rule(':has('));
  assert.ok(hiddenExtras.some((el) => el.classList.contains('NzyJW')));
  assert.ok(!hiddenExtras.some((el) => el.querySelector('.next-gen-gamecast')));

  // Our panel shows the synced box score; the tab title is ours.
  const root = doc.getElementById('nss-root');
  assert.ok(root.textContent.includes('Starters'));
  assert.ok(doc.getElementById('nss-strip').textContent.includes('synced to your stream'));
  assert.equal(doc.title, 'MEM @ ORL · Spoiler Sync');

  // ESPN re-rendering over the panel, or retitling the tab, gets undone.
  root.remove();
  doc.title = 'Grizzlies 101-99 Magic';
  await wait(10);
  assert.ok(doc.getElementById('nss-root')?.isConnected);
  assert.equal(doc.title, 'MEM @ ORL · Spoiler Sync');

  // In-page navigation: leaving the game removes our panel...
  page.window.history.pushState({}, '', '/nba/scoreboard');
  assert.ok(!page.attrs().includes('data-nss-here'));
  assert.equal(doc.getElementById('nss-root'), null);

  // ...and coming back to another tab of it shows that tab's synced view.
  page.window.history.pushState({}, '', '/nba/playbyplay/_/gameId/401810433');
  assert.ok(page.attrs().includes('data-nss-here'));
  assert.ok(doc.getElementById('nss-root').textContent.includes('4th Quarter'));
});

test('other games are left alone once the synced game is known', () => {
  const page = load(gamePage.replaceAll('401810433', '401810999'), 'https://www.espn.com/nba/boxscore/_/gameId/401810999');
  assert.equal(page.matches(rule('data-nss-gamepage')).length, 1);
  page.send({ type: 'config', game: GAME });
  assert.deepEqual(page.attrs(), ['data-nss-gamepage', 'data-nss-on', 'data-nss-ready']);
  assert.equal(page.matches(rule('data-nss-gamepage')).length, 0);
  assert.equal(page.matches(rule('Gamestrip__StickyContainer')).length, 0);
});

test('scoreboard: every card hidden until known, then only the synced game', () => {
  const html = `<!doctype html><html><head></head><body>
    <section class="Scoreboard" id="401810433"><div>LIVE 101-99</div></section>
    <section class="Scoreboard" id="401810434"><div>Other game</div></section>
  </body></html>`;
  const page = load(html, 'https://www.espn.com/nba/scoreboard');
  assert.equal(page.matches(rule('section.Scoreboard')).length, 2);
  page.send({ type: 'config', game: GAME });
  assert.equal(page.matches(rule('section.Scoreboard')).length, 0);
  const style = page.doc.getElementById('nss-dynamic').textContent;
  const cardRule = /([^{}]+> \*)\s*\{/.exec(style)[1].trim();
  const hidden = page.matches(cardRule);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].parentElement.id, '401810433');
});

test('unrecognized layout falls back to showing only our panel', async () => {
  const html = `<!doctype html><html><head><title>Recap</title></head><body><div id="espnfitt">LIVE recap</div></body></html>`;
  const page = load(html, 'https://www.espn.com/nba/recap/_/gameId/401810433');
  page.send({ type: 'config', game: GAME });
  page.send({ type: 'view', view: readyView });
  await wait(MOUNT_WAIT);
  assert.ok(page.attrs().includes('data-nss-fallback'));
  const hidden = page.matches(rule('data-nss-fallback'));
  assert.deepEqual(hidden.map((el) => el.id), ['espnfitt']);
  assert.match(page.doc.getElementById('nss-root').textContent, /hidden while Spoiler Sync is on/);
});
