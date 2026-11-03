import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorTime, mergePlays, playsAt, median } from '../src/lib/timeline.js';

const play = (id, seq, text = `play ${id}`) => ({ id, seq, text, clockSec: NaN });

test('mergePlays records when plays appear, change and disappear', () => {
  const stored = new Map();
  let changed = mergePlays(stored, [play('a', 1), play('b', 2)], 100);
  assert.equal(changed.length, 2);
  assert.equal(stored.get('a').firstSeen, 100);

  // unchanged plays aren't rewritten (NaN fields compare equal)
  changed = mergePlays(stored, [play('a', 1), play('b', 2)], 200);
  assert.equal(changed.length, 0);

  // edited text keeps the original firstSeen, a new play gets the new time
  changed = mergePlays(stored, [play('a', 1, 'edited'), play('b', 2), play('c', 3)], 300);
  assert.deepEqual(changed.map((p) => p.id).sort(), ['a', 'c']);
  assert.equal(stored.get('a').firstSeen, 100);
  assert.equal(stored.get('c').firstSeen, 300);

  // a play ESPN deletes is marked, not forgotten
  mergePlays(stored, [play('a', 1, 'edited'), play('c', 3)], 400);
  assert.equal(stored.get('b').removedAt, 400);

  // an empty response is treated as a glitch
  assert.equal(mergePlays(stored, [], 500).length, 0);
  assert.equal(stored.get('a').removedAt, null);
});

test('playsAt shows exactly the plays published at capture time', () => {
  const stored = new Map();
  mergePlays(stored, [play('a', 1), play('b', 2)], 100);
  mergePlays(stored, [play('a', 1), play('b', 2), play('c', 3)], 200);
  mergePlays(stored, [play('a', 1), play('c', 3)], 300);
  const all = [...stored.values()];
  assert.deepEqual(playsAt(all, 150).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(playsAt(all, 250).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(playsAt(all, 300).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(playsAt(all, 99), []);
});

test('cursorTime and median', () => {
  assert.equal(cursorTime(1_000_000, 90_000, 10_000), 900_000);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
});
