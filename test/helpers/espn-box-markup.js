// Builds box score markup shaped like ESPN's (structure and class names as of October
// 2026) from a summary-format game, with every stat set to a stand-in live value. Used to
// test rewriting ESPN's own box score without keeping any of ESPN's pages in the repo.
export function espnBoxHtml(summary, { live = '99', dnpIds = [] } = {}) {
  const block = (teamPlayers) => {
    const s = teamPlayers.statistics[0];
    const labels = s.labels;
    const rows = [
      ['header', 'starters'],
      ...s.athletes.filter((a) => a.starter).map((a) => ['player', a]),
      ['header', 'bench'],
      ...s.athletes.filter((a) => !a.starter).map((a) => ['player', a]),
      ['team'],
      ['percent'],
    ];
    const tr = (i, cells) => `<tr class="Table__TR Table__TR--sm Table__even" data-idx="${i}">${cells}</tr>`;
    const names = rows
      .map(([kind, a], i) => {
        if (kind === 'header') return tr(i, `<td class="Table__customHeader Table__TD"><div class="Table__customHeader">${a}</div></td>`);
        if (kind === 'team') return tr(i, '<td class="Table__TD"><div class="Table__customHeader">team</div></td>');
        if (kind === 'percent') return tr(i, '<td class="Table__TD"></td>');
        return tr(
          i,
          `<th class="Table__TD"><div class="flex"><a class="AnchorLink Boxscore__AthleteNameElement" href="/nba/player/_/id/${a.athlete.id}/player">` +
            `<span class="truncate db Boxscore__AthleteName Boxscore__AthleteName--long">${a.athlete.displayName}</span>` +
            `<span class="truncate db Boxscore__AthleteName Boxscore__AthleteName--short">${a.athlete.shortName}</span></a>` +
            `<span class="playerJersey">${a.athlete.jersey}</span></div></th>`,
        );
      })
      .join('');
    const statCell = (v) => `<td class="Table__TD BoxscoreItem__Stat Table__TD">${v}</td>`;
    const stats = rows
      .map(([kind, a], i) => {
        if (kind === 'header') return tr(i, labels.map((l) => `<td class="Table__customHeader Table__TD"><div class="Table__customHeader">${l}</div></td>`).join(''));
        if (kind === 'team') return tr(i, labels.map((l, j) => `<td class="Table__TD">${j === 0 || l === '+/-' ? '' : live}</td>`).join(''));
        if (kind === 'percent') return tr(i, labels.map((l) => `<td class="Table__TD">${['FG', '3PT', 'FT'].includes(l) ? `${live}%` : ''}</td>`).join(''));
        if (a.didNotPlay || dnpIds.includes(a.athlete.id)) {
          return tr(i, `<td class="tc td BoxscoreItem__DNP Table__TD" colspan="15">DNP-${a.reason || 'COACH\'S DECISION'}</td>`);
        }
        return tr(i, labels.map(() => statCell(live)).join(''));
      })
      .join('');
    return (
      '<div class="Wrapper"><div class="Boxscore flex flex-column">' +
      `<div class="BoxscoreItem__Title flex items-center pt3"><img class="Image Logo pr3 Logo__sm" alt=""><div class="BoxscoreItem__TeamName">${teamPlayers.team.displayName}</div></div>` +
      '<div class="ResponsiveTable ResponsiveTable--fixed-left Boxscore flex"><div class="flex">' +
      `<table class="Table Table--align-right Table--fixed Table--fixed-left"><tbody class="Table__TBODY">${names}</tbody></table>` +
      `<div class="Table__ScrollerWrapper relative overflow-hidden"><div class="Table__Scroller"><table class="Table Table--align-right"><tbody class="Table__TBODY">${stats}</tbody></table></div></div>` +
      '</div></div></div></div>'
    );
  };
  return (
    '<section class="Card Card__TableTopBorder"><div class="Wrapper Card__Content"><div class="ResponsiveWrapper">' +
    `<div class="Boxscore Boxscore__ResponsiveWrapper">${summary.boxscore.players.map(block).join('')}</div>` +
    '</div></div></section>'
  );
}
