// rewrites a copy of ESPN's box score with the synced stats, keeping ESPN's own layout
// every number in the copy is either written from the synced snapshot or cleared, so a
// row or column we can't match shows blank, never ESPN's live value
// runs as a content script (exposes globalThis.NSSEspnBox) and is imported by the tests
(function () {
  const { prepare, writer, setImage } = globalThis.NSSCopy;
  const PLAYER_ID = /\/player\/_\/id\/(\d+)/;

  // the element to copy, ESPN's box score card (or the box score itself)
  function findOriginal(doc) {
    const box = [...doc.querySelectorAll('.Boxscore__ResponsiveWrapper')].find((el) => !el.closest('[data-nss-copy]'));
    if (!box) return null;
    return box.closest('section.Card') || box;
  }

  function teamFor(block, snapshot) {
    const name = block.querySelector('.BoxscoreItem__TeamName')?.textContent.trim().toLowerCase();
    if (!name) return null;
    return (snapshot.teams || []).find((t) => [t.name, t.shortName, t.abbrev].some((n) => n && n.toLowerCase() === name)) || null;
  }

  // column labels (MIN, PTS, ...) from the stats table's header row
  function columnLabels(statsTable) {
    const header = [...statsTable.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.Table__customHeader'));
    return header ? [...header.children].map((td) => td.textContent.trim()) : [];
  }

  function percent(madeAttempted) {
    const [made, attempted] = String(madeAttempted ?? '').split('-').map(Number);
    return attempted ? `${Math.round((100 * made) / attempted)}%` : '';
  }

  function rewrite(copy, snapshot) {
    const w = writer();
    const setText = w.set;
    const doc = copy.ownerDocument;
    const result = { teams: 0, teamsMatched: 0, players: 0, playersMatched: 0 };
    const box = copy.matches('.Boxscore__ResponsiveWrapper') ? copy : copy.querySelector('.Boxscore__ResponsiveWrapper');

    for (const block of box ? [...box.children] : []) {
      const tables = block.querySelectorAll('table');
      if (tables.length < 2) continue;
      result.teams++;
      const namesTable = tables[0];
      const statsTable = tables[tables.length - 1];
      const team = teamFor(block, snapshot);
      const entry = team && (snapshot.box || []).find((b) => b.teamId === team.id);
      if (entry) result.teamsMatched++;
      if (team) setImage(block.querySelector('.BoxscoreItem__Title img'), team.logo, ''); // ESPN's loads lazily
      const labels = columnLabels(statsTable);
      const valueFor = (values, label) => {
        const k = entry ? entry.labels.indexOf(label) : -1;
        return k >= 0 ? values?.[k] ?? '' : '';
      };
      const statCellTemplate = statsTable.querySelector('td.BoxscoreItem__Stat');
      const noteCellTemplate = statsTable.querySelector('td.BoxscoreItem__DNP, td[colspan]');

      // one cell per column, as ESPN lays out a player who played
      const fillCells = (row, values) => {
        let cells = [...row.children];
        if (cells.length !== labels.length || row.querySelector('td[colspan]')) {
          row.replaceChildren(
            ...labels.map(() => {
              if (statCellTemplate) return statCellTemplate.cloneNode(false);
              const td = doc.createElement('td');
              td.className = 'Table__TD BoxscoreItem__Stat';
              return td;
            }),
          );
          cells = [...row.children];
        }
        cells.forEach((cell, i) => setText(cell, values[i] ?? ''));
      };
      // one cell across the row, as ESPN shows "DNP-COACH'S DECISION"
      const fillNote = (row, text) => {
        let cell = row.children.length === 1 ? row.children[0] : null;
        if (!cell) {
          if (noteCellTemplate) cell = noteCellTemplate.cloneNode(false);
          else {
            cell = doc.createElement('td');
            cell.className = 'tc td BoxscoreItem__DNP Table__TD';
            cell.setAttribute('colspan', String(labels.length + 1));
          }
          row.replaceChildren(cell);
        }
        setText(cell, text);
      };

      let afterTeamRow = false;
      for (const nameRow of namesTable.querySelectorAll('tbody tr')) {
        const statRow = statsTable.querySelector(`tbody tr[data-idx="${nameRow.getAttribute('data-idx')}"]`);
        if (!statRow) continue;
        const link = nameRow.querySelector('a[href*="/player/_/id/"]');
        const rowLabel = nameRow.textContent.trim().toLowerCase();
        if (link) {
          result.players++;
          const id = PLAYER_ID.exec(link.getAttribute('href'))?.[1];
          const player = entry?.players.find((p) => String(p.id) === id);
          if (player) result.playersMatched++;
          if (player?.stats?.length) fillCells(statRow, labels.map((l) => valueFor(player.stats, l)));
          else if (player?.dnp) fillNote(statRow, `DNP${player.reason ? `-${player.reason}` : ''}`);
          else fillCells(statRow, labels.map(() => ''));
        } else if (rowLabel === 'team') {
          fillCells(statRow, labels.map((l) => valueFor(entry?.totals, l)));
          afterTeamRow = true;
          continue;
        } else if (afterTeamRow && !rowLabel) {
          // shooting percentages under FG, 3PT and FT
          fillCells(statRow, labels.map((l) => (['FG', '3PT', 'FT'].includes(l) ? percent(valueFor(entry?.totals, l)) : '')));
        }
        afterTeamRow = false;
      }
    }

    // clear any other text with a digit, except column headers ("3PT") and jersey numbers,
    // which don't change during a game
    result.cleared = w.clearRest(copy, '.playerJersey, .Table__customHeader');
    return result;
  }

  // a synced copy of ESPN's box score ready to insert, or null if the layout isn't
  // recognized (the caller then falls back to its own panel)
  function buildCopy(original, snapshot) {
    const copy = prepare(original);
    const result = rewrite(copy, snapshot);
    if (!result.teams || result.teamsMatched < result.teams) return null;
    return { copy, result };
  }

  globalThis.NSSEspnBox = { findOriginal, buildCopy };
})();
