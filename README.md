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
5. When it says **Ready**, open the game on ESPN (Gamecast, Box Score, Play-by-Play or Team
   Stats). The score strip and stats there match your stream, a few seconds behind.

If you pause, rewind, or your stream buffers, sync again. A stream that falls further
behind than it was when you synced is the one way ESPN could get ahead of you.

The **Safety margin** (default 10s) is how far behind your stream the stats are kept on
purpose. In testing on real ESPN timing data, the sync was never more than 4s ahead of the
true moment, so 10s leaves room. Raise it if you'd rather be extra safe.

## What changes on ESPN while it's on

- **The game's pages** (Gamecast, Box Score, Play-by-Play, Team Stats): ESPN's score strip
  and everything below the tabs are replaced with the synced version. Other pages for the
  game, like the recap, are hidden.
- **The scores ticker** across the top of ESPN is hidden on every page.
- **The NBA scoreboard page**: this game's card is covered. Other games are untouched.
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
| `src/content/nav-hook.js` | Tells the shield when ESPN changes pages without reloading |
| `scripts/make-test-game.mjs` | Generates the made-up test game |
| `test/` | `node --test` suites |
| `test/fixtures/timing.json` | Real play timing from a January 2026 game (no names or text) |
| `test/fixtures/game.json` | A made-up game in ESPN's feed format, built on that timing |

## License

[MIT](LICENSE)
