// Pure helpers for the recorded timeline: which moment the user's stream is at, and
// what ESPN looked like at that moment.

// The latest recorded time that is safe to show. Everything captured after it may
// contain plays the user hasn't seen yet.
export function cursorTime(nowMs, delayMs, marginMs) {
  return nowMs - delayMs - marginMs;
}

// Fold a fresh play list from ESPN into the stored set (a Map of id -> play), keeping
// when each play first appeared and when it disappeared (ESPN occasionally deletes or
// rewrites plays). Returns the plays that changed and need saving.
export function mergePlays(stored, fresh, seenAt) {
  const changed = [];
  const freshIds = new Set();
  for (const p of fresh) {
    freshIds.add(p.id);
    const prev = stored.get(p.id);
    const next = { ...p, firstSeen: prev ? prev.firstSeen : seenAt, removedAt: null };
    if (!prev || prev.removedAt != null || !sameContent(prev, p)) {
      stored.set(p.id, next);
      changed.push(next);
    }
  }
  // An empty list is more likely a glitch than ESPN wiping the game, so ignore it.
  if (fresh.length) {
    for (const prev of stored.values()) {
      if (prev.removedAt == null && !freshIds.has(prev.id)) {
        const next = { ...prev, removedAt: seenAt };
        stored.set(prev.id, next);
        changed.push(next);
      }
    }
  }
  return changed;
}

function sameContent(a, b) {
  for (const key of Object.keys(b)) {
    const x = a[key];
    const y = b[key];
    if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) return false;
  }
  return true;
}

// The plays ESPN had published when a snapshot was captured, in game order.
export function playsAt(plays, capturedAt) {
  return plays
    .filter((p) => p.firstSeen <= capturedAt && !(p.removedAt != null && p.removedAt <= capturedAt))
    .sort((a, b) => a.seq - b.seq);
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
