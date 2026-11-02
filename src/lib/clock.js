// Game-clock helpers. ESPN clocks look like "7:42", "45.2" or "0.0".

export function parseClock(text) {
  if (typeof text !== 'string') return NaN;
  const s = text.trim();
  const mmss = /^(\d{1,2}):(\d{2})(?:\.(\d+))?$/.exec(s);
  if (mmss) {
    const [, min, sec, frac] = mmss;
    if (Number(sec) >= 60) return NaN;
    return Number(min) * 60 + Number(sec) + (frac ? Number('0.' + frac) : 0);
  }
  if (/^\d{1,2}(?:\.\d+)?$/.test(s)) return Number(s);
  return NaN;
}

export function periodLength(period) {
  return period <= 4 ? 12 * 60 : 5 * 60;
}

// Seconds of game time played up to this point (the clock counts down within a period).
export function gameSeconds(period, clockSec) {
  let total = 0;
  for (let p = 1; p < period; p++) total += periodLength(p);
  return total + periodLength(period) - clockSec;
}

export function periodLabel(period) {
  if (period <= 4) return ['1st', '2nd', '3rd', '4th'][period - 1];
  return period === 5 ? 'OT' : `${period - 4}OT`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
