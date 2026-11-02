// Runs the real service worker against a simulated live game: ESPN's feed is replayed
// from a finished game's play log by timestamp, on a mocked clock, while a viewer
// watches 75 seconds behind. Checks what ESPN tabs receive never runs ahead of them.
import 'fake-indexeddb/auto';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/summary-401810433.json', import.meta.url), 'utf8'));
const wallclock = new Map(fixture.plays.map((p) => [String(p.id), Date.parse(p.wallclock)]));
const firstPlay = Math.min(...wallclock.values());

const STREAM_DELAY_MS = 75_000;
const START = firstPlay + 20 * 60_000; // ESPN is live in the 2nd quarter

// ESPN's feed at time t: plays logged so far. The box score can't be replayed, so the
// away "score" carries how many plays the feed had, which lets the test check that a
// snapshot never contains more than the viewer has seen.
function feedAt(t) {
  const plays = fixture.plays.filter((p) => Date.parse(p.wallclock) <= t);
  const header = structuredClone(fixture.header);
  header.competitions[0].competitors.find((c) => c.homeAway === 'away').score = String(plays.length);
  return { header, boxscore: fixture.boxscore, plays };
}

function fakeChrome() {
  const on = { message: [], connect: [], alarm: [] };
  const area = (data) => ({
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (obj) => Object.assign(data, structuredClone(obj)),
  });
  let registered = [];
  return {
    on,
    reloads: 0,
    get registered() {
      return registered;
    },
    storage: { session: area({}), local: area({}) },
    alarms: { create() {}, clear: async () => true, onAlarm: { addListener: (fn) => on.alarm.push(fn) } },
    runtime: {
      onMessage: { addListener: (fn) => on.message.push(fn) },
      onConnect: { addListener: (fn) => on.connect.push(fn) },
    },
    scripting: {
      getRegisteredContentScripts: async () => registered,
      registerContentScripts: async (scripts) => (registered = [...registered, ...scripts]),
      unregisterContentScripts: async ({ ids }) => (registered = registered.filter((s) => !ids.includes(s.id))),
    },
    tabs: {
      query: async () => [{ id: 1 }],
      reload: async () => {
        globalThis.chrome.reloads++;
      },
    },
  };
}

// Let promise chains, fake IndexedDB (setImmediate-based) and fetch callbacks run.
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
}

async function advance(ms, step = 1000) {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(step);
    await settle();
  }
}

test('recording, syncing and what ESPN tabs receive', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });
  globalThis.chrome = fakeChrome();
  globalThis.fetch = async (url) => {
    assert.match(url, /summary\?event=401810433$/);
    const now = Date.now();
    return {
      ok: true,
      status: 200,
      headers: new Headers({ date: new Date(now).toUTCString() }),
      json: async () => feedAt(now),
    };
  };
  await import('../src/background.js');
  await settle();

  const ask = (msg) => new Promise((resolve) => chrome.on.message[0](msg, {}, resolve));
  const game = { id: '401810433', name: 'Memphis Grizzlies at Orlando Magic', shortName: 'MEM VS ORL', date: '2026-01-15T19:00Z', away: 'MEM', home: 'ORL' };

  let status = await ask({ type: 'getStatus' });
  assert.equal(status.status, 'off');

  status = await ask({ type: 'setGame', game });
  assert.equal(status.enabled, false);
  status = await ask({ type: 'setEnabled', enabled: true });
  assert.equal(status.enabled, true);
  assert.deepEqual(chrome.registered.map((s) => s.id).sort(), ['nss-nav-hook', 'nss-shield']);
  assert.equal(chrome.reloads, 1);

  // An ESPN tab connects and records everything it is sent.
  const received = [];
  const port = {
    name: 'espn-tab',
    postMessage: (msg) => received.push({ at: Date.now(), msg: structuredClone(msg) }),
    onDisconnect: { addListener() {} },
  };
  chrome.on.connect[0](port);
  await settle();
  assert.deepEqual(received[0].msg, { type: 'config', game });
  assert.equal(received[1].msg.view.status, 'unsynced');

  // Record for a bit, then sync the moment the stream reaches a play's clock.
  await advance(20_000);
  const streamAt = () => Date.now() - STREAM_DELAY_MS;
  const target = fixture.plays.find((p) => Date.parse(p.wallclock) > streamAt() + 5_000 && p.type.text !== 'Substitution');
  await advance(Date.parse(target.wallclock) - streamAt(), 1);
  assert.equal(streamAt(), Date.parse(target.wallclock));

  status = await ask({ type: 'sync', period: target.period.number, clock: target.clock.displayValue, tapAt: Date.now() });
  assert.ok(status.ok, status.error);
  // The estimate may run long (a stoppage before the synced moment), never meaningfully short.
  assert.ok(status.sync.delayMs >= STREAM_DELAY_MS - 5_000, `delay ${status.sync.delayMs}`);
  assert.ok(status.sync.delayMs <= STREAM_DELAY_MS + 60_000, `delay ${status.sync.delayMs}`);
  assert.equal(status.status, 'loading'); // the recording hasn't reached the stream yet

  // Watch for 10 minutes of game.
  await advance(10 * 60_000);
  const views = received.filter((r) => r.msg.type === 'view').map((r) => ({ at: r.at, view: r.msg.view }));
  const ready = views.filter((v) => v.view.status === 'ready');
  assert.ok(ready.length > 20, `${ready.length} ready views`);
  // Recording started at START; it's ready once it has covered the delay plus the 10s margin
  // (give or take a poll and a tick).
  const firstReady = ready[0].at;
  assert.ok(firstReady - START <= status.sync.delayMs + 10_000 + 6_000, `ready after ${firstReady - START}ms`);

  for (const { at, view } of ready) {
    const seenUpTo = at - STREAM_DELAY_MS; // where the viewer's stream is
    const seenCount = fixture.plays.filter((p) => Date.parse(p.wallclock) <= seenUpTo).length;
    const away = view.snapshot.teams.find((t) => t.homeAway === 'away');
    assert.ok(Number(away.score) <= seenCount, `snapshot had ${away.score} plays, viewer has seen ${seenCount}`);
    for (const p of view.plays) assert.ok(wallclock.get(p.id) <= seenUpTo, `play ${p.id} sent before the viewer saw it`);
    assert.ok(!('wallclockMs' in view.plays[0]));
  }

  // It also keeps up: the newest view lags the viewer by roughly the safety margin, not more.
  const last = ready.at(-1);
  const lastSeen = fixture.plays.filter((p) => Date.parse(p.wallclock) <= last.at - STREAM_DELAY_MS).length;
  const lagPlays = lastSeen - Number(last.view.snapshot.teams.find((t) => t.homeAway === 'away').score);
  assert.ok(lagPlays <= 8, `${lagPlays} plays behind`);

  // The popup never gets game data.
  status = await ask({ type: 'getStatus' });
  assert.equal(status.status, 'ready');
  assert.ok(!JSON.stringify(status).includes('"teams"'));

  // Turning off unregisters the shield and reloads ESPN tabs.
  status = await ask({ type: 'setEnabled', enabled: false });
  assert.equal(status.status, 'off');
  assert.equal(chrome.registered.length, 0);
  assert.equal(chrome.reloads, 2);

  mock.timers.reset();
});
