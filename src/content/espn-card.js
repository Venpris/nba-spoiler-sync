// Keeps ESPN's own scoreboard card for the synced game: rewrites a copy of it with the
// synced score, clock, quarter scores, records, last play and top performers. Any other
// text is cleared. A finished game's card shows a recap video where the last play goes,
// and marks the winner; the last play is always rebuilt and the winner mark hidden.
// Runs as a content script (exposes globalThis.NSSEspnCard) and is imported by the tests.
(function () {
  const { prepare, writer } = globalThis.NSSCopy;
  const TEAM_HREF = /\/team\/_\/name\/([a-z0-9]+)/i;
  const BUTTONS = new Set(['Gamecast', 'Box Score', 'Play-by-Play', 'Highlights']);
  // A top performer's line: points, then up to two other standout stats.
  // (Cut-offs picked to match ESPN's choices on real cards.)
  const STANDOUT = { REB: 6, AST: 5, STL: 2, BLK: 2 };

  const headshot = (athleteId) => `https://a.espncdn.com/i/headshots/nba/players/full/${athleteId}.png`;
  const slug = (name) =>
    String(name || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  function findOriginal(doc, game) {
    const card = game && doc.getElementById(game.id);
    return card && card.matches('section.Scoreboard') && !card.hasAttribute('data-nss-copy') ? card : null;
  }

  function periodLabel(period) {
    if (period <= 4) return ['1st', '2nd', '3rd', '4th'][period - 1];
    return period === 5 ? 'OT' : `${period - 4}OT`;
  }
  const columnLabel = (period) => (period <= 4 ? String(period) : period === 5 ? 'OT' : `${period - 4}OT`);

  function statusText(status) {
    if (status.state === 'post') return status.detail || 'Final';
    if (status.state === 'pre') return status.detail || '';
    if (status.endOfPeriod && status.period) return status.period === 2 ? 'Halftime' : `End of ${periodLabel(status.period)}`;
    if (status.period && status.clock != null) return `${status.clock} - ${periodLabel(status.period)}`;
    return status.detail || '';
  }

  // Make a row of cells exactly `count` long (cloning the last cell or removing extras),
  // then fill each one.
  function fitCells(cells, count, fill) {
    const list = [...cells];
    if (!list.length) return;
    while (list.length > count) list.pop().remove();
    while (list.length < count) {
      const cell = list[list.length - 1].cloneNode(true);
      list[list.length - 1].after(cell);
      list.push(cell);
    }
    list.forEach(fill);
  }

  function setImage(img, src, alt) {
    if (!img) return;
    if (src) {
      for (const a of [...img.attributes]) if (a.name === 'srcset' || a.name.startsWith('data-')) img.removeAttribute(a.name);
      img.setAttribute('src', src);
      img.style.visibility = '';
    } else {
      img.style.visibility = 'hidden';
    }
    img.setAttribute('alt', alt ?? '');
  }

  function topPerformer(entry) {
    if (!entry) return null;
    const value = (p, label) => Number(p.stats[entry.labels.indexOf(label)]) || 0;
    const played = entry.players.filter((p) => p.stats?.length);
    if (!played.length) return null;
    const player = played.reduce((a, b) => {
      const pts = value(b, 'PTS') - value(a, 'PTS');
      return pts > 0 || (pts === 0 && value(b, 'REB') + value(b, 'AST') > value(a, 'REB') + value(a, 'AST')) ? b : a;
    });
    const order = Object.keys(STANDOUT);
    const extras = order
      .map((label) => ({ label, value: value(player, label) }))
      .filter((s) => s.value >= STANDOUT[s.label])
      .sort((a, b) => b.value / STANDOUT[b.label] - a.value / STANDOUT[a.label])
      .slice(0, 2)
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    return { player, stats: [{ label: 'PTS', value: value(player, 'PTS') }, ...extras] };
  }

  // ESPN's "Last Play" block, built with ESPN's own classes from the synced latest play.
  function lastPlay(doc, snapshot, plays, w) {
    const play = [...(plays || [])].sort((a, b) => b.seq - a.seq)[0];
    if (!play) return null;
    const team = (snapshot.teams || []).find((t) => t.id === play.teamId);
    const status = snapshot.status || {};
    const el = (tag, className) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      return node;
    };
    const section = el('section', 'LastPlay');
    const heading = el('h1', 'h8 mb3');
    const time = status.endOfPeriod && status.period === play.period ? statusText(status) : `${play.clock} - ${periodLabel(play.period)}`;
    w.set(heading, `Last Play ${time}`);
    const row = el('div', 'flex items-center');
    const shot = el('div', 'headshot inline-block relative mr3 flex-none');
    const figure = el('figure', 'Image aspect-ratio--parent');
    const wrap = el('div', 'Image__Wrapper aspect-ratio--child');
    const img = el('img');
    setImage(img, play.athleteId ? headshot(play.athleteId) : team?.logo, '');
    wrap.append(img);
    figure.append(el('div', 'RatioFrame aspect-ratio--1x1'), wrap);
    shot.append(figure);
    const text = el('span', 'n8 clr-gray-03');
    const inner = el('span');
    w.set(inner, team ? `${team.abbrev} - ${play.text}` : play.text);
    text.append(inner);
    row.append(shot, text);
    section.append(heading, row);
    return section;
  }

  function fillPerformer(item, team, top, w) {
    const { player, stats } = top;
    const link = item.querySelector('a.Athlete, a[href*="/player/_/id/"]');
    if (link) link.setAttribute('href', `/nba/player/_/id/${player.id}/${slug(player.name)}`);
    setImage(item.querySelector('img'), headshot(player.id), player.shortName);
    const name = item.querySelector('.Athlete__PlayerName');
    if (name) w.set(name, player.shortName || player.name);
    const details = item.querySelector('.Athlete__NameDetails');
    if (details) w.set(details, `${player.jersey != null ? `#${player.jersey} ` : ''}- ${team.abbrev}`);
    const statList = item.querySelector('.Athlete__Stats');
    if (statList) {
      fitCells(statList.children, stats.length, (pair, i) => {
        const value = pair.querySelector('.Athlete__Stats--value');
        const label = pair.querySelector('.Athlete__Stats--label');
        if (value) w.set(value, String(stats[i].value));
        if (label) w.set(label, stats[i].label);
      });
    }
    return item;
  }

  function rewrite(copy, snapshot, plays) {
    const w = writer();
    const doc = copy.ownerDocument;
    const cell = copy.querySelector('.ScoreboardScoreCell');
    const items = [...copy.querySelectorAll('.ScoreboardScoreCell__Competitors > li')];
    if (!cell || items.length !== 2) return null;
    const sides = items.map((li) => {
      const link = li.querySelector('a[href*="/team/_/name/"]');
      const abbr = link && TEAM_HREF.exec(link.getAttribute('href'))?.[1].toLowerCase();
      return { li, team: (snapshot.teams || []).find((t) => t.abbrev?.toLowerCase() === abbr) };
    });
    if (sides.some((s) => !s.team || !s.li.querySelector('.ScoreCell__Score'))) return null;
    const status = snapshot.status || {};
    const state = ['pre', 'post'].includes(status.state) ? status.state : 'in';

    // The card's state and clock, styled the way ESPN styles that state.
    cell.className = /ScoreboardScoreCell--\w+/.test(cell.className)
      ? cell.className.replace(/ScoreboardScoreCell--\w+/, `ScoreboardScoreCell--${state}`)
      : `${cell.className} ScoreboardScoreCell--${state}`;
    const time = copy.querySelector('.ScoreboardScoreCell__Time');
    if (time) {
      time.className =
        state === 'in'
          ? 'ScoreCell__Time ScoreboardScoreCell__Time ScoreCell__Time--default clr-negative'
          : 'ScoreCell__Time ScoreboardScoreCell__Time h9 clr-gray-01';
      w.set(time, statusText(status));
    }

    // Quarter columns: as many as the synced game has reached (at least four), so an
    // overtime column can't appear early.
    const periods = Math.max(4, ...sides.map((s) => s.team.linescores?.length || 0));
    fitCells(copy.querySelectorAll('.ScoreboardScoreCell__Heading:not(.ScoreboardScoreCell__Heading--total)'), periods, (el, i) => w.set(el, columnLabel(i + 1)));

    for (const { li, team } of sides) {
      for (const svg of li.querySelectorAll('svg')) svg.style.visibility = 'hidden'; // winner mark
      setImage(li.querySelector('img'), team.logo, '');
      const [total, venue] = li.querySelectorAll('.ScoreboardScoreCell__Record');
      if (total) w.set(total, team.record?.total || '');
      const venueText = venue && [...venue.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
      if (venueText) w.setNode(venueText, team.record?.venue ? venueText.nodeValue.replace(/\d+-\d+/, team.record.venue) : '');
      fitCells(li.querySelectorAll('.ScoreboardScoreCell__Value'), periods, (el, i) => w.set(el, team.linescores?.[i] ?? ''));
      w.set(li.querySelector('.ScoreCell__Score'), team.score ?? '');
    }

    // Last play, rebuilt every time (a finished game has a recap video here instead).
    const lastColumn = copy.querySelector('.Scoreboard__Column--2 .column-content') || copy.querySelector('.Scoreboard__Column--2');
    if (lastColumn) lastColumn.replaceChildren(...[lastPlay(doc, snapshot, plays, w)].filter(Boolean));

    // Top performers: the synced leading scorer for each team.
    const performers = [...copy.querySelectorAll('.Scoreboard__Performers .ContentList__Item')];
    if (performers.length) {
      const template = performers[0];
      const tops = sides.map(({ team }) => ({ team, top: topPerformer((snapshot.box || []).find((b) => b.teamId === team.id)) })).filter((x) => x.top);
      template.parentElement.replaceChildren(...tops.map(({ team, top }) => fillPerformer(template.cloneNode(true), team, top, w)));
    }

    // Buttons: only links to the game's pages and highlights.
    for (const a of copy.querySelectorAll('.Scoreboard__Callouts a')) if (!BUTTONS.has(a.textContent.trim())) a.style.display = 'none';

    // Anything else is cleared; team names, "Home"/"Away", headings and buttons stay.
    const keep = '.ScoreCell__TeamName, .ScoreboardScoreCell__Record--homeAway, .ScoreboardScoreCell__Headings, .Scoreboard__Callouts, .Scoreboard__Column--3 h4';
    return { teams: 2, cleared: w.clearRest(copy, keep, { allText: true }) };
  }

  function buildCopy(original, snapshot, plays) {
    const copy = prepare(original);
    const result = rewrite(copy, snapshot, plays);
    return result ? { copy, result } : null;
  }

  globalThis.NSSEspnCard = { findOriginal, buildCopy };
})();
