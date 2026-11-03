// Runs on every ESPN page while Spoiler Sync is on. Everything that could show the
// synced game's live score starts hidden (see shield.css) and only comes back once we
// know which game is being watched; on that game's own pages ESPN's score strip and
// content are replaced by our panel, filled with stats that match the stream.
(() => {
  const View = globalThis.NSSView;
  const html = document.documentElement;
  // Wait this long after the page has parsed before adding our panel, so it doesn't
  // collide with ESPN's React app taking over the server-rendered page.
  const MOUNT_DELAY_MS = 1000;

  let game = null;
  let configured = false;
  let view = null;
  let lastHref = location.href;
  let canMount = false;
  let rendered = { strip: null, body: null };
  let renderedCard = null;
  // Set when the spot we picked inside ESPN's layout turned out to be hidden; cleared on
  // navigation.
  let forceFallback = false;

  // Synchronous, before anything renders: the shield is on, and is this a game page?
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

  // Where the panel goes: below ESPN's game tabs, inside the main content area. Null
  // means show the panel on its own (unrecognized layout, or a page like the recap).
  function inPageSpot() {
    if (forceFallback) return null;
    const offset = document.querySelector('.Gamestrip__ContentOffset');
    const top = offset?.closest('#fittPageContainer, main');
    return offset && top ? { parent: offset, top, nav: offset.querySelector(':scope > .NavSecondary--GamePackage') } : null;
  }

  // Mark every element from the panel up to the main content area. shield.css hides all
  // other elements in that area, so whatever ESPN adds or renames there stays hidden.
  function clearKeep() {
    for (const el of document.querySelectorAll('[data-nss-keep]')) el.removeAttribute('data-nss-keep');
  }

  function markKeep(from, top) {
    clearKeep();
    for (let el = from.parentElement; el; el = el.parentElement) {
      el.setAttribute('data-nss-keep', '');
      if (el === top) break;
    }
  }

  // Put the strip and panel in place (again, if ESPN re-rendered over them).
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
      markKeep(root, spot.top);
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

    // If something on ESPN's page still hides the spot we picked, the panel would vanish
    // along with ESPN's content. Show it on its own instead.
    if (spot && typeof root.checkVisibility === 'function' && !root.checkVisibility()) {
      forceFallback = true;
      mount();
    }
  }

  function unmount() {
    document.getElementById('nss-strip')?.remove();
    document.getElementById('nss-root')?.remove();
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
    const stripHtml = View.renderStrip(view, game);
    const bodyHtml = View.renderBody(View.pageKind(location.href), view);
    if (stripHtml !== rendered.strip) strip.innerHTML = stripHtml;
    if (bodyHtml !== rendered.body) root.innerHTML = bodyHtml;
    rendered = { strip: stripHtml, body: bodyHtml };
  }

  function applyTitle() {
    if (!isHere()) return;
    const title = `${game.shortName || `${game.away} @ ${game.home}`} · Spoiler Sync`;
    if (document.title !== title) document.title = title;
  }

  // The synced game's card on scoreboard pages: ESPN's content is hidden and our own card
  // (synced score and links to the game's pages) sits on top. Until ours is in place the
  // card just says it's hidden.
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
      }`;
    (document.head || html).appendChild(style);
  }

  function scoreboardCard() {
    const card = game && document.getElementById(game.id);
    return card && card.matches('section.Scoreboard') ? card : null;
  }

  function mountScoreCard() {
    const card = canMount && scoreboardCard();
    if (!card) return;
    let el = document.getElementById('nss-scorecard');
    if (el?.parentElement === card) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'nss-scorecard';
    }
    card.append(el);
    renderedCard = null;
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
      mountScoreCard();
      applyLocation();
    } else if (msg?.type === 'view') {
      view = msg.view;
      render();
      renderScoreCard();
    }
  }

  function connect() {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'espn-tab' });
    } catch {
      return; // extension reloaded or removed; the page keeps whatever it showed
    }
    port.onMessage.addListener(onMessage);
    // The background worker can be suspended, which closes the port. Reconnect and
    // keep showing the last safe view in the meantime.
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  }

  // ESPN navigates between pages without reloading. Our MAIN-world hook reports
  // pushState/replaceState synchronously so the right parts are hidden before the new
  // page paints; the observer also catches ESPN re-rendering over our panel.
  const onNavigate = () => {
    if (location.href !== lastHref) applyLocation();
  };
  document.addEventListener('nss:navigated', onNavigate);
  window.addEventListener('popstate', onNavigate);
  new MutationObserver(() => {
    if (location.href !== lastHref) applyLocation();
    else if (isHere()) {
      if (canMount && !isMounted()) mount();
      applyTitle();
    }
    const card = canMount && scoreboardCard();
    if (card && document.getElementById('nss-scorecard')?.parentElement !== card) mountScoreCard();
  }).observe(html, { childList: true, subtree: true });

  function allowMount() {
    setTimeout(() => {
      canMount = true;
      if (isHere()) mount();
      mountScoreCard();
    }, MOUNT_DELAY_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', allowMount, { once: true });
  else allowMount();

  connect();
})();
