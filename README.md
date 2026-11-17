# Finance Reels

Turns daily market data into short narrated vertical videos (1080x1920, 30 to 60 seconds), meant to be watched as a
swipeable feed on a phone.

This project holds **code only**. The market data it reads lives in a private cloud store, the keys live in GitHub
secrets, and finished videos go to a private host. None of those are in this project.

## What it makes today

- **The market story** (after the open and after the close). Not a list of numbers: it tells what happened, why
  (from today's headlines, with links to the articles), why it matters (is it unusual compared with the past ten
  years?), what it means for other companies and markets, and what to watch next. Index moves sit in the ticker strip.

More reel types (one per big earnings report, top stories, sector heatmap) are on the way.

## How a reel is made

1. `pipeline/data.js` reads the latest numbers and briefing stories (read only).
2. `pipeline/facts.js` builds a fact sheet: every number the reel may use, with its source and date, plus "is this
   unusual?" facts worked out from stored history (for example: higher than on 99% of days since 2016).
3. `pipeline/headlines.js` reads today's headlines from public newsroom feeds (WSJ, MarketWatch, CNBC).
4. `pipeline/market.js` asks Google's free Gemini model for the reasons those headlines give, then for a script that
   may only use the fact sheet, the reasons and the briefing stories. If the free model is busy or the script fails
   the checks, a plain script is built from the data alone, so a reel is always made and nothing is invented.
5. `pipeline/verify.js` is the accuracy gate: any number that is not on the fact sheet (even spelled out as a word)
   stops the script.
6. `pipeline/voice.js` narrates with Kokoro, a free open-source voice that runs inside the job, and
   `pipeline/align.js` listens back (Whisper, also free and local) to time each caption word.
7. `pipeline/render.js` draws every frame from `templates/reel.html` in headless Chrome and ffmpeg makes the MP4.
8. `pipeline/publish.js` puts the reel on the site next to the earlier ones. A reel made from exactly the same data
   as one already on the site is not made again, and no AI call is made for it.

## The site

- `app/` is the page you open on the phone. It can be added to the iPhone Home Screen from Safari.
- There is no password. Everything lives inside a folder with a long random name, so only the exact link opens it.
  The front page of the site just says "Nothing here", and pages tell search engines not to list them.
- The link is kept in the private keys file (`SITE_KEY`) and in this project's GitHub secrets, never in the code.
- `setup/hosting.mjs` is the one-time setup, and `setup/link.mjs` makes a QR code of the link for the phone.

## Cost

$0. The only AI service is Google's free Gemini tier; no paid model is ever called, and if the free allowance runs
out the reel falls back to a plain script. The voice and the caption timing run on the machine that makes the reel.
On the free tier Google may use what is sent to improve its models; only public market numbers and headlines are sent.

## Try it

```bash
npm install
npm run dry      # sample data, no voice: tests the whole chain in under a minute
npm run sample   # sample data with the real narrator voice (downloads two free models the first time)
```

The video lands in `out/`. On GitHub, the same thing runs from the Actions tab: "Make reels", then pick a mode.

`fixtures/sample.json` is one day of public market numbers so the tests work without any keys.
