// scoreboard card with ESPN's structure and class names (as of November 2026) and stand-in live values
// `state` is 'in' (last play) or 'post' (recap video instead, winner icon, Recap button)
// `periods` is the number of quarter columns
export function espnCardHtml({ id, away, home, state = 'in', periods = 4, live = '99' }) {
  const href = (t) => `/nba/team/_/name/${t.abbrev.toLowerCase()}/team`;
  const team = (t, side) => `
    <li class="ScoreboardScoreCell__Item flex items-center relative pb2">
      <a class="AnchorLink" href="${href(t)}"><img class="Image Logo ScoreboardScoreCell__Logo mr3 Logo__md" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"></a>
      <div class="ScoreCell__Team ScoreCell__Team--scoreboard">
        <div class="ScoreCell__Truncate--scoreboard"><a class="AnchorLink" href="${href(t)}"><div class="ScoreCell__TeamName ScoreCell__TeamName--shortDisplayName db">${t.shortName}</div></a></div>
        <div class="ScoreboardScoreCell__RecordContainer n9 clr-gray-04">(<span class="ScoreboardScoreCell__Record">${live}-${live}</span><span class="ScoreboardScoreCell__Record">${live}-${live}<span class="ScoreboardScoreCell__Record--homeAway ttc">${side === 'home' ? 'Home' : 'Away'}</span></span>)</div>
      </div>
      <div class="ScoreboardScoreCell_Linescores basketball flex justify-end">${Array.from({ length: periods }, () => `<div class="ScoreboardScoreCell__Value flex justify-center pl2 basketball">${live}</div>`).join('')}</div>
      <div class="ScoreCell__Score h4 clr-gray-01 fw-heavy tar">${live}</div>
      ${state === 'post' && side === 'home' ? '<svg class="ScoreboardScoreCell__WinnerIcon absolute icon__svg"></svg>' : ''}
    </li>`;
  const heading = (p) => (p <= 4 ? String(p) : p === 5 ? 'OT' : `${p - 4}OT`);
  const lastColumn =
    state === 'in'
      ? `<section class="LastPlay"><h1 class="h8 mb3">Last Play ${live}:${live} - ${live}th</h1><div class="flex items-center"><div class="headshot"><figure class="Image"><div class="Image__Wrapper"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"></div></figure></div><span class="n8 clr-gray-03"><span>LIVE last play</span></span></div></section>`
      : `<div class="Media relative Media--sm Media--video"><div class="Media__Meta"><div class="Media__Duration">1:${live}</div><div class="Media__Caption"><h2 class="Media__Caption__Title n6">${home.shortName} beat ${away.shortName} by ${live}</h2></div></div></div>`;
  const performer = (t) => `
    <div class="ContentList__Item"><a class="Athlete db Athlete__Link clr-gray-01" href="/nba/player/_/id/1/live-player">
      <div class="Athlete__PlayerHeadshotWrapper"><div class="headshot"><figure class="Image"><div class="Image__Wrapper"><img alt="L. Player" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"></div></figure></div>
      <div class="Athlete__PlayerWrapper"><h3 class="di flex items-baseline"><span class="Athlete__PlayerName">L. Player</span><span class="Athlete__NameDetails ml2 clr-gray-04">#${live} - ${t.abbrev}</span></h3>
        <div class="Athlete__Stats mt2"><div class="di"><span class="Athlete__Stats--value">${live}</span><span class="Athlete__Stats--label">PTS</span></div><div class="di"><span class="Athlete__Stats--value">${live}</span><span class="Athlete__Stats--label">REB</span></div><div class="di"><span class="Athlete__Stats--value">${live}</span><span class="Athlete__Stats--label">AST</span></div></div>
      </div></div></a></div>`;
  return `
<section class="Scoreboard bg-clr-white flex flex-auto justify-between" id="${id}">
  <div class="Scoreboard__RowContainer flex flex-column flex-auto"><div class="Scoreboard__Row flex w-100 Scoreboard__Row__Main">
    <div class="Scoreboard__Column Scoreboard__Column--1 Scoreboard__Column--Score"><section class="column-content"><div>
      <div class="ScoreboardScoreCell pa4 nba basketball ScoreboardScoreCell--${state}">
        <div class="ScoreboardScoreCell__Overview flex pb3 w-100">
          <div class="ScoreCell__Time ScoreboardScoreCell__Time ${state === 'in' ? 'ScoreCell__Time--default clr-negative' : 'h9 clr-gray-01'}">${state === 'in' ? `${live}:${live} - ${live}th` : 'Final'}</div>
          <div class="ScoreboardScoreCell__Headings flex justify-end">${Array.from({ length: periods }, (_, i) => `<div class="ScoreboardScoreCell__Heading flex justify-center pl2 h9">${heading(i + 1)}</div>`).join('')}<div class="ScoreboardScoreCell__Heading ScoreboardScoreCell__Heading--total h9 flex justify-end">T</div></div>
        </div>
        <ul class="ScoreboardScoreCell__Competitors">${team(away, 'away')}${team(home, 'home')}</ul>
      </div>
    </div></section></div>
    <div class="Scoreboard__Column ph3 mv4 Scoreboard__Column--2"><section class="column-content">${lastColumn}</section></div>
    <div class="Scoreboard__Column ph3 mv4 Scoreboard__Column--3"><section class="column-content"><h4 class="clr-gray-04 n8 fw-normal ttu mb3">Top Performers</h4>
      <div class="Scoreboard__Performers"><div class="ContentList ContentList--NoBorder">${performer(away)}${performer(home)}</div></div></section></div>
  </div></div>
  <div class="Scoreboard__Callouts flex items-center mv4 flex-column">
    <a class="AnchorLink Button" href="/nba/game/_/gameId/${id}">Gamecast</a>
    <a class="AnchorLink Button" href="/nba/boxscore/_/gameId/${id}">Box Score</a>
    ${state === 'post' ? `<a class="AnchorLink Button" href="/nba/recap/_/gameId/${id}">Recap</a>` : ''}
    <a class="AnchorLink Button" href="/nba/video/_/gameId/${id}">Highlights</a>
  </div>
</section>`;
}
