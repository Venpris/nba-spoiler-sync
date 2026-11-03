# NBA Spoiler Sync

Chrome extension that keeps ESPN’s NBA box scores in sync with your delayed stream, so the stats never get ahead of what you’ve seen.

While it's on, ESPN's game pages (score, box score, play-by-play, team stats) show the game
as of the moment your stream is at, not ESPN's live feed. It doesn't touch your stream: it
records ESPN's game data, works out how far behind your stream is, and shows ESPN's data
from that far back.

## Install

No build step is needed.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Pin the extension (puzzle-piece icon in the toolbar) so its basketball icon is easy to reach.

After editing the code, click the reload arrow on the extension's card in `chrome://extensions`.

## Use

1. Start your stream. Click the extension icon.
2. Pick the game and flip the switch on. Any open ESPN tabs reload; from then on the
   game's pages stay blank until they're safe to show.
3. Sync: choose the quarter, type a clock time you're **about** to see (say `7:30` when your
   stream shows 7:34), then press **Sync** or Enter the moment your stream's clock hits it.
   This is most accurate while the clock is running.
4. The status says **Getting ready** with a countdown. The recording has to reach your point
   in the game, so the wait is about as long as your stream's delay.
5. When it says **Ready**, open the game on ESPN with the links in the popup or on ESPN's
   scoreboard (Gamecast, Box Score, Play-by-Play; Team Stats is a tab there). The score strip
   and stats match your stream, a few seconds behind.

If you pause, rewind, or your stream buffers, sync again. A stream that falls further
behind than it was when you synced is the one way ESPN could get ahead of you.

The **Safety margin** (default 10s) is how far behind your stream the stats are kept on
purpose. In testing on real ESPN timing data, the sync was never more than 4s ahead of the
true moment, so 10s leaves room. Raise it if you'd rather be extra safe.

## What changes on ESPN while it's on

- **ESPN's score strip** on the game's pages stays ESPN's own, with the synced score,
  clock, quarter scores and team records. Timeouts left and "Bonus" are hidden, and on a
  finished game ESPN's winner arrow and muted loser colors are undone.
- **The Box Score page** keeps ESPN's own box score, with every number swapped for the
  synced one.
- **The Gamecast page** keeps ESPN's Last Plays, Game Leaders, Team Stats and Game
  Information, synced. Its other widgets (win probability and game flow charts, players on
  the court, highlights, odds, standings, news) are hidden, since they'd show the live game.
- **The Play-by-Play page** keeps ESPN's play list with every synced play, newest first,
  and its Game Information. The shot chart (it plots every shot so far) and each play's
  live win probability are hidden.
- **The Team Stats page** keeps ESPN's team stats table, Game Leaders, Team Stats summary and
  Game Information, synced. Other pages for the game, like the recap, are hidden.
- If ESPN's strip or box score can't be matched (say, after a redesign), a synced
  look-alike is shown instead.
- **The scores ticker** across the top of ESPN is hidden on every page.
- **The NBA scoreboard page**: this game's card stays ESPN's own, with the synced score,
  clock, quarter scores, records, last play and top performers. A finished game's recap
  video and winner mark never show. Until you've synced, the card just has links to the
  game's pages. Other games are untouched.
- **The tab title** for the game's pages is replaced, so the tab strip can't give anything away.

Turning it off reloads ESPN tabs back to normal. Closing the browser turns it off.

## How it works

- **Recording.** Every 5 seconds the extension fetches ESPN's game feed
  (`site.api.espn.com`, the same data ESPN's site uses) and keeps a timestamped copy of
  the score, box score, team stats and play-by-play. Everything else in the feed (win
  probability, news, team records, odds) is thrown away on arrival.
- **Syncing.** Every play in ESPN's feed has the real time it was logged. When you sync, the
  extension finds the play just before the clock you entered, assumes the clock ran
  without stopping from there (the earliest it could have reached your time), and from
  that works out your stream's delay. Plays at exactly your clock count as not yet seen.
- **Showing.** ESPN tabs get the newest copy recorded at least *delay + safety margin*
  ago, and the plays that existed when it was recorded, nothing newer. Because it's a
  fixed delay in real time, timeouts, free throws and halftime line up on their own.

## Limitations

- **The wait is as long as your delay.** Recording starts when you turn the extension on,
  so if you start a game from tip-off while it's live in the 3rd quarter, there's nothing
  recorded from back then. It would show a long countdown. (Rebuilding stats from
  play-by-play could cover this later.)
- **Only the game's pages, the ticker and the scoreboard are covered.** ESPN's homepage
  headlines, news stories, team pages and notifications can still mention results.
- **ESPN's feed is undocumented** and could change. The page layout the shield relies on
  was checked against ESPN's markup as of mid-2026; if ESPN redesigns, the game's pages
  fall back to showing only the synced panel rather than leaking.
- **Not yet tried on a live ESPN page.** The ESPN-page code is tested against ESPN's page
  structure and the background against a replayed game, but not in a real browser.

## Development

```bash
npm install      # test-only dependencies: jsdom and fake-indexeddb
npm test
npm run icons    # redraw icons/*.png
npm run fixtures # rebuild test/fixtures/game.json
```

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `src/background.js` | Service worker: recording, sync, feeding ESPN tabs |
| `src/lib/` | ESPN feed client, sync math, timeline helpers, IndexedDB storage |
| `src/popup/` | The toolbar popup |
| `src/content/shield.js`, `shield.css` | Runs on ESPN pages: hides, then shows the synced panel |
| `src/content/view.js` | Builds the panel's HTML |
| `src/content/espn-box.js` | Rewrites a copy of ESPN's own box score with synced numbers |
| `src/content/espn-strip.js` | Rewrites a copy of ESPN's own score strip the same way |
| `src/content/espn-card.js` | Rewrites a copy of the game's card on ESPN's scoreboard |
| `src/content/espn-gamecast.js` | Rewrites copies of the Gamecast, Play-by-Play and Team Stats widgets |
| `src/content/espn-copy.js` | Shared by the two: copying, writing, clearing anything unmatched |
| `src/content/nav-hook.js` | Tells the shield when ESPN changes pages without reloading |
| `scripts/make-test-game.mjs` | Generates the made-up test game |
| `test/` | `node --test` suites |
| `test/helpers/` | Build ESPN-shaped markup (box score, score strip, scoreboard card, Gamecast, Play-by-Play) for tests |
| `test/fixtures/timing.json` | Real play timing from a January 2026 game (no names or text) |
| `test/fixtures/game.json` | A made-up game in ESPN's feed format, built on that timing |

## License

[MIT](LICENSE)
