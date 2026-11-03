// Keeps ESPN's own Gamecast and Play-by-Play widgets that are text: Last Plays, Game
// Leaders, Team Stats, Game Information and the play-by-play list. Each is a copy of
// ESPN's widget rewritten from the synced snapshot, with any other text cleared. The
// other widgets (win probability and shot charts, lineups, highlights, odds, standings,
// news) stay hidden.
// Runs as a content script (exposes globalThis.NSSEspnGamecast) and is imported by tests.
(function () {
  const { prepare, writer, ownText } = globalThis.NSSCopy;

  const headshot = (athleteId) => `https://a.espncdn.com/i/headshots/nba/players/full/${athleteId}.png`;
  const slug = (name) =>
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const periodLabel = (p) => (p <= 4 ? ['1st', '2nd', '3rd', '4th'][p - 1] : p === 5 ? 'OT' : `${p - 4}OT`);
  const hide = (el) => el && (el.style.display = 'none');
  const leaves = (root) => [...root.querySelectorAll('*')].filter((el) => !el.children.length);
  const orderedTeams = (snapshot) => ['away', 'home'].map((side) => (snapshot.teams || []).find((t) => t.homeAway === side));

  // The widget an element belongs to: its ancestor directly inside one of the page's columns.
  function widgetOf(el) {
    return el?.closest('.PageLayout__Main > *, .PageLayout__LeftAside > *, .PageLayout__RightAside > *') || null;
  }
  const notCopy = (el) => el && !el.closest('[data-nss-copy]');
  function widgetTitled(doc, title) {
    const heading = [...doc.querySelectorAll('h2, h3')].find((h) => h.textContent.trim() === title && notCopy(h));
    return widgetOf(heading);
  }

  // A <picture> (or plain <img>) showing src instead of ESPN's lazily loaded image.
  function setPicture(container, src, alt) {
    const picture = container?.matches?.('picture, img') ? container : container?.querySelector('picture, img');
    if (!picture) return;
    const img = picture.tagName.toLowerCase() === 'img' ? picture : picture.querySelector('img') || picture.appendChild(picture.ownerDocument.createElement('img'));
    for (const source of picture.querySelectorAll('source')) source.remove();
    for (const a of [...img.attributes]) if (a.name === 'srcset' || a.name.startsWith('data-')) img.removeAttribute(a.name);
    if (src) img.setAttribute('src', src);
    img.style.visibility = src ? '' : 'hidden';
    img.setAttribute('alt', alt ?? '');
  }

  function statOf(entry, player, label) {
    return player.stats?.[entry.labels.indexOf(label)] ?? '';
  }
  const num = (v) => Number(String(v).split('-')[0]) || 0;

  // ---- Last Plays --------------------------------------------------------------------

  const lastPlays = {
    findOriginal: (doc) => [...doc.querySelectorAll('.LastPlays__Basketball')].find(notCopy) || null,

    buildCopy(original, snapshot, plays) {
      const copy = prepare(original);
      const w = writer();
      // The court animation and any "live" badge reflect the live game.
      for (const el of copy.querySelectorAll('[data-testid="rive-animation-wrapper"], canvas')) hide(el);

      // Each play card has the play's time ("7:42 - 3rd") and its text in a <p>.
      const isCard = (el) => el.querySelector(':scope > p') && leaves(el).some((l) => /\d:\d\d|\d\.\d/.test(l.textContent) && /-/.test(l.textContent));
      const cards = [...copy.querySelectorAll('div')].filter(isCard);
      if (!cards.length) return null;
      const list = cards[0].parentElement;
      // ESPN animates the newest card in from above (hidden until it slides down); the
      // settled cards are what's visible, and one is the template.
      const settled = cards.filter((c) => !/top:\s*-/.test(c.getAttribute('style') || ''));
      const template = settled[0] || cards[0];
      const teams = new Map((snapshot.teams || []).map((t) => [t.id, t]));
      const recent = [...(plays || [])].sort((a, b) => b.seq - a.seq).slice(0, settled.length || cards.length);

      const fresh = recent.map((play) => {
        const card = template.cloneNode(true);
        const team = teams.get(play.teamId);
        setPicture(card, play.athleteId ? headshot(play.athleteId) : team?.logo, '');
        // The dotted marker in the team's color.
        for (const bar of card.querySelectorAll('div[style*="background"]')) {
          if (team?.color) bar.setAttribute('style', bar.getAttribute('style').replace(/#[0-9a-f]{3,8}/i, `#${team.color}`));
        }
        const time = leaves(card).find((l) => /\d:\d\d|\d\.\d/.test(l.textContent) && /-/.test(l.textContent));
        if (time) w.set(time, `${play.clock} - ${periodLabel(play.period)}`);
        // Live win probability ("Win %: SAC, 61.2"): hide its whole line.
        const winChance = [...card.querySelectorAll('*')].find((el) => /win\s*%/i.test(ownText(el)));
        hide(winChance?.parentElement && winChance.parentElement !== card ? winChance.parentElement : winChance);
        const type = card.querySelector(':scope > span');
        if (type) w.set(type, play.label || play.type || '');
        const text = card.querySelector(':scope > p');
        if (text) w.set(text, play.text || '');
        const score = [...card.children].find((c) => c.children.length === 2 && [...c.children].every((s) => s.tagName.toLowerCase() === 'span'));
        if (score) {
          w.set(score.children[0], String(play.away ?? ''));
          w.set(score.children[1], String(play.home ?? ''));
        }
        return card;
      });
      for (const card of cards) card.remove();
      list.append(...fresh);

      // The team logo next to the list: the latest play's team.
      const columnLogo = list.parentElement?.querySelector(':scope > div > picture, :scope > picture');
      if (columnLogo) setPicture(columnLogo, teams.get(recent[0]?.teamId)?.logo, '');

      w.clearRest(copy, 'footer', { allText: true });
      return { copy, result: { plays: fresh.length } };
    },
  };

  // ---- Game Leaders ------------------------------------------------------------------

  const CATEGORIES = {
    Points: { stat: 'PTS', detail: (e, p) => `${String(statOf(e, p, 'FG')).replace('-', '/')} FG, ${String(statOf(e, p, 'FT')).replace('-', '/')} FT` },
    Rebounds: { stat: 'REB', detail: (e, p) => `${statOf(e, p, 'DREB')} DREB, ${statOf(e, p, 'OREB')} OREB` },
    Assists: { stat: 'AST', detail: (e, p) => `${statOf(e, p, 'TO')} TO, ${statOf(e, p, 'MIN')} MIN` },
  };

  function leaderOf(entry, stat) {
    const played = (entry?.players || []).filter((p) => p.stats?.length);
    if (!played.length) return null;
    return played.reduce((a, b) => (num(statOf(entry, b, stat)) > num(statOf(entry, a, stat)) ? b : a));
  }

  const leaders = {
    findOriginal: (doc) => widgetTitled(doc, 'Game Leaders'),

    buildCopy(original, snapshot) {
      const copy = prepare(original);
      const w = writer();
      const teams = orderedTeams(snapshot);
      if (teams.some((t) => !t)) return null;
      let filled = 0;
      for (const section of copy.querySelectorAll('section')) {
        const header = section.querySelector(':scope > header');
        const category = CATEGORIES[header?.textContent.trim()];
        const links = [...section.querySelectorAll(':scope > a[href*="/player/_/id/"]')];
        if (!category || links.length !== 2) continue;
        links.forEach((link, i) => {
          const team = teams[i];
          const entry = (snapshot.box || []).find((b) => b.teamId === team.id);
          const player = leaderOf(entry, category.stat);
          if (!player) return hide(link);
          link.setAttribute('href', `/nba/player/_/id/${player.id}/${slug(player.name)}`);
          setPicture(link, headshot(player.id), player.shortName);
          for (const leaf of leaves(link)) {
            const t = leaf.textContent.trim();
            if (/^\d+$/.test(t)) w.set(leaf, String(statOf(entry, player, category.stat)));
            else if (/^#\d*$/.test(t)) w.set(leaf, player.jersey != null ? `#${player.jersey}` : '');
            else if (/,/.test(t)) w.set(leaf, category.detail(entry, player));
            else if (t) w.set(leaf, player.shortName || player.name);
          }
          filled++;
        });
      }
      if (!filled) return null;
      // Headings, team abbreviations and the footer link stay; anything else is cleared.
      w.clearRest(copy, 'h2, header, footer, [data-testid="prism-VisuallyHidden"], a[href*="/team/"]', { allText: true });
      return { copy, result: { leaders: filled } };
    },
  };

  // ---- Team Stats --------------------------------------------------------------------

  const SHOOTING = {
    'Field Goal %': 'fieldGoalsMade-fieldGoalsAttempted',
    'Three Point %': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
    'Free Throw %': 'freeThrowsMade-freeThrowsAttempted',
  };
  // Which of ESPN's team stats each row shows (others are matched by label).
  const ROW_STAT = {
    Turnovers: 'totalTurnovers',
    Rebounds: 'totalRebounds',
    'Percent Led': 'leadPercentage',
    'Largest Lead': 'largestLead',
  };

  const teamStats = {
    findOriginal: (doc) => [...doc.querySelectorAll('[data-testid="TeamStats"]')].find(notCopy) || widgetTitled(doc, 'Team Stats'),

    buildCopy(original, snapshot) {
      const copy = prepare(original);
      const w = writer();
      const teams = orderedTeams(snapshot);
      if (teams.some((t) => !t)) return null;
      const statsFor = (team) => (snapshot.teamStats || []).find((s) => s.teamId === team.id)?.stats || [];
      const [awayStats, homeStats] = teams.map(statsFor);
      const byLabel = (stats, label) => stats.find((s) => s.label === label);
      const byName = (stats, name) => stats.find((s) => s.name === name);

      // Team logos in the header.
      teams.forEach((team, i) => setPicture(copy.querySelectorAll('a[href*="/team/"]')[i], team.logo, ''));

      let rows = 0;
      for (const label of [...copy.querySelectorAll('p')].filter((p) => !p.querySelector('span') && p.textContent.trim())) {
        const name = label.textContent.trim();
        const row = label.parentElement;
        const [left, right] = [...row.children].filter((c) => c !== label && c.tagName.toLowerCase() === 'p');
        if (!left || !right) continue;
        const values = [awayStats, homeStats].map((stats) => {
          if (SHOOTING[name]) {
            const made = byName(stats, SHOOTING[name])?.value || '';
            const [m, a] = made.split('-').map(Number);
            return { text: a ? `${Math.round((100 * m) / a)}%` : '', made, number: a ? (100 * m) / a : 0 };
          }
          const v = (ROW_STAT[name] ? byName(stats, ROW_STAT[name]) : byLabel(stats, name))?.value ?? '';
          return { text: v === '' ? '' : `${v}${name === 'Percent Led' ? '%' : ''}`, number: Number(v) || 0 };
        });
        w.set(label, name);
        [left, right].forEach((p, i) => {
          const [value, detail] = p.querySelectorAll(':scope > span');
          if (value) w.set(value, values[i].text);
          if (detail) w.set(detail, values[i].made ? `(${values[i].made})` : '');
        });
        // Comparison bars: each team's percentage, or each team's share of the total.
        const bars = [...row.parentElement.querySelectorAll('[data-testid="prism-ProgressBar"]')];
        const [a, h] = values.map((v) => v.number);
        const widths = (bar, first, second) => {
          if (bar?.children.length !== 2) return;
          bar.children[0].style.width = `${first}%`;
          bar.children[1].style.width = `${second}%`;
        };
        if (bars.length === 2) {
          widths(bars[0], a, 100 - a); // away fills from the left
          widths(bars[1], 100 - h, h); // home fills from the right
        } else if (bars.length === 1) {
          const total = a + h;
          widths(bars[0], total ? (100 * a) / total : 50, total ? (100 * h) / total : 50);
        }
        rows++;
      }
      if (!rows) return null;
      w.clearRest(copy, 'h2, footer, a[href*="/team/"]', { allText: true });
      return { copy, result: { rows } };
    },
  };

  // ---- Game Information --------------------------------------------------------------

  const DATE_OR_TIME = /\b(AM|PM)\b|January|February|March|April|May|June|July|August|September|October|November|December/;

  const gameInfo = {
    findOriginal: (doc) => widgetTitled(doc, 'Game Information'),

    // Venue, broadcasters and referees don't change. Any other number (like attendance,
    // posted after the game) is cleared; the date and tip-off time stay.
    buildCopy(original) {
      const copy = prepare(original);
      const walker = copy.ownerDocument.createTreeWalker(copy, 4 /* NodeFilter.SHOW_TEXT */);
      const stale = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/\d/.test(n.nodeValue) && !DATE_OR_TIME.test(n.parentElement?.textContent || '')) stale.push(n);
      }
      for (const n of stale) n.nodeValue = '';
      for (const el of copy.querySelectorAll('*')) if (/attendance|capacity/i.test(ownText(el))) hide(el.parentElement);
      return { copy, result: { cleared: stale.length } };
    },
  };

  // ---- Play-by-Play list -------------------------------------------------------------

  // The score shown on a play: two spans (away, home), the scoring team's in bold.
  const scoreOf = (el) => [...el.querySelectorAll('div')].find((d) => d.children.length === 2 && [...d.children].every((s) => s.tagName.toLowerCase() === 'span'));

  const playByPlay = {
    findOriginal: (doc) => widgetOf([...doc.querySelectorAll('[data-testid="PlayByPlay"]')].find(notCopy)),

    // ESPN's list holds the newest plays first and loads more as you scroll; the copy
    // holds every synced play, newest first, in ESPN's markup.
    buildCopy(original, snapshot, plays) {
      const copy = prepare(original);
      const w = writer();
      // The shot chart plots every shot so far, and its filters only work on ESPN's list.
      for (const el of copy.querySelectorAll('[data-testid="ShotChartFilterButtons"], .ShotChart, section:has([data-testid="ShotChart"])')) hide(el);

      const items = [...copy.querySelectorAll('[data-testid="PlayByPlay"] [data-testid="prism-Accordion"]')].map((a) => a.parentElement);
      if (!items.length) return null;
      const list = items[0].parentElement;
      const scoring = items.find((item) => scoreOf(item.querySelector('button') || item));
      const plain = items.find((item) => !scoreOf(item.querySelector('button') || item) && item.querySelector('picture')) || items.find((item) => item !== scoring) || scoring;
      const scoreSpans = scoring ? [...scoreOf(scoring.querySelector('button') || scoring).children] : [];
      const boldClass = scoreSpans.find((s) => s.className.trim())?.className || '';
      const plainClass = scoreSpans.find((s) => !s.className.trim())?.className || '';
      const teams = new Map((snapshot.teams || []).map((t) => [t.id, t]));
      const awayId = (snapshot.teams || []).find((t) => t.homeAway === 'away')?.id;

      const fresh = [...(plays || [])]
        .sort((a, b) => b.seq - a.seq)
        .map((play) => {
          const item = ((play.scoring && scoring) || plain).cloneNode(true);
          const section = item.querySelector('[data-testid="prism-Accordion"]');
          // Expanded details (live win probability, an animation) and the expand control.
          for (const child of item.children) if (child !== section) hide(child);
          hide(section.querySelector('[role="region"]'));
          const button = section.querySelector('button') || section;
          const team = teams.get(play.teamId);
          setPicture(button, play.athleteId ? headshot(play.athleteId) : team?.logo, '');
          // The marker in the team's color: dotted for most plays, solid for scoring plays.
          for (const marker of button.querySelectorAll('div[style*="background"]')) {
            if (team?.color) marker.setAttribute('style', marker.getAttribute('style').replace(/#[0-9a-f]{3,8}/i, `#${team.color}`));
          }
          const spans = [...button.querySelectorAll('span')];
          const time = spans.find((s) => /\d:\d\d|\d\.\d/.test(s.textContent) && / - /.test(s.textContent));
          const label = spans.find((s) => s !== time && !s.closest('picture') && !scoreOf(button)?.contains(s));
          if (label) w.set(label, play.label || play.type || '');
          if (time) w.set(time, `${play.clock} - ${periodLabel(play.period)}`);
          const text = button.querySelector('p');
          if (text) w.set(text, play.text || '');
          const score = scoreOf(button);
          if (score && play.scoring) {
            const [awaySpan, homeSpan] = score.children;
            w.set(awaySpan, String(play.away ?? ''));
            w.set(homeSpan, String(play.home ?? ''));
            const awayScored = play.teamId === awayId;
            awaySpan.className = awayScored ? boldClass : plainClass;
            homeSpan.className = awayScored ? plainClass : boldClass;
          } else if (score) {
            score.remove();
          }
          return item;
        });
      // Replace ESPN's items and its load-more placeholder.
      list.replaceChildren(...fresh);

      // The team logo beside the list: the latest play's team.
      const column = list.parentElement;
      const columnLogo = column?.querySelector(':scope > div > picture, :scope > picture');
      if (columnLogo) setPicture(columnLogo, teams.get([...(plays || [])].sort((a, b) => b.seq - a.seq)[0]?.teamId)?.logo, '');

      w.clearRest(copy, 'header, [role="tablist"], footer', { allText: true });
      return { copy, result: { plays: fresh.length } };
    },
  };

  // ---- Team Stats page table ---------------------------------------------------------

  // A plain table: a row per stat (labelled as in ESPN's data), away team then home.
  const matchupTable = {
    findOriginal: (doc) => widgetOf([...doc.querySelectorAll('[data-testid="teamStatsTable"]')].find(notCopy)),

    buildCopy(original, snapshot) {
      const copy = prepare(original);
      const w = writer();
      const teams = orderedTeams(snapshot);
      const table = copy.querySelector('table');
      if (!table || teams.some((t) => !t)) return null;
      const statsFor = (team) => (snapshot.teamStats || []).find((s) => s.teamId === team.id)?.stats || [];
      const [awayStats, homeStats] = teams.map(statsFor);
      [...table.querySelectorAll('thead img')].slice(0, 2).forEach((img, i) => setPicture(img, teams[i].logo, teams[i].abbrev));
      let rows = 0;
      for (const row of table.querySelectorAll('tbody tr')) {
        const [label, ...values] = row.children;
        if (!label || values.length !== 2) continue;
        const name = label.textContent.trim();
        [awayStats, homeStats].forEach((stats, i) => w.set(values[i], stats.find((s) => s.label === name)?.value ?? ''));
        w.set(label, name);
        rows++;
      }
      if (!rows) return null;
      w.clearRest(copy, 'thead, header', { allText: true });
      return { copy, result: { rows } };
    },
  };

  globalThis.NSSEspnGamecast = { lastPlays, leaders, teamStats, gameInfo, playByPlay, matchupTable };
})();
