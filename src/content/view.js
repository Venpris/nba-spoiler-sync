// Builds the panel that replaces ESPN's game content: score strip, box score,
// play-by-play and team stats, all from the synced snapshot. Runs as a content script
// (exposes globalThis.NSSView) and is imported directly by the tests.
(function () {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const safeUrl = (url) => (/^https:\/\/[^\s"'<>]+$/.test(url || '') ? url : '');

  // The ESPN game id in an NBA game page URL (/nba/boxscore/_/gameId/123 or ?gameId=123).
  function nbaGameIdFromUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (!url.pathname.startsWith('/nba/')) return null;
    const match = /\/gameId\/(\d+)/.exec(url.pathname);
    const id = match ? match[1] : url.searchParams.get('gameId');
    return id && /^\d+$/.test(id) ? id : null;
  }

  function pageKind(href) {
    const section = new URL(href).pathname.split('/')[2];
    if (section === 'boxscore') return 'boxscore';
    if (section === 'playbyplay') return 'playbyplay';
    if (section === 'game') return 'gamecast';
    if (section === 'matchup') return 'matchup';
    return 'other';
  }

  function periodLabel(period) {
    if (period <= 4) return ['1st', '2nd', '3rd', '4th'][period - 1];
    return period === 5 ? 'OT' : `${period - 4}OT`;
  }

  function periodHeading(period) {
    if (period <= 4) return `${periodLabel(period)} Quarter`;
    if (period === 5) return 'Overtime';
    const n = period - 4;
    return `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Overtime`;
  }

  function countdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // Away team first, as ESPN lays out NBA games.
  function orderedTeams(snapshot) {
    const teams = snapshot.teams || [];
    return [teams.find((t) => t.homeAway === 'away'), teams.find((t) => t.homeAway === 'home')].filter(Boolean);
  }

  function logo(team, size) {
    const src = safeUrl(team?.logo);
    return src ? `<img class="nss-logo" src="${esc(src)}" alt="" width="${size}" height="${size}">` : '';
  }

  // ---- Score strip -----------------------------------------------------------------

  function statusLine(snapshot) {
    const s = snapshot.status || {};
    if (s.state === 'post') return esc(s.detail || 'Final');
    if (s.state === 'pre') return 'Not started';
    if (s.endOfPeriod && s.period) return s.period === 2 ? 'Halftime' : `End of ${esc(periodLabel(s.period))}`;
    if (s.period && s.clock != null) return `${esc(s.clock)} · ${esc(periodLabel(s.period))}`;
    return esc(s.detail || '');
  }

  function linescoreTable(teams) {
    const periods = Math.max(0, ...teams.map((t) => t.linescores?.length || 0));
    if (!periods) return '';
    const head = Array.from({ length: periods }, (_, i) => `<th>${esc(i < 4 ? i + 1 : periodLabel(i + 1))}</th>`).join('');
    const rows = teams
      .map((t) => {
        const cells = Array.from({ length: periods }, (_, i) => `<td>${esc(t.linescores?.[i] ?? '')}</td>`).join('');
        return `<tr><th scope="row">${esc(t.abbrev)}</th>${cells}<td class="nss-total">${esc(t.score)}</td></tr>`;
      })
      .join('');
    return `<table class="nss-linescore"><thead><tr><th></th>${head}<th>T</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function stripTeam(team, side) {
    return `<div class="nss-strip__team nss-strip__team--${side}">
      ${logo(team, 48)}
      <div class="nss-strip__names"><div class="nss-strip__abbr">${esc(team.abbrev)}</div><div class="nss-strip__name">${esc(team.shortName)}</div></div>
      <div class="nss-strip__score">${esc(team.score ?? '')}</div>
    </div>`;
  }

  function messageStrip(game, title, detail) {
    const matchup = game ? `<div class="nss-strip__matchup">${esc(game.shortName || `${game.away} @ ${game.home}`)}</div>` : '';
    return `<div class="nss-strip nss-strip--message">
      ${matchup}
      <div class="nss-strip__message"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div>
      <div class="nss-badge">Spoiler Sync</div>
    </div>`;
  }

  function renderStrip(view, game) {
    const error = view?.error ? `<div class="nss-strip__error">${esc(view.error)}</div>` : '';
    if (!view || view.status === 'off') return messageStrip(game, 'Connecting…', 'Waiting for Spoiler Sync.') + error;
    if (view.status === 'unsynced') {
      return messageStrip(game, 'Spoiler Sync is on', 'Open the extension and sync to your stream to see this game.') + error;
    }
    if (view.status === 'loading') {
      const eta = view.readyInMs == null ? 'Recording ESPN’s feed…' : `Ready in about ${countdown(view.readyInMs)}.`;
      return messageStrip(game, 'Getting ready', `${eta} Stats appear once the recording reaches your point in the game.`) + error;
    }
    const snapshot = view.snapshot;
    const [away, home] = orderedTeams(snapshot);
    if (!away || !home) return messageStrip(game, 'Synced', 'ESPN hasn’t posted this game’s details yet.') + error;
    return `<div class="nss-strip">
      ${stripTeam(away, 'away')}
      <div class="nss-strip__center">
        <div class="nss-strip__status">${statusLine(snapshot)}</div>
        ${linescoreTable([away, home])}
        <div class="nss-badge" title="Stats match your stream, not ESPN's live feed">Spoiler Sync · synced to your stream</div>
      </div>
      ${stripTeam(home, 'home')}
    </div>${error}`;
  }

  // ---- Box score -------------------------------------------------------------------

  function playerRow(player, columns) {
    const name = `<td class="nss-name"><span class="nss-player">${esc(player.shortName || player.name)}</span>${
      player.position ? ` <span class="nss-pos">${esc(player.position)}</span>` : ''
    }</td>`;
    if (!player.stats?.length) {
      const note = player.dnp ? `DNP${player.reason ? `-${player.reason}` : ''}` : '—';
      return `<tr class="nss-muted">${name}<td class="nss-dnp" colspan="${columns}">${esc(note)}</td></tr>`;
    }
    return `<tr>${name}${player.stats.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`;
  }

  function teamBox(entry, team) {
    const labels = entry.labels || [];
    const head = (title) =>
      `<tr><th class="nss-name">${esc(title)}</th>${labels
        .map((l, i) => `<th title="${esc(entry.descriptions?.[i] || '')}">${esc(l)}</th>`)
        .join('')}</tr>`;
    const starters = entry.players.filter((p) => p.starter);
    const bench = entry.players.filter((p) => !p.starter);
    const totals = entry.totals?.length ? `<tr class="nss-totals"><th class="nss-name">Team</th>${entry.totals.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>` : '';
    return `<section class="nss-card">
      <header class="nss-card__title">${logo(team, 24)}<span>${esc(team?.name || '')}</span></header>
      <div class="nss-scroll"><table class="nss-table">
        <thead>${head('Starters')}</thead>
        <tbody>${starters.map((p) => playerRow(p, labels.length)).join('')}</tbody>
        <thead>${head('Bench')}</thead>
        <tbody>${bench.map((p) => playerRow(p, labels.length)).join('')}</tbody>
        <tfoot>${totals}</tfoot>
      </table></div>
    </section>`;
  }

  function renderBox(snapshot) {
    const teams = orderedTeams(snapshot);
    const sections = teams
      .map((team) => {
        const entry = (snapshot.box || []).find((b) => b.teamId === team.id);
        return entry ? teamBox(entry, team) : '';
      })
      .join('');
    return sections || card('Box score', '<p class="nss-note">ESPN hasn’t posted a box score yet.</p>');
  }

  // ---- Play-by-play ----------------------------------------------------------------

  function renderPlays(snapshot, plays, limit) {
    const teams = new Map((snapshot.teams || []).map((t) => [t.id, t]));
    const [away, home] = orderedTeams(snapshot);
    const newestFirst = [...(plays || [])].sort((a, b) => b.seq - a.seq).slice(0, limit || Infinity);
    if (!newestFirst.length) return card(limit ? 'Last plays' : 'Play-by-play', '<p class="nss-note">No plays yet.</p>');

    const groups = [];
    for (const play of newestFirst) {
      if (!groups.length || groups[groups.length - 1].period !== play.period) groups.push({ period: play.period, plays: [] });
      groups[groups.length - 1].plays.push(play);
    }
    const scoreHead = `${esc(away?.abbrev || 'Away')} - ${esc(home?.abbrev || 'Home')}`;
    const body = groups
      .map(
        (g) => `<h3 class="nss-period">${esc(periodHeading(g.period))}</h3>
        <table class="nss-table nss-plays">
          <thead><tr><th class="nss-time">Time</th><th class="nss-team"></th><th class="nss-play">Play</th><th>${scoreHead}</th></tr></thead>
          <tbody>${g.plays
            .map((p) => {
              const team = teams.get(p.teamId);
              return `<tr class="${p.scoring ? 'nss-scoring' : ''}">
                <td class="nss-time">${esc(p.clock)}</td>
                <td class="nss-team">${team ? logo(team, 20) : ''}</td>
                <td class="nss-play">${esc(p.text)}</td>
                <td>${esc(p.away ?? '')} - ${esc(p.home ?? '')}</td>
              </tr>`;
            })
            .join('')}</tbody>
        </table>`,
      )
      .join('');
    return card(limit ? 'Last plays' : 'Play-by-play', body);
  }

  // ---- Team stats ------------------------------------------------------------------

  function renderTeamStats(snapshot) {
    const [away, home] = orderedTeams(snapshot);
    const stats = (team) => (snapshot.teamStats || []).find((t) => t.teamId === team?.id)?.stats || [];
    const awayStats = stats(away);
    const homeStats = stats(home);
    if (!awayStats.length) return card('Team stats', '<p class="nss-note">ESPN hasn’t posted team stats yet.</p>');
    const homeByName = new Map(homeStats.map((s) => [s.name, s]));
    const rows = awayStats
      .map((s) => `<tr><td class="nss-name">${esc(s.label)}</td><td>${esc(s.value)}</td><td>${esc(homeByName.get(s.name)?.value ?? '')}</td></tr>`)
      .join('');
    return card(
      'Team stats',
      `<table class="nss-table"><thead><tr><th class="nss-name"></th><th>${esc(away.abbrev)}</th><th>${esc(home.abbrev)}</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }

  // ---- Scoreboard card ------------------------------------------------------------

  // Links to the synced game's own pages (which show synced stats too).
  function gameLinks(gameId) {
    return [
      ['game', 'Gamecast'],
      ['boxscore', 'Box Score'],
      ['playbyplay', 'Play-by-Play'],
    ]
      .map(([page, label]) => `<a href="/nba/${page}/_/gameId/${esc(gameId)}">${label}</a>`)
      .join('');
  }

  // Replaces the synced game's card on ESPN's scoreboard.
  function renderScoreCard(view, game) {
    const links = `<nav class="nss-sc__links">${gameLinks(game.id)}</nav>`;
    const snapshot = view?.status === 'ready' ? view.snapshot : null;
    const [away, home] = snapshot ? orderedTeams(snapshot) : [];
    if (!away || !home) {
      const note =
        view?.status === 'loading'
          ? 'Getting ready. The score appears once it matches your stream.'
          : view?.status === 'unsynced'
            ? 'Sync to your stream in the extension to see this game.'
            : 'Hidden by Spoiler Sync.';
      return `<div class="nss-sc nss-sc--message">
        <div class="nss-sc__note"><strong>${esc(game.shortName || `${game.away} @ ${game.home}`)}</strong><span>${esc(note)}</span></div>
        <div class="nss-sc__side">${links}<span class="nss-badge">Spoiler Sync</span></div>
      </div>`;
    }
    const row = (team) => `<div class="nss-sc__team">${logo(team, 24)}<span class="nss-sc__abbr">${esc(team.abbrev)}</span><span class="nss-sc__score">${esc(team.score ?? '')}</span></div>`;
    return `<div class="nss-sc">
      <div class="nss-sc__teams">${row(away)}${row(home)}</div>
      <div class="nss-sc__side">
        <div class="nss-sc__status">${statusLine(snapshot)}</div>
        ${links}
        <span class="nss-badge">Synced to your stream</span>
      </div>
    </div>`;
  }

  function card(title, body) {
    return `<section class="nss-card"><header class="nss-card__title"><span>${esc(title)}</span></header><div class="nss-card__body">${body}</div></section>`;
  }

  function renderBody(kind, view) {
    if (!view || view.status !== 'ready') {
      return card('Hidden by Spoiler Sync', '<p class="nss-note">This game’s stats stay hidden until they can be matched to your stream.</p>');
    }
    const { snapshot, plays } = view;
    switch (kind) {
      case 'boxscore':
        return renderBox(snapshot);
      case 'playbyplay':
        return renderPlays(snapshot, plays);
      case 'gamecast':
        return renderPlays(snapshot, plays, 8) + renderBox(snapshot);
      case 'matchup':
        return renderTeamStats(snapshot);
      default:
        return card('Hidden by Spoiler Sync', '<p class="nss-note">This page is hidden while Spoiler Sync is on. The Gamecast, Box Score, Play-by-Play and Team Stats tabs show synced stats.</p>');
    }
  }

  globalThis.NSSView = { nbaGameIdFromUrl, pageKind, renderStrip, renderBody, renderBox, renderPlays, renderTeamStats, renderScoreCard, esc };
})();
