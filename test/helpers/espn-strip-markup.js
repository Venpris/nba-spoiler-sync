// Builds score strip markup shaped like ESPN's (structure as of November 2026; class names
// shortened) for two teams, with stand-in live values. `state` is 'in' (clock, timeouts,
// "Bonus") or 'post' (Final, winner arrow, loser in muted colors). `periods` sets how many
// quarter columns ESPN shows (5 = overtime).
export function espnStripHtml({ away, home, state = 'in', periods = 4, live = '99', note = '' }) {
  const winner = state === 'post' ? 'home' : null;
  const color = (side) => (winner && side !== winner ? 'muted' : 'normal');
  const href = (t) => `/nba/team/_/name/${t.abbrev.toLowerCase()}/team`;
  const record = (t, side) =>
    `<div class="record ${color(side)}"><span>${live}-${live}</span><span class="venue">, <!-- -->${live}-${live} ${side === 'home' ? 'Home' : 'Away'}</span></div>`;
  const half = (t, side) => `
    <div class="half ${side}">
      <div class="logo-wrap"><a class="logo" href="${href(t)}"><picture><img alt=""></picture></a>
        <div class="names"><div><div><div><a class="name ${color(side)}" href="${href(t)}"><span>${t.name}</span><span>${t.shortName}</span><span>${t.abbrev}</span></a></div></div>${record(t, side)}</div></div>
      </div>
      <div class="score-wrap">
        <div class="score ${color(side)}">${live}${side === winner ? '<div class="arrow"><svg data-icon="arrows-triangleRight"></svg></div>' : ''}</div>
        <div class="under">${record(t, side)}${
          state === 'in'
            ? '<div class="timeouts"><div><div class="used"></div><div class="used"></div><div class="left"></div><div class="left"></div><div class="left"></div></div></div><div class="bonus">Bonus</div>'
            : ''
        }</div>
      </div>
    </div>`;
  const heading = (p) => (p <= 4 ? String(p) : p === 5 ? 'OT' : `${p - 4}OT`);
  const linescoreRow = (t) =>
    `<tr><td><div><div><a href="${href(t)}">${t.shortName}</a></div><div>${t.abbrev}</div></div></td>${Array.from({ length: periods }, () => `<td>${live}</td>`).join('')}<td>${live}</td></tr>`;
  const status =
    state === 'in'
      ? `<span class="clock">${live}:${live}</span><span class="dash">&nbsp;-&nbsp;</span><span class="clock">${live}th</span>`
      : '<span class="clock">Final</span><span class="clock"></span>';
  return `
<section aria-label="Game scoreboard" class="Gamestrip__StickyContainer"><div class="Gamestrip__Container"><div class="strip">
  ${note ? `<div class="note"><span>${note}</span></div>` : ''}
  <div class="row">
    <div class="gradient"></div><div class="gradient"></div>
    ${half(away, 'away')}
    <div class="center">
      <div class="center-inner">
        <div><div class="status">${status}</div></div>
        <div><table><thead><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${heading(i + 1)}</th>`).join('')}<th>T</th></tr></thead>
        <tbody>${linescoreRow(away)}${linescoreRow(home)}</tbody></table></div>
      </div>
      <div class="watch"><button><p>NBA League Pass</p></button></div>
    </div>
    ${half(home, 'home')}
  </div>
</div></div><div class="Gamestrip__WatchRow"></div><div id="BloomPortalId"></div></section>`;
}
