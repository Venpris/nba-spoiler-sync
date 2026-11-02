import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/lib/store.js';

test('snapshots are looked up by capture time', async () => {
  await store.clearAll();
  assert.equal(await store.snapshotAtOrBefore(5000), null);
  assert.equal(await store.firstSnapshotTime(), null);
  for (const t of [1000, 2000, 3000]) await store.putSnapshot({ capturedAt: t, label: `s${t}` });

  assert.equal((await store.snapshotAtOrBefore(2500)).label, 's2000');
  assert.equal((await store.snapshotAtOrBefore(2000)).label, 's2000');
  assert.equal(await store.snapshotAtOrBefore(999), null);
  assert.equal(await store.firstSnapshotTime(), 1000);

  await store.pruneSnapshots(2000);
  assert.equal(await store.firstSnapshotTime(), 2000);
});

test('plays persist and clearAll empties everything', async () => {
  await store.putPlays([{ id: 'a', seq: 1 }, { id: 'b', seq: 2 }]);
  await store.putPlays([{ id: 'a', seq: 1, text: 'edited' }]);
  const plays = await store.loadPlays();
  assert.equal(plays.length, 2);
  assert.equal(plays.find((p) => p.id === 'a').text, 'edited');

  await store.clearAll();
  assert.deepEqual(await store.loadPlays(), []);
  assert.equal(await store.firstSnapshotTime(), null);
});
