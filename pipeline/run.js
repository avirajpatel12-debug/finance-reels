// Makes reels and publishes them. For now: the market story reel.
//   DRY_RUN=1 node pipeline/run.js   no voice, no AI, no cost, nothing published: tests the whole chain
//   FORCE=1 node pipeline/run.js     make the reel again even if the same one is already on the site
import fs from 'node:fs';
import path from 'node:path';
import { loadTables, ROOT } from './data.js';
import { prepare, buildMarketReel, finalCheck } from './market.js';
import { callsMade } from './gemini.js';
import { addVoice } from './voice.js';
import { renderReel } from './render.js';
import { hosting, liveManifest, publish } from './publish.js';

async function main() {
  const dry = process.env.DRY_RUN === '1';
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const outDir = path.join(ROOT, 'out');

  const { source, tables } = await loadTables(['indices', 'macro', 'sectors', 'earnings', 'feed', 'market-caps']);
  log(`Data from: ${source}${dry ? ' (dry run: no voice, no AI calls, $0)' : ''}`);

  const prep = prepare(tables);
  if (!prep) {
    log('WARNING: no fresh S&P 500 quote, so no market reel was made.');
    return;
  }

  // Never make the same reel twice: if a reel made from exactly this data is already on the site, stop before any work.
  const willPublish = hosting && !dry && source === 'cloud';
  const live = willPublish ? await liveManifest() : null;
  if (willPublish && !process.env.FORCE && live.reels.some((r) => r.id === prep.id && r.hash === prep.hash)) {
    log('A reel made from this exact data is already on the site, so nothing was researched, written, made or uploaded.');
    return;
  }

  const reel = await buildMarketReel(prep, { dry });
  log(`Script: ${reel.how}. ${reel.scenes.length} scenes, ${callsMade()} AI call(s) this run.`);
  for (const s of reel.scenes) log(`  [${s.beat}] ${s.narration}`);

  // Final accuracy gate, whatever wrote the script: every number must be on the fact sheet.
  const problems = finalCheck(reel);
  if (problems.length) {
    log('STOPPED: the script contains numbers that are not in the data:');
    for (const p of problems) log('  ' + p);
    process.exitCode = 1;
      return;
  }
  log(`Accuracy check passed: every number is on the fact sheet (${reel.facts.length} facts).`);

  const outFile = path.join(outDir, `${reel.id}${dry ? '.dry' : ''}.mp4`); // a dry run never overwrites a real reel
  const voice = await addVoice(reel.scenes, { dry, wavFile: path.join(ROOT, '.cache', `${reel.id}.wav`) });
  reel.audioFile = voice.audioFile;
  log(`Voice: ${voice.voice}, ${voice.made} new sentences generated (the rest came from the cache). Caption timing: ${dry ? 'estimated (dry run)' : voice.measured ? 'measured from the audio' : 'ESTIMATED (listener unavailable)'}.`);
  if (voice.unclear.length) log(`Check pronunciation, these words did not sound like the script: ${[...new Set(voice.unclear)].join(', ')}`);
  const started = Date.now();
  const { frames, seconds } = await renderReel(reel, outFile);
  fs.writeFileSync(outFile.replace(/\.mp4$/, '.json'), JSON.stringify({ ...reel, audioFile: undefined }, null, 2));
  log(`Rendered ${path.relative(ROOT, outFile)}: ${seconds.toFixed(1)}s, ${frames} frames, ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB, took ${((Date.now() - started) / 1000).toFixed(0)}s.`);

  if (willPublish) {
    const result = await publish([{ reel, hash: prep.hash, video: outFile, poster: outFile.replace(/\.mp4$/, '.jpg') }], live);
    log(`Published: ${result.added} new reel, ${result.kept} earlier reels kept, ${result.total} on the site now.${result.dropped ? ` WARNING: ${result.dropped} earlier reels could not be fetched back and were dropped.` : ''}`);
  } else if (!dry) {
    log(source === 'cloud' ? 'Not published: hosting is not set up on this machine.' : 'Not published: sample data is never put on the site.');
  }
}

// One clear line on failure (the voice library would otherwise print pages of its own code).
try {
  await main();
} catch (err) {
  console.log(new Date().toISOString(), `FAILED: ${String(err?.message || err).split('\n')[0]}`);
  process.exitCode = 1;
}
