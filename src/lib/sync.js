import { gameSeconds, periodLength } from './clock.js';

// A sync point this many game seconds past ESPN's newest play is almost always a typo
// (wrong quarter), and accepting it would show live data.
const MAX_AHEAD_SECONDS = 90;
const MAX_DELAY_MS = 12 * 60 * 60 * 1000;

export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Work out how far the user's stream is behind ESPN.
 *
 * plays: [{ period, clockSec, wallclockMs }] from ESPN's play-by-play.
 * point: { period, clockSec } the user read off their stream at tapServerMs (ESPN server time).
 *
 * The estimate errs early so stats lag the stream rather than lead it:
 * - plays logged at exactly the entered clock are treated as not yet seen;
 * - we anchor on the nearest earlier clock value, take the last play logged there
 *   (e.g. the second free throw, after which the clock restarted), and assume the clock
 *   ran without stopping from there to the entered value.
 * Across a full game of real data this was at most 4s ahead of the true moment, which
 * the safety margin applied later covers.
 */
export function computeSync(plays, point, tapServerMs) {
  if (!(point.period >= 1) || !(point.clockSec >= 0) || point.clockSec > periodLength(point.period)) {
    throw new SyncError('bad-input', 'Enter the clock as shown on your stream, like 7:42 or 45.2.');
  }
  const timed = plays.filter((p) => Number.isFinite(p.wallclockMs) && Number.isFinite(p.clockSec) && p.period >= 1);
  if (!timed.length) {
    throw new SyncError('no-plays', "ESPN hasn't posted any timestamped plays for this game yet.");
  }

  const target = gameSeconds(point.period, point.clockSec);
  const newest = Math.max(...timed.map((p) => gameSeconds(p.period, p.clockSec)));
  if (target - newest > MAX_AHEAD_SECONDS) {
    throw new SyncError('ahead', "That point is ahead of ESPN's live feed. Double-check the quarter and clock.");
  }

  const before = timed.filter((p) => gameSeconds(p.period, p.clockSec) < target);
  if (!before.length) {
    throw new SyncError('too-early', 'Sync once the game has tipped off and the first play is in.');
  }

  // Nearest earlier moment in game time, then the last play ESPN logged at that moment.
  const nearest = Math.max(...before.map((p) => gameSeconds(p.period, p.clockSec)));
  const atNearest = before.filter((p) => gameSeconds(p.period, p.clockSec) === nearest);
  const anchor = atNearest.reduce((a, b) => (b.wallclockMs > a.wallclockMs ? b : a));

  // Within the same period the clock can't run faster than real time, so adding the
  // clock difference gives the earliest moment the clock could have shown the entered value.
  // Across a period break the length of the break is unknown, so add nothing.
  const runSeconds = anchor.period === point.period ? anchor.clockSec - point.clockSec : 0;
  const userServerMs = anchor.wallclockMs + runSeconds * 1000;

  const delayMs = Math.max(0, tapServerMs - userServerMs);
  if (delayMs > MAX_DELAY_MS) {
    throw new SyncError('too-far', "That's more than 12 hours behind. Check that the right game is selected.");
  }
  return { delayMs, userServerMs, anchor };
}
