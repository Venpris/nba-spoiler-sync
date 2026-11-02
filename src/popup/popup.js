// The toolbar popup. It never receives game stats: only the game list (names and
// tip-off times) and the extension's own status.
import { formatDuration } from '../lib/clock.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let status = null;
let games = [];
let busy = false;

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

async function request(msg) {
  busy = true;
  try {
    const res = await send(msg);
    if (!res?.ok) {
      showError(res?.error || 'Something went wrong.');
      return null;
    }
    showError('');
    status = res;
    render();
    return res;
  } finally {
    busy = false;
  }
}

function tipOff(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderGames() {
  const select = $('game');
  const selectedId = status?.game?.id || '';
  const list = [...games];
  // Keep the synced game selectable even if it has dropped off today's slate.
  if (status?.game && !list.some((g) => g.id === status.game.id)) list.unshift(status.game);
  select.innerHTML = '';
  select.append(new Option(list.length ? 'Pick a game' : 'No games today', ''));
  for (const g of list) {
    const time = tipOff(g.date);
    select.append(new Option(`${g.shortName || g.name}${time ? ` · ${time}` : ''}`, g.id));
  }
  select.value = selectedId;
}

const STATUS_TEXT = {
  off: ['Off', "ESPN pages show ESPN's live data."],
  unsynced: ['Recording ESPN’s feed', 'Sync to your stream to start. ESPN game pages stay hidden until then.'],
  loading: ['Getting ready', ''],
  ready: ['Ready', 'ESPN tabs for this game are synced to your stream.'],
};

function render() {
  if (!status) return;
  const on = status.enabled;
  $('enabled').checked = on;
  $('enabled').disabled = !status.game;
  $('sync-section').hidden = !on;
  $('margin').value = String(status.marginMs);

  const kind = on ? status.status : 'off';
  let [title, detail] = STATUS_TEXT[kind] || STATUS_TEXT.off;
  if (kind === 'loading') {
    detail =
      status.readyInMs == null
        ? 'Starting the recording…'
        : `About ${formatDuration(status.readyInMs)} until the recording reaches your point in the game.`;
  }
  if (status.sync && (kind === 'loading' || kind === 'ready')) {
    detail += ` Your stream is about ${formatDuration(status.sync.delayMs)} behind ESPN.`;
  }
  if (on && status.error) detail = `${status.error} ${detail}`;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('dot').className = `dot${kind === 'ready' ? ' dot--ok' : kind === 'off' ? '' : ' dot--wait'}`;
}

async function doSync() {
  // Capture the moment first: this is when the stream showed the entered clock.
  const tapAt = Date.now();
  const clock = $('clock').value.trim();
  if (!clock) {
    showError('Enter the clock shown on your stream, like 7:42.');
    return;
  }
  $('sync').disabled = true;
  try {
    const res = await request({ type: 'sync', period: Number($('period').value), clock, tapAt });
    if (res) $('clock').value = '';
  } finally {
    $('sync').disabled = false;
  }
}

$('enabled').addEventListener('change', (e) => request({ type: 'setEnabled', enabled: e.target.checked }));

$('game').addEventListener('change', (e) => {
  const game = games.find((g) => g.id === e.target.value) || (status?.game?.id === e.target.value ? status.game : null);
  request({ type: 'setGame', game });
});

$('margin').addEventListener('change', (e) => request({ type: 'setMargin', marginMs: Number(e.target.value) }));

// pointerdown rather than click: click fires on release, a beat later.
$('sync').addEventListener('pointerdown', (e) => {
  if (e.button === 0) doSync();
});
$('sync').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    doSync();
  }
});
$('clock').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    doSync();
  }
});

async function init() {
  status = await send({ type: 'getStatus' });
  if (status?.sync?.period) $('period').value = String(status.sync.period);
  render();
  const res = await send({ type: 'listGames' });
  if (res?.ok) games = res.games;
  else showError(res?.error || "Couldn't load today's games from ESPN.");
  renderGames();
  // Keep the countdown and status current while the popup is open.
  setInterval(async () => {
    if (busy) return;
    const next = await send({ type: 'getStatus' });
    if (next?.ok) {
      status = next;
      render();
    }
  }, 500);
}

init();
