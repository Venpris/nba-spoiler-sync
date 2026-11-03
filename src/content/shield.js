// runs on every ESPN page while Spoiler Sync is on
// anything that could show the synced game's live score starts hidden (see shield.css)
// until we know which game is being watched
// on that game's pages ESPN's content is hidden and its own elements (score strip, box
// score, Gamecast, Play-by-Play and Team Stats widgets) are shown as synced copies
// anything we can't match falls back to our own strip and panel, with stats that match
// the stream
(() => {
  const View = globalThis.NSSView;
  // synced copies of ESPN's own elements, the pages they show on, and whether they
  // replace our panel there
  const Gamecast = globalThis.NSSEspnGamecast;
  const on = (...kinds) => (kind) => kinds.includes(kind);
  const COPIES = {
    strip: { lib: globalThis.NSSEspnStrip, onPage: () => true },
    box: { lib: globalThis.NSSEspnBox, onPage: on('boxscore'), body: true },
    lastPlays: { lib: Gamecast.lastPlays, onPage: on('gamecast'), body: true },
    playByPlay: { lib: Gamecast.playByPlay, onPage: on('playbyplay'), body: true },
    matchupTable: { lib: Gamecast.matchupTable, onPage: on('matchup'), body: true },
    leaders: { lib: Gamecast.leaders, onPage: on('gamecast', 'matchup'), body: true },
    teamStats: { lib: Gamecast.teamStats, onPage: on('gamecast', 'matchup'), body: true },
    gameInfo: { lib: Gamecast.gameInfo, onPage: on('gamecast', 'playbyplay', 'matchup') },
  };
  const EspnCard = globalThis.NSSEspnCard;
  const html = document.documentElement;
  // wait after parsing before adding our panel, so it doesn't collide with ESPN's React
  // app taking over the server-rendered page
  const MOUNT_DELAY_MS = 1000;

  let game = null;
  let configured = false;
  let view = null;
  let lastHref = location.href;
  let canMount = false;
  let rendered = { strip: null, body: null };
  let renderedCard = null;
  // synced copy of ESPN's scoreboard card, and the last card that couldn't be matched
  let cardCopy = null;
  let cardFailed = null;
  // set when our chosen spot in ESPN's layout turns out hidden, cleared on navigation
  let forceFallback = false;
  // copies currently shown, { copy, original, capturedAt } per name
  // last attempt that couldn't be matched, so it isn't retried on every page update
  const shown = {};
  const failed = {};

  // mark the shield on and flag game pages synchronously, before anything renders
  html.setAttribute('data-nss-on', '');
  html.toggleAttribute('data-nss-gamepage', Boolean(View.nbaGameIdFromUrl(location.href)));

  const isHere = () => Boolean(configured && game && View.nbaGameIdFromUrl(location.href) === game.id);

  function applyLocation() {
    lastHref = location.href;
    forceFallback = false;
    html.toggleAttribute('data-nss-gamepage', Boolean(View.nbaGameIdFromUrl(location.href)));
    if (!configured) return;
    html.setAttribute('data-nss-ready', '');
    const here = isHere();
    html.toggleAttribute('data-nss-here', here);
    if (here) {
      mount();
      applyTitle();
    } else {
      unmount();
    }
  }

  function element(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
    }
    return el;
  }

  // where the panel goes, below ESPN's game tabs inside the main content area
  // null means show it on its own (unrecognized layout, or a page like the recap)
  function inPageSpot() {
    if (forceFallback) return null;
    const offset = document.querySelector('.Gamestrip__ContentOffset');
    const top = offset?.closest('#fittPageContainer, main');
    return offset && top ? { parent: offset, top, nav: offset.querySelector(':scope > .NavSecondary--GamePackage') } : null;
  }

  // mark every element from the panel up to the main content area, where shield.css
  // hides everything else so whatever ESPN adds or renames stays hidden
  function clearKeep() {
    for (const el of document.querySelectorAll('[data-nss-keep]')) el.removeAttribute('data-nss-keep');
  }

  function markKeep(elements, top) {
    clearKeep();
    for (const from of elements) {
      for (let el = from?.parentElement; el; el = el.parentElement) {
        el.setAttribute('data-nss-keep', '');
        if (el === top) break;
      }
    }
  }

  // put the strip and panel in place (again, if ESPN re-rendered over them)
  function mount() {
    if (!isHere() || !canMount || !document.body) return;
    const strip = element('nss-strip');
    const root = element('nss-root');
    const spot = inPageSpot();
    let moved = false;
    if (spot) {
      html.removeAttribute('data-nss-fallback');
      if (strip.parentElement !== spot.parent) {
        spot.parent.prepend(strip);
        moved = true;
      }
      const after = spot.nav || strip;
      if (root.parentElement !== spot.parent || root.previousElementSibling !== after) {
        after.after(root);
        moved = true;
      }
      markKeep([root], spot.top);
    } else {
      html.setAttribute('data-nss-fallback', '');
      clearKeep();
      if (strip.parentElement !== document.body) {
        document.body.prepend(strip);
        moved = true;
      }
      if (root.parentElement !== document.body || root.previousElementSibling !== strip) {
        strip.after(root);
        moved = true;
      }
    }
    html.setAttribute('data-nss-mounted', '');
    if (moved) rendered = { strip: null, body: null };
    render();

    // if ESPN's page still hides the spot we picked, our strip and panel would vanish
    // with it, so show them on their own instead
    if (spot && typeof spot.parent.checkVisibility === 'function' && !spot.parent.checkVisibility()) {
      forceFallback = true;
      mount();
    }
  }

  function unmount() {
    document.getElementById('nss-strip')?.remove();
    document.getElementById('nss-root')?.remove();
    for (const name of Object.keys(COPIES)) removeCopy(name);
    clearKeep();
    html.removeAttribute('data-nss-mounted');
    html.removeAttribute('data-nss-fallback');
    rendered = { strip: null, body: null };
  }

  function isMounted() {
    const strip = document.getElementById('nss-strip');
    const root = document.getElementById('nss-root');
    if (!strip || !root) return false;
    const parent = inPageSpot()?.parent || document.body;
    return strip.parentElement === parent && root.parentElement === parent;
  }

  function render() {
    const strip = document.getElementById('nss-strip');
    const root = document.getElementById('nss-root');
    if (!strip || !root) return;
    const kind = View.pageKind(location.href);
    const spot = inPageSpot();
    const ready = Boolean(spot && view?.status === 'ready');
    const active = {};
    for (const [name, { onPage }] of Object.entries(COPIES)) {
      active[name] = ready && onPage(kind) && placeCopy(name, spot);
      if (!active[name]) removeCopy(name);
    }
    if (spot) markKeep([root, ...Object.values(shown).map((s) => s.copy)], spot.top);
    // if ESPN's page still hides a copy after marking, fall back to ours
    for (const name of Object.keys(COPIES)) {
      const copy = shown[name]?.copy;
      if (copy && typeof copy.checkVisibility === 'function' && !copy.checkVisibility()) {
        removeCopy(name);
        active[name] = false;
      }
    }
    const stripHtml = active.strip ? '' : View.renderStrip(view, game);
    const espnBody = Object.entries(COPIES).some(([name, { body }]) => body && active[name]);
    const bodyHtml = espnBody ? '' : View.renderBody(kind, view);
    if (stripHtml !== rendered.strip) strip.innerHTML = stripHtml;
    if (bodyHtml !== rendered.body) root.innerHTML = bodyHtml;
    rendered = { strip: stripHtml, body: bodyHtml };
  }

  // put a synced copy of an ESPN element right after the (hidden) original
  // rebuilt whenever the synced snapshot changes or ESPN re-renders the original
  // returns false if ESPN's element is missing or can't be matched
  function placeCopy(name, spot) {
    const { lib } = COPIES[name];
    const original = lib.findOriginal(document, game);
    if (!original || !spot.top.contains(original)) return false;
    const snapshot = view.snapshot;
    const current = shown[name];
    const inPlace = current?.copy.isConnected && current.original === original && original.nextElementSibling === current.copy;
    if (inPlace && current.capturedAt === snapshot.capturedAt) return true;
    if (failed[name]?.original === original && failed[name].capturedAt === snapshot.capturedAt) return false;
    const built = lib.buildCopy(original, snapshot, view.plays);
    if (!built) {
      failed[name] = { original, capturedAt: snapshot.capturedAt };
      return false;
    }
    delete failed[name];
    removeCopy(name);
    built.copy.setAttribute('data-nss-copy', name);
    original.after(built.copy);
    shown[name] = { copy: built.copy, original, capturedAt: snapshot.capturedAt };
    return true;
  }

  function removeCopy(name) {
    for (const el of document.querySelectorAll(`[data-nss-copy="${name}"]`)) el.remove();
    shown[name]?.copy.remove();
    delete shown[name];
  }

  // a copy needs (re)building if ESPN replaced or moved its original, or the original
  // only just appeared
  function copiesNeedRender() {
    if (view?.status !== 'ready') return false;
    const kind = View.pageKind(location.href);
    return Object.entries(COPIES).some(([name, { lib, onPage }]) => {
      if (!onPage(kind)) return false;
      const current = shown[name];
      if (!current) {
        const original = lib.findOriginal(document, game);
        return Boolean(original) && !(failed[name]?.original === original && failed[name].capturedAt === view.snapshot.capturedAt);
      }
      return !(current.copy.isConnected && current.original.isConnected && current.original.nextElementSibling === current.copy);
    });
  }

  function applyTitle() {
    if (!isHere()) return;
    const title = `${game.shortName || `${game.away} @ ${game.home}`} · Spoiler Sync`;
    if (document.title !== title) document.title = title;
  }

  // the synced game's card on scoreboard pages
  // once synced, ESPN's card is hidden and a synced copy sits next to it
  // before that (or if ESPN's card can't be matched) its content is hidden under our own
  // card, and until ours is in place the card just says it's hidden
  function hideScoreboardCard() {
    if (!game || document.getElementById('nss-dynamic')) return;
    const card = `section.Scoreboard[id="${game.id}"]`;
    const style = document.createElement('style');
    style.id = 'nss-dynamic';
    style.textContent = `
      ${card} { position: relative !important; }
      ${card} > :not(#nss-scorecard) { visibility: hidden !important; }
      ${card}:not(:has(> #nss-scorecard))::after {
        content: "Hidden by Spoiler Sync"; position: absolute; inset: 0; display: flex;
        align-items: center; justify-content: center; font-weight: 600; color: #6c6d6f;
      }
      html[data-nss-card-copy] ${card} { display: none !important; }`;
    (document.head || html).appendChild(style);
  }

  function scoreboardCard() {
    return EspnCard.findOriginal(document, game);
  }

  // show the synced copy of ESPN's card if we can, otherwise our own card
  function updateScoreboardCard() {
    const card = canMount && scoreboardCard();
    if (card && view?.status === 'ready' && placeCardCopy(card)) {
      document.getElementById('nss-scorecard')?.remove();
      return;
    }
    removeCardCopy();
    if (card) mountScoreCard(card);
  }

  function placeCardCopy(card) {
    const capturedAt = view.snapshot.capturedAt;
    if (cardCopy && cardCopy.original === card && card.nextElementSibling === cardCopy.copy && cardCopy.capturedAt === capturedAt) return true;
    if (cardFailed?.original === card && cardFailed.capturedAt === capturedAt) return false;
    const built = EspnCard.buildCopy(card, view.snapshot, view.plays);
    if (!built) {
      cardFailed = { original: card, capturedAt };
      return false;
    }
    removeCardCopy();
    built.copy.setAttribute('data-nss-copy', 'card');
    card.after(built.copy);
    cardCopy = { copy: built.copy, original: card, capturedAt };
    html.setAttribute('data-nss-card-copy', '');
    return true;
  }

  function removeCardCopy() {
    cardCopy?.copy.remove();
    for (const el of document.querySelectorAll('[data-nss-copy="card"]')) el.remove();
    cardCopy = null;
    html.removeAttribute('data-nss-card-copy');
  }

  // whether the card needs updating after ESPN changed the page
  function cardOutOfPlace() {
    const card = scoreboardCard();
    if (!card) return Boolean(cardCopy);
    if (cardCopy) return !(cardCopy.copy.isConnected && cardCopy.original === card && card.nextElementSibling === cardCopy.copy);
    if (view?.status === 'ready' && !(cardFailed?.original === card && cardFailed.capturedAt === view.snapshot.capturedAt)) return true;
    return document.getElementById('nss-scorecard')?.parentElement !== card;
  }

  function mountScoreCard(card) {
    let el = document.getElementById('nss-scorecard');
    if (el?.parentElement !== card) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'nss-scorecard';
      }
      card.append(el);
      renderedCard = null;
    }
    renderScoreCard();
  }

  function renderScoreCard() {
    const el = document.getElementById('nss-scorecard');
    if (!el || !game) return;
    const cardHtml = View.renderScoreCard(view, game);
    if (cardHtml !== renderedCard) el.innerHTML = cardHtml;
    renderedCard = cardHtml;
  }

  function onMessage(msg) {
    if (msg?.type === 'config') {
      game = msg.game && /^\d+$/.test(String(msg.game.id)) ? { ...msg.game, id: String(msg.game.id) } : null;
      configured = true;
      if (!game) html.removeAttribute('data-nss-on');
      hideScoreboardCard();
      updateScoreboardCard();
      applyLocation();
    } else if (msg?.type === 'view') {
      view = msg.view;
      render();
      updateScoreboardCard();
    }
  }

  function connect() {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'espn-tab' });
    } catch {
      return; // extension reloaded or removed, so the page keeps whatever it showed
    }
    port.onMessage.addListener(onMessage);
    // the background worker can be suspended, which closes the port, so reconnect and
    // keep showing the last safe view meanwhile
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  }

  // ESPN navigates without reloading, so our MAIN-world hook reports pushState/replaceState
  // synchronously to hide the right parts before the new page paints
  // the observer also catches ESPN re-rendering over our panel
  const onNavigate = () => {
    if (location.href !== lastHref) applyLocation();
  };
  document.addEventListener('nss:navigated', onNavigate);
  window.addEventListener('popstate', onNavigate);
  new MutationObserver(() => {
    if (location.href !== lastHref) applyLocation();
    else if (isHere()) {
      if (canMount && !isMounted()) mount();
      // ESPN re-rendered its strip or box score (or it only just appeared), so rebuild
      else if (copiesNeedRender()) render();
      applyTitle();
    }
    if (canMount && game && cardOutOfPlace()) updateScoreboardCard();
  }).observe(html, { childList: true, subtree: true });

  function allowMount() {
    setTimeout(() => {
      canMount = true;
      if (isHere()) mount();
      updateScoreboardCard();
    }, MOUNT_DELAY_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', allowMount, { once: true });
  else allowMount();

  connect();
})();
