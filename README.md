# Finance Reels

Turns daily market data into short narrated vertical videos (1080x1920, 30 to 60 seconds), meant to be watched as a
swipeable feed on a phone.

This project holds **code only**. The market data it reads lives in a private cloud store, the keys live in GitHub
secrets, and finished videos go to a private host. None of those are in this project.

## What it makes today

- **Index scoreboard reel**: stocks, the VIX and Treasury yields, oil, gold, the dollar and Bitcoin, and the sectors
  from best to worst. Built from the numbers with a fixed script, so it costs nothing and cannot make up a figure.

More reel types (earnings, top stories, sector heatmap) and the phone app are on the way.

## How a reel is made

1. `pipeline/data.js` reads the latest numbers (read only).
2. `pipeline/scoreboard.js` builds a fact sheet (every number with its source and date) and a script from it.
3. `pipeline/verify.js` is the accuracy gate: any spoken number that is not on the fact sheet stops the reel.
4. `pipeline/voice.js` narrates with Kokoro, a free open-source voice that runs inside the job.
5. `pipeline/align.js` listens back to the narration (Whisper, also free and local) to time each caption word.
6. `pipeline/render.js` draws every frame from `templates/reel.html` in headless Chrome and ffmpeg makes the MP4.
7. `pipeline/publish.js` puts the reel on the site (Cloudflare Pages) next to the earlier ones and updates the
   list the phone app reads. A reel that is already on the site and has not changed is not made again.

## The site

- `app/` is the page you open on the phone. It can be added to the iPhone Home Screen from Safari.
- There is no password. Everything lives inside a folder with a long random name, so only the exact link opens it.
  The front page of the site just says "Nothing here", and pages tell search engines not to list them.
- The link is kept in the private keys file (`SITE_KEY`) and in this project's GitHub secrets, never in the code.
- `setup/hosting.mjs` is the one-time setup, and `setup/link.mjs` makes a QR code of the link for the phone.

## Cost

$0. No paid API is called. The voice and the caption timing run on the machine that makes the reel.

## Try it

```bash
npm install
npm run dry      # sample data, no voice: tests the whole chain in under a minute
npm run sample   # sample data with the real narrator voice (downloads two free models the first time)
```

The video lands in `out/`. On GitHub, the same thing runs from the Actions tab: "Make reels", then pick a mode.

`fixtures/sample.json` is one day of public market numbers so the tests work without any keys.
