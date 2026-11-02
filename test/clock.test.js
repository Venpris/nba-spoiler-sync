import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClock, gameSeconds, periodLabel, formatDuration } from '../src/lib/clock.js';

test('parseClock reads ESPN and typed clock formats', () => {
  assert.equal(parseClock('7:42'), 462);
  assert.equal(parseClock('12:00'), 720);
  assert.equal(parseClock('0:05'), 5);
  assert.equal(parseClock('45.2'), 45.2);
  assert.equal(parseClock('45'), 45);
  assert.equal(parseClock(' 1:02 '), 62);
  assert.ok(Number.isNaN(parseClock('7:61')));
  assert.ok(Number.isNaN(parseClock('abc')));
  assert.ok(Number.isNaN(parseClock('')));
  assert.ok(Number.isNaN(parseClock(undefined)));
});

test('gameSeconds counts elapsed game time across quarters and overtime', () => {
  assert.equal(gameSeconds(1, 720), 0);
  assert.equal(gameSeconds(1, 0), 720);
  assert.equal(gameSeconds(3, 462), 720 * 2 + 258);
  assert.equal(gameSeconds(5, 300), 720 * 4);
  assert.equal(gameSeconds(6, 0), 720 * 4 + 600);
});

test('periodLabel and formatDuration', () => {
  assert.equal(periodLabel(3), '3rd');
  assert.equal(periodLabel(5), 'OT');
  assert.equal(periodLabel(6), '2OT');
  assert.equal(formatDuration(9_400), '9s');
  assert.equal(formatDuration(94_000), '1m 34s');
  assert.equal(formatDuration(2 * 3600_000 + 14 * 60_000), '2h 14m');
});
