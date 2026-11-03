// pure helpers for finding the moment the user's stream is at and what ESPN showed then

// latest recorded time that's safe to show
// anything captured after it may include plays the user hasn't seen yet
export function cursorTime(nowMs, delayMs, marginMs) {
  return nowMs - delayMs - marginMs;
}

// fold a fresh ESPN play list into the stored Map (id -> play), tracking when each play
// first appeared and when it disappeared (ESPN sometimes deletes or rewrites plays)
// returns the plays that changed and need saving
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
  // an empty list is more likely a glitch than ESPN wiping the game, so ignore it
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

// plays ESPN had published when a snapshot was captured, in game order
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
