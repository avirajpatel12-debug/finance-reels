// Draws every frame of a reel in headless Chrome from templates/reel.html and pipes the frames into ffmpeg.
// Output: 1080x1920, 30 fps, H.264 + AAC MP4 that iPhone Safari can stream.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { ROOT } from './data.js';

const FPS = 30;

async function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return (await import('ffmpeg-static')).default; // local copy inside this project (no system install needed)
  } catch {
    return 'ffmpeg'; // GitHub's computers already have it
  }
}

// Uses the Chrome that is already installed (on the Mac and on GitHub's computers), so nothing extra is downloaded.
async function launchBrowser() {
  const args = process.env.CI ? ['--no-sandbox'] : [];
  const tries = [
    { channel: process.env.CHROME_CHANNEL || 'chrome', args },
    ...[process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].filter((p) => p && fs.existsSync(p)).map((executablePath) => ({ executablePath, args })),
  ];
  let lastError;
  for (const options of tries) {
    try {
      return await chromium.launch(options);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not start Chrome: ${String(lastError?.message).split('\n')[0]}`);
}

export async function renderReel(reel, outFile) {
  // Lay the scenes end to end on one timeline.
  let t = 0;
  for (const s of reel.scenes) {
    s.start = t;
    t += s.duration;
  }
  reel.duration = t;
  const frames = Math.round(reel.duration * FPS);

  // Audio: the narration clips in order, or silence in a dry run.
  const audioArgs = reel.audioFile
    ? ['-i', reel.audioFile, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100', '-ac', '2']
    : ['-f', 'lavfi', '-t', String(reel.duration), '-i', 'anullsrc=r=44100:cl=stereo'];
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const ff = spawn(await ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...audioArgs,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '128k', '-t', String(reel.duration), '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => (ffErr += d));
  const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${ffErr.slice(-400)}`)))));

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(ROOT, 'templates', 'reel.html')).href);
    await page.evaluate((r) => window.setup(r), reel);
    for (let f = 0; f < frames; f++) {
      await page.evaluate((time) => window.seek(time), f / FPS);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    // A still of each scene's midpoint, used as the poster image and for quick review.
    const posterAt = reel.scenes[0].start + reel.scenes[0].duration * 0.8;
    await page.evaluate((time) => window.seek(time), posterAt);
    await page.screenshot({ path: outFile.replace(/\.mp4$/, '.jpg'), type: 'jpeg', quality: 85 });
  } finally {
    await browser.close();
    ff.stdin.end();
  }
  await done;
  return { frames, seconds: reel.duration };
}
