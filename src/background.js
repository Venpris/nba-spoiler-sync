// Service worker: records ESPN's game state while the extension is on, works out the
// stream delay when the user syncs, and feeds ESPN tabs only what's safe to show.
import { fetchGames, fetchSummary, trimPlays, trimSnapshot, skewSample } from './lib/espn.js';
import { computeSync, SyncError } from './lib/sync.js';
import { parseClock } from './lib/clock.js';
import { cursorTime, mergePlays, playsAt, median } from './lib/timeline.js';
import * as store from './lib/store.js';

const POLL_MS = 5000;
const TICK_MS = 1000;
const KEEP_SNAPSHOTS_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MARGIN_MS = 10_000;
const ESPN_PAGES = '*://*.espn.com/*';
const SCRIPT_IDS = ['nss-nav-hook', 'nss-shield'];

// Runtime state lives in chrome.storage.session so it survives the worker being
// suspended. The browser clears it on exit, which also turns the extension off.
let state = { enabled: false, game: null, sync: null, recordingSince: null, skewMs: 0, lastError: null };
let marginMs = DEFAULT_MARGIN_MS;

const plays = new Map();
const skewSamples = [];
const ports = new Set();
let lastSnapshotJson = null;
let recording = false;
let pollTimer = null;
let tickTimer = null;
let lastPushedKey = null;
// Bumped whenever the recording is reset, so a poll that was in flight can't write
// the previous game's data into the new recording.
let generation = 0;

// Storage operations run one at a time, in order.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

const ready = init();

async function init() {
  const { state: saved } = await chrome.storage.session.get('state');
  if (saved) state = { ...state, ...saved };
  const { marginMs: savedMargin } = await chrome.storage.local.get('marginMs');
  if (Number.isFinite(savedMargin)) marginMs = savedMargin;

  if (state.enabled && state.game) {
    for (const p of await serial(() => store.loadPlays())) plays.set(p.id, p);
    startLoops();
  } else {
    await unregisterScripts();
  }
}

function saveState() {
  return chrome.storage.session.set({ state });
}

// ---- Recording -------------------------------------------------------------------

function startLoops() {
  if (!recording) {
    recording = true;
    poll();
  }
  if (!tickTimer) tickTimer = setInterval(tick, TICK_MS);
  chrome.alarms.create('nss-watchdog', { periodInMinutes: 0.5 });
}

function stopLoops() {
  recording = false;
  clearTimeout(pollTimer);
  pollTimer = null;
  clearInterval(tickTimer);
  tickTimer = null;
  chrome.alarms.clear('nss-watchdog');
}

async function poll() {
  pollTimer = null;
  const gen = generation;
  try {
    await recordOnce(gen);
    if (gen === generation) state.lastError = null;
  } catch (err) {
    if (gen === generation) state.lastError = `Can't reach ESPN right now (${err.message}). Retrying…`;
  }
  try {
    // Writing session storage is an extension API call, which also keeps the worker awake.
    await saveState();
  } catch {
    // Not worth stopping the recording over; the next poll saves again.
  }
  if (recording && gen === generation) pollTimer = setTimeout(poll, POLL_MS);
}

async function recordOnce(gen) {
  const gameId = state.game?.id;
  if (!gameId) return;
  const res = await fetchSummary(gameId);
  if (gen !== generation) return;

  const sample = skewSample(res);
  if (sample != null) {
    skewSamples.push(sample);
    if (skewSamples.length > 15) skewSamples.shift();
    state.skewMs = median(skewSamples);
  }

  const capturedAt = res.receivedAt;
  const fresh = trimPlays(res.json);
  const changedPlays = mergePlays(plays, fresh, capturedAt);
  const snapshot = trimSnapshot(res.json, fresh);
  const json = JSON.stringify(snapshot);
  const isNewState = json !== lastSnapshotJson;
  lastSnapshotJson = json;
  if (!state.recordingSince) state.recordingSince = capturedAt;

  await serial(async () => {
    if (gen !== generation) return;
    if (changedPlays.length) await store.putPlays(changedPlays);
    // Unchanged states aren't stored again: the previous snapshot already covers them.
    if (isNewState) await store.putSnapshot({ capturedAt, ...snapshot });
    await store.pruneSnapshots(capturedAt - KEEP_SNAPSHOTS_MS);
  });
}

async function resetRecording() {
  generation++;
  stopLoops();
  plays.clear();
  skewSamples.length = 0;
  lastSnapshotJson = null;
  lastPushedKey = null;
  state.sync = null;
  state.recordingSince = null;
  state.lastError = null;
  await serial(() => store.clearAll());
}

// ---- What ESPN tabs may show -------------------------------------------------------

async function currentView() {
  if (!state.enabled || !state.game) return { status: 'off' };
  if (!state.sync) return { status: 'unsynced', error: state.lastError };
  const cursor = cursorTime(Date.now(), state.sync.delayMs, marginMs);
  const snapshot = await serial(() => store.snapshotAtOrBefore(cursor));
  if (snapshot) return { status: 'ready', snapshot, error: state.lastError };
  const first = await serial(() => store.firstSnapshotTime());
  return { status: 'loading', readyInMs: first == null ? null : first - cursor, error: state.lastError };
}

function viewKey(view) {
  if (view.status === 'ready') return `ready:${view.snapshot.capturedAt}`;
  const seconds = view.readyInMs == null ? '' : Math.ceil(view.readyInMs / 1000);
  return `${view.status}:${seconds}:${view.error || ''}`;
}

// Plays go out only alongside the snapshot they belong to, never ahead of it.
function withPlays(view) {
  if (view.status !== 'ready') return view;
  const list = playsAt([...plays.values()], view.snapshot.capturedAt).map((p) => ({
    id: p.id,
    seq: p.seq,
    period: p.period,
    clock: p.clock,
    text: p.text,
    teamId: p.teamId,
    scoring: p.scoring,
    away: p.away,
    home: p.home,
  }));
  return { ...view, plays: list };
}

let ticking = false;
async function tick() {
  if (!ports.size || ticking) return;
  ticking = true;
  try {
    const view = await currentView();
    const key = viewKey(view);
    if (key === lastPushedKey) return;
    lastPushedKey = key;
    const message = { type: 'view', view: withPlays(view) };
    for (const port of ports) port.postMessage(message);
  } finally {
    ticking = false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'espn-tab') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  ready.then(async () => {
    port.postMessage({ type: 'config', game: state.enabled ? state.game : null });
    port.postMessage({ type: 'view', view: withPlays(await currentView()) });
  });
});

// ---- ESPN tabs ---------------------------------------------------------------------

async function registerScripts() {
  await unregisterScripts();
  await chrome.scripting.registerContentScripts([
    {
      id: 'nss-nav-hook',
      matches: [ESPN_PAGES],
      js: ['src/content/nav-hook.js'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false,
    },
    {
      id: 'nss-shield',
      matches: [ESPN_PAGES],
      js: ['src/content/view.js', 'src/content/shield.js'],
      css: ['src/content/shield.css'],
      runAt: 'document_start',
      persistAcrossSessions: false,
    },
  ]);
}

async function unregisterScripts() {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered.map((s) => s.id).filter((id) => SCRIPT_IDS.includes(id));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}

// Reloading lets the shield load before anything renders, including in tabs that
// were already open.
async function reloadEspnTabs() {
  const tabs = await chrome.tabs.query({ url: ESPN_PAGES });
  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => {})));
}

// ---- Popup requests ----------------------------------------------------------------

async function popupStatus() {
  const view = await currentView();
  return {
    ok: true,
    enabled: state.enabled,
    game: state.game,
    sync: state.sync,
    marginMs,
    status: view.status,
    readyInMs: view.readyInMs ?? null,
    error: state.lastError,
  };
}

async function setEnabled(on) {
  if (on && !state.game) throw new Error('Pick a game first.');
  await resetRecording();
  state.enabled = Boolean(on);
  await saveState();
  if (state.enabled) {
    await registerScripts();
    startLoops();
  } else {
    await unregisterScripts();
  }
  await reloadEspnTabs();
}

async function selectGame(game) {
  const next = game
    ? { id: String(game.id), name: game.name, shortName: game.shortName, date: game.date, away: game.away, home: game.home }
    : null;
  if (next?.id === state.game?.id) return;
  state.game = next;
  if (state.enabled) {
    if (next) await setEnabled(true);
    else await setEnabled(false);
  } else {
    await saveState();
  }
}

async function syncNow({ period, clock, tapAt }) {
  if (!state.enabled || !state.game) throw new Error('Turn Spoiler Sync on first.');
  const clockSec = parseClock(String(clock ?? ''));
  if (!Number.isFinite(clockSec)) {
    throw new SyncError('bad-input', 'Enter the clock as shown on your stream, like 7:42 or 45.2.');
  }
  // Right after turning on, the first recording may still be in flight.
  if (!plays.size) await recordOnce(generation);
  const current = [...plays.values()].filter((p) => p.removedAt == null);
  const result = computeSync(current, { period: Number(period), clockSec }, Number(tapAt) + state.skewMs);
  state.sync = { delayMs: result.delayMs, period: Number(period), clock: String(clock).trim(), syncedAt: Number(tapAt) };
  lastPushedKey = null;
  await saveState();
  tick();
}

async function handle(msg) {
  switch (msg?.type) {
    case 'getStatus':
      return popupStatus();
    case 'listGames':
      return { ok: true, games: await fetchGames() };
    case 'setGame':
      await selectGame(msg.game);
      return popupStatus();
    case 'setEnabled':
      await setEnabled(msg.enabled);
      return popupStatus();
    case 'sync':
      await syncNow(msg);
      return popupStatus();
    case 'setMargin': {
      const value = Number(msg.marginMs);
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid safety margin.');
      marginMs = value;
      await chrome.storage.local.set({ marginMs });
      lastPushedKey = null;
      tick();
      return popupStatus();
    }
    default:
      throw new Error(`Unknown request: ${msg?.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab) return false; // only the popup talks to us this way
  ready
    .then(() => handle(msg))
    .then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'nss-watchdog') return;
  ready.then(() => {
    if (state.enabled && state.game) startLoops();
  });
});
