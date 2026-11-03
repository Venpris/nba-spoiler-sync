// Builds Gamecast widgets shaped like ESPN's (structure as of November 2026; class names
// mostly dropped) with stand-in live values: Last Plays, Game Leaders, Team Stats, Game
// Information, plus widgets the extension must keep hidden (win probability, odds, news).
const href = (t) => `/nba/team/_/name/${t.abbrev.toLowerCase()}/team`;
const picture = () => '<picture data-testid="prism-picture"><source srcset="live.png"><img alt=""></picture>';

export function lastPlaysHtml({ live = '99', cards = 5 } = {}) {
  const card = (style) => `
    <div style="${style}">
      <div>${picture()}</div>
      <div style="background-color:transparent;background-image:radial-gradient(circle at 2px, #123456 2px, rgba(255, 255, 255, 0) 2px);top:6px"></div>
      <span>LIVE type</span>
      <div><span>${live}:${live} - ${live}th</span><div><span>Win %: XYZ, <span>${live}.${live}</span></span></div></div>
      <p>LIVE play text</p>
      <div><span>${live}</span><span>${live}</span></div>
    </div>`;
  return `
<section class="Card LastPlays__Basketball LastPlays__Basketball--v4">
  <div data-testid="rive-animation-wrapper" style="position:relative"><canvas></canvas></div>
  <div><div>LIVE</div></div>
  <div><div data-testid="PlayColumn">
    <div>${picture()}</div>
    <div>${card('position:absolute;top:-999px')}${Array.from({ length: cards }, () => card('margin-top:0px')).join('')}</div>
  </div></div>
  <footer><a href="/nba/playbyplay/_/gameId/1">Full Play-By-Play</a></footer>
</section>`;
}

export function leadersHtml({ away, home, live = '99' }) {
  const leader = (t, detail) => `
    <a href="/nba/player/_/id/1/live-player"><div><div>${picture()}<div><span>${live}</span></div></div>
      <div><div><div><span>L. Player</span><span>#${live}</span></div><div>${detail}</div></div><div><span>${live}</span></div></div></div></a>`;
  const section = (name, detail) => `
    <section><div data-testid="prism-VisuallyHidden"><span>${name}</span></div>${leader(away, detail)}<header><span>${name}</span><span></span></header>${leader(home, detail)}</section>`;
  return `
<div style="--team-away-color:#123456">
  <section data-testid="prism-LayoutCard"><h2>Game Leaders</h2>
    <div>
      <div><a href="${href(away)}">${picture()}<span>${away.abbrev}</span></a><a href="${href(home)}">${picture()}<span>${home.abbrev}</span></a></div>
      <div>
        ${section('Points', `${live}/${live} FG, ${live}/${live} FT`)}
        ${section('Rebounds', `${live} DREB, ${live} OREB`)}
        ${section('Assists', `${live} TO, ${live} MIN`)}
      </div>
    </div>
    <footer><a href="/nba/boxscore/_/gameId/1">Full Box Score</a></footer>
  </section>
</div>`;
}

export function teamStatsHtml({ away, home, live = '99' }) {
  const bars = (n) =>
    Array.from({ length: n }, () => '<div data-testid="prism-ProgressBar"><div style="width:0%;background:#123456"></div><div style="width:0%"></div></div>').join('');
  const row = (label, shooting) => `
    <div>
      <div>
        <p><span>${live}${shooting ? '%' : ''}</span>${shooting ? `<span>(${live}-${live})</span>` : ''}</p>
        <p>${label}</p>
        <p><span>${live}${shooting ? '%' : ''}</span>${shooting ? `<span>(${live}-${live})</span>` : ''}</p>
      </div>
      <div>${bars(shooting ? 2 : 1)}</div>
    </div>`;
  return `
<div data-testid="TeamStats"><section data-testid="prism-LayoutCard"><h2>Team Stats</h2>
  <div><a href="${href(away)}"><img data-testid="prism-image"><div>${away.abbrev}<span></span></div></a><a href="${href(home)}"><img data-testid="prism-image"><div>${home.abbrev}<span></span></div></a></div>
  ${row('Field Goal %', true)}${row('Three Point %', true)}${row('Free Throw %', true)}
  ${row('Turnovers')}${row('Rebounds')}${row('Percent Led')}${row('Largest Lead')}
  <footer><a href="/nba/matchup/_/gameId/1">Full Team Stats</a></footer>
</section></div>`;
}

export function gameInfoHtml() {
  return `
<section data-testid="prism-LayoutCard"><h2>Game Information</h2>
  <div><span>7:30 PM, November 2, 2026</span><span>Mesa, AZ</span><span>Coverage: NBA League Pass</span></div>
  <div><span>Attendance:</span><span>19,812</span></div>
  <div><span>Referees:</span><span>A. Official</span></div>
</section>`;
}

// The Play-by-Play page's main widget: tabs, shot chart filters, shot chart and the play
// list (newest first; scoring plays show the score, the scoring team's in bold), ending in
// ESPN's load-more placeholder.
export function playByPlayHtml({ live = '99' } = {}) {
  const item = (scoring) => `
    <div style="margin-top:0px">
      <section data-testid="prism-Accordion">
        <button><div>
          <div>${picture()}</div>
          <div style="${scoring ? 'background-color:#123456;background-image:none' : 'background-image:radial-gradient(circle at 2px, #123456 2px, rgba(255, 255, 255, 0) 2px)'};top:39px"></div>
          <span>LIVE type</span><span>${live}:${live} - ${live}th</span>
          <div><p>LIVE play text</p></div>
          ${scoring ? `<div><span class="Bold">${live}</span><span>${live}</span></div>` : ''}
        </div></button>
        <div role="region" style="height:0px"><div data-testid="prism-AccordionDetails"><span>Win %: XYZ, <span>${live}.${live}</span></span></div></div>
      </section>
      <div role="button"><svg></svg></div>
      <div><span>Win %: XYZ, <span>${live}.${live}</span></span></div>
    </div>`;
  return `
<div>
  <div data-testid="prism-tab-list">
    <div role="tablist"><button role="tab" aria-selected="true"><span>All Plays</span></button><button role="tab" aria-selected="false"><span>Key Plays</span></button></div>
    <div role="tabpanel">
      <div class="ShotChartFilterButtons" data-testid="ShotChartFilterButtons"><button><span>All Quarters</span></button></div>
      <section class="Card ShotChart"><header><h3>Shot Chart</h3></header><div data-testid="ShotChart"><ul><li><span>LIVE shot ${live}-foot jumper</span></li></ul></div></section>
      <section data-testid="PlayByPlay" class="Card"><header class="Card__Header"><h3>PLAYS</h3></header>
        <div class="Card__Content"><div data-testid="PlayColumn"><div>${picture()}</div><div>
          <div style="position:absolute;top:-200px">${item(false).replace(/^\s*<div[^>]*>/, '').replace(/<\/div>\s*$/, '')}</div>
          ${item(true)}${item(false)}${item(true)}${item(false)}
          <div></div>
        </div></div></div>
      </section>
    </div>
  </div>
</div>`;
}

// The Team Stats page's main table (structure as of November 2026): a row per stat with
// the away team's value, then the home team's.
export const MATCHUP_ROWS = [
  'FG', 'Field Goal %', '3PT', 'Three Point %', 'FT', 'Free Throw %', 'Rebounds', 'Offensive Rebounds',
  'Defensive Rebounds', 'Assists', 'Steals', 'Blocks', 'Total Turnovers', 'Points Conceded Off Turnovers',
  'Fast Break Points', 'Points in Paint', 'Fouls', 'Technical Fouls', 'Flagrant Fouls', 'Largest Lead', 'Percent Led',
];
export function matchupTableHtml({ live = '99' } = {}) {
  const rows = MATCHUP_ROWS.map((label) => `<tr class="Table__TR"><td class="Table__TD">${label}</td><td class="Table__TD">${live}</td><td class="Table__TD">${live}</td></tr>`).join('');
  return `
<section class="Card TeamStatsTable" data-testid="teamStatsTable">
  <header class="Card__Header"><h2 class="Card__Header__Title">Team Stats</h2></header>
  <div class="Card__Content"><table class="Table">
    <thead><tr><th><div class="ScreenReaderOnly">Statistics</div></th><th class="TeamStats__Logo"><img class="Logo" src="data:image/gif;base64,R0lGOD"></th><th class="TeamStats__Logo"><img class="Logo" src="data:image/gif;base64,R0lGOD"></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

// The three Gamecast columns, ready to drop into a game page skeleton.
export function gamecastColumnsHtml({ away, home, live = '99' }) {
  return `
<div class="PageLayout page-container cf PageLayout--desktopLg">
  <div class="PageLayout__LeftAside">
    <section data-testid="prism-LayoutCard"><h2>On the Court</h2><span>LIVE lineup ${live}</span></section>
    <div class="DataVizWrapper"><h2>Probabilities &amp; Game Flow</h2><span>LIVE win probability ${live}%</span></div>
    ${teamStatsHtml({ away, home, live })}
    ${gameInfoHtml()}
  </div>
  <div class="PageLayout__Main">
    <div class="GameBreak"></div>
    ${lastPlaysHtml({ live })}
    <div class="ResponsiveWrapper"><h2>Game Highlights</h2><span>LIVE ${home.shortName} win by ${live}</span></div>
    ${leadersHtml({ away, home, live })}
  </div>
  <div class="PageLayout__RightAside">
    <section data-testid="prism-Accordion"><span>LIVE odds ${live}</span></section>
    <div class="Standings"><h2>Standings</h2><span>LIVE ${live}-${live}</span></div>
  </div>
</div>`;
}
