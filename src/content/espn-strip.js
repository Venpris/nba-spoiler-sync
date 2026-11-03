// copies ESPN's own score strip and rewrites it with the synced score, clock, quarter
// scores and records, clearing any other number, hiding live-only details (timeouts left,
// "Bonus") and undoing a finished game's winner styling so it can't give the result away
// content script exposing globalThis.NSSEspnStrip, also imported by the tests
(function () {
  const { prepare, writer, ownText, setImage } = globalThis.NSSCopy;
  const TEAM_HREF = /\/team\/_\/name\/([a-z0-9]+)/i;

  function findOriginal(doc) {
    return [...doc.querySelectorAll('.Gamestrip__StickyContainer')].find((el) => !el.closest('[data-nss-copy]')) || null;
  }

  const teamLinks = (root) => [...root.querySelectorAll('a[href*="/team/_/name/"]')];
  const hasLogo = (a) => Boolean(a.querySelector('picture, img'));

  // the strip's two team halves (away, then home), each the ancestor of a team logo just
  // below the element both logos share
  function teamHalves(copy) {
    const logos = teamLinks(copy).filter((a) => hasLogo(a) && !a.closest('table'));
    if (logos.length !== 2) return null;
    let row = logos[0].parentElement;
    while (row && !row.contains(logos[1])) row = row.parentElement;
    if (!row) return null;
    return logos.map((a) => {
      let el = a;
      while (el.parentElement !== row) el = el.parentElement;
      return { el, abbr: TEAM_HREF.exec(a.getAttribute('href'))?.[1].toLowerCase() };
    });
  }

  const scoreElement = (half) => [...half.querySelectorAll('*')].find((el) => /^\d{1,3}$/.test(ownText(el)) && !el.closest('a, table'));
  const nameLink = (half) => teamLinks(half).find((a) => !hasLogo(a));
  // "5-1" and ", 3-1 Away" sit in two spans of one element, which ESPN repeats per team
  const recordElements = (half) => [...half.querySelectorAll('*')].filter((el) => el.children[0] && /^\d+-\d+$/.test(el.children[0].textContent.trim()));

  function periodLabel(period) {
    if (period <= 4) return ['1st', '2nd', '3rd', '4th'][period - 1];
    return period === 5 ? 'OT' : `${period - 4}OT`;
  }

  // ESPN shows the clock, a dash and the quarter in three spans ("7:42", " - ", "3rd")
  function statusParts(status) {
    if (status.state === 'post') return [status.detail || 'Final', '', ''];
    if (status.state === 'pre') return [status.detail || '', '', ''];
    if (status.endOfPeriod && status.period) return [status.period === 2 ? 'Halftime' : `End of ${periodLabel(status.period)}`, '', ''];
    if (status.period && status.clock != null) return [status.clock, ' - ', periodLabel(status.period)];
    return [status.detail || '', '', ''];
  }

  const columnLabel = (period) => (period <= 4 ? String(period) : period === 5 ? 'OT' : `${period - 4}OT`);

  function rewrite(copy, snapshot) {
    const w = writer();
    const halves = teamHalves(copy);
    if (!halves) return null;
    const sides = halves.map((h) => ({ ...h, team: (snapshot.teams || []).find((t) => t.abbrev?.toLowerCase() === h.abbr) }));
    if (sides.some((s) => !s.team || !scoreElement(s.el))) return null;

    // a finished game marks the winner with an arrow and mutes the loser's colors, so give
    // both teams the winner's look, as during play (the arrow is hidden below)
    const winner = sides.find((s) => scoreElement(s.el).querySelector('svg'));
    if (winner) {
      const loser = sides.find((s) => s !== winner);
      const pairs = [
        [nameLink(winner.el), nameLink(loser.el)],
        [scoreElement(winner.el), scoreElement(loser.el)],
        ...recordElements(winner.el).map((el, i) => [el, recordElements(loser.el)[i]]),
      ];
      for (const [from, to] of pairs) if (from && to) to.className = from.className;
    }

    for (const side of sides) {
      const { team } = side;
      // ESPN loads logos lazily, so the hidden original's is often still a placeholder
      setImage(teamLinks(side.el).find(hasLogo), team.logo, '');
      w.set(scoreElement(side.el), team.score ?? '');
      for (const rec of recordElements(side.el)) {
        const [total, venue] = rec.children;
        w.set(total, team.record?.total || '');
        if (venue) w.set(venue, team.record?.venue ? `, ${team.record.venue} ${team.homeAway === 'home' ? 'Home' : 'Away'}` : '');
      }
      // live-only details (possession and winner-arrow icons, timeouts left as a row of dots,
      // "Bonus") are hidden in place so the layout doesn't shift
      for (const el of side.el.querySelectorAll('*')) {
        const dots = el.children.length >= 3 && [...el.children].every((c) => !c.children.length && !c.textContent.trim());
        if (dots || /^bonus$/i.test(ownText(el)) || el.tagName.toLowerCase() === 'svg') el.style.visibility = 'hidden';
      }
    }

    // clock and quarter, in the spans next to (not inside) the quarter-by-quarter table
    const table = copy.querySelector('table');
    const headRow = table?.querySelector('thead tr');
    if (!headRow) return null;
    const outsideTable = (s) => !table.contains(s) && !s.closest('button, a') && !sides.some((side) => side.el.contains(s));
    let center = table.parentElement;
    while (center && center !== copy && ![...center.querySelectorAll('span')].some(outsideTable)) center = center.parentElement;
    const statusSpans = center ? [...center.querySelectorAll('span')].filter(outsideTable) : [];
    if (!statusSpans.length) return null;
    const parts = statusParts(snapshot.status || {});
    if (statusSpans.length >= 3) statusSpans.forEach((s, i) => w.set(s, parts[i] ?? ''));
    else statusSpans.forEach((s, i) => w.set(s, i === 0 ? parts.join('') : ''));

    // quarter-by-quarter table gets as many quarter columns as the synced game has reached
    // (at least four), so an overtime column can't appear early
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    const periods = Math.max(4, ...sides.map((s) => s.team.linescores?.length || 0));
    const rows = [headRow, ...bodyRows];
    let columns = headRow.children.length - 2; // minus the team column and the total
    for (; columns > periods; columns--) for (const row of rows) row.children[columns]?.remove();
    for (; columns < periods; columns++) {
      for (const row of rows) {
        const before = row.children[columns];
        const cell = before.cloneNode(true);
        before.after(cell);
        if (row === headRow) w.set(cell, columnLabel(columns + 1));
      }
    }
    for (const row of bodyRows) {
      const link = row.querySelector('a[href*="/team/_/name/"]');
      const abbr = link ? TEAM_HREF.exec(link.getAttribute('href'))?.[1].toLowerCase() : null;
      const side = sides.find((s) => s.abbr === abbr);
      const cells = [...row.children];
      for (let i = 1; i < cells.length; i++) {
        const value = !side ? '' : i === cells.length - 1 ? side.team.score ?? '' : side.team.linescores?.[i - 1] ?? '';
        w.set(cells[i], value);
      }
    }

    // clear any other text (a playoff note like "BOS leads series 2-1" changes after the
    // game), keeping team names, buttons and quarter headings
    return { teams: 2, cleared: w.clearRest(copy, 'thead, a, button, tbody td:first-child', { allText: true }) };
  }

  // a synced copy of ESPN's score strip ready to insert, or null if the layout isn't
  // recognized (the caller then shows its own strip)
  function buildCopy(original, snapshot) {
    const copy = prepare(original);
    const result = rewrite(copy, snapshot);
    return result ? { copy, result } : null;
  }

  globalThis.NSSEspnStrip = { findOriginal, buildCopy };
})();
