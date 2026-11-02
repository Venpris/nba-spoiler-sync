import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSync, SyncError } from '../src/lib/sync.js';
import { trimPlays } from '../src/lib/espn.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/summary-401810433.json', import.meta.url), 'utf8'));
const plays = trimPlays(fixture);
const MARGIN_MS = 10_000;

test('on a real game, a sync never puts the user ahead of the play they are watching', () => {
  const STREAM_DELAY_MS = 95_000;
  let checked = 0;
  let maxAheadMs = -Infinity;
  for (const x of plays) {
    if (x.type === 'End Period' || x.type === 'End Game') continue;
    // The user taps as their stream shows X's clock. ESPN's feed at that moment has
    // everything logged up to now, i.e. 95s of plays past X.
    const tapServerMs = x.wallclockMs + STREAM_DELAY_MS;
    const feed = plays.filter((p) => p.wallclockMs <= tapServerMs);
    let result;
    try {
      result = computeSync(feed, { period: x.period, clockSec: x.clockSec }, tapServerMs);
    } catch (err) {
      if (err.code === 'too-early') continue; // the opening tip has nothing before it
      throw err;
    }
    checked++;
    maxAheadMs = Math.max(maxAheadMs, result.userServerMs - x.wallclockMs);
    // With the safety margin, the moment shown must still be before X was logged.
    const shownUpTo = tapServerMs - result.delayMs - MARGIN_MS;
    assert.ok(shownUpTo < x.wallclockMs, `play ${x.id} (${x.period}Q ${x.clock}) would be shown early`);
  }
  assert.ok(checked > 400, `checked ${checked} plays`);
  assert.ok(maxAheadMs <= 5_000, `estimate ran ${maxAheadMs}ms ahead`);
});

test('free throws: anchors on the last play logged at the nearest earlier clock', () => {
  const t = Date.parse('2026-01-15T20:00:00Z');
  const feed = [
    { period: 3, clockSec: 460, wallclockMs: t }, // shooting foul at 7:40, clock stops
    { period: 3, clockSec: 460, wallclockMs: t + 40_000 }, // FT 1 of 2
    { period: 3, clockSec: 460, wallclockMs: t + 60_000 }, // FT 2 of 2, clock restarts
    { period: 3, clockSec: 430, wallclockMs: t + 90_000 },
  ];
  const tap = t + 200_000;
  const { userServerMs, delayMs } = computeSync(feed, { period: 3, clockSec: 450 }, tap);
  assert.equal(userServerMs, t + 60_000 + 10_000);
  assert.equal(delayMs, tap - (t + 70_000));
});

test('plays at exactly the entered clock count as unseen', () => {
  const t = 1_000_000;
  const feed = [
    { period: 1, clockSec: 300, wallclockMs: t },
    // Logged at the entered clock, after a 30s stoppage. The user may not have seen it.
    { period: 1, clockSec: 290, wallclockMs: t + 40_000 },
  ];
  const { userServerMs } = computeSync(feed, { period: 1, clockSec: 290 }, t + 60_000);
  assert.equal(userServerMs, t + 10_000); // anchored on 5:00 plus 10s of running clock
});

test('start of a period anchors on the previous period without adding the break', () => {
  const t = 5_000_000;
  const feed = [
    { period: 2, clockSec: 3, wallclockMs: t - 20_000 },
    { period: 2, clockSec: 0, wallclockMs: t }, // end of 2nd quarter
  ];
  const { userServerMs } = computeSync(feed, { period: 3, clockSec: 700 }, t + 1_200_000);
  assert.equal(userServerMs, t);
});

test('rejects points ahead of the feed, before tip-off, and bad input', () => {
  const firstHalf = plays.filter((p) => p.period <= 2);
  const tap = Math.max(...firstHalf.map((p) => p.wallclockMs));
  assert.throws(() => computeSync(firstHalf, { period: 4, clockSec: 300 }, tap), (e) => e instanceof SyncError && e.code === 'ahead');
  assert.throws(() => computeSync(plays, { period: 1, clockSec: 720 }, tap), (e) => e.code === 'too-early');
  assert.throws(() => computeSync(plays, { period: 1, clockSec: 800 }, tap), (e) => e.code === 'bad-input');
  assert.throws(() => computeSync([], { period: 1, clockSec: 300 }, tap), (e) => e.code === 'no-plays');
});

test('a stream that is ahead of ESPN gets no delay rather than a negative one', () => {
  const t = 9_000_000;
  const feed = [{ period: 1, clockSec: 600, wallclockMs: t }];
  const { delayMs } = computeSync(feed, { period: 1, clockSec: 590 }, t + 5_000);
  assert.equal(delayMs, 0);
});
