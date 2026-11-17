// Makes reels and publishes them. For now: the index scoreboard only.
//   DRY_RUN=1 node pipeline/run.js   no voice, no AI, no cost, nothing published: tests the whole chain
//   FORCE=1 node pipeline/run.js     make the reel again even if the same one is already on the site
import fs from 'node:fs';
import path from 'node:path';
import { loadTables, ROOT } from './data.js';
import { buildScoreboard } from './scoreboard.js';
import { verifyScript, numbersIn } from './verify.js';
import { addVoice } from './voice.js';
import { renderReel } from './render.js';
import { hosting, liveManifest, publish, reelHash } from './publish.js';

const dry = process.env.DRY_RUN === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const outDir = path.join(ROOT, 'out');

const { source, tables } = await loadTables(['indices', 'macro', 'sectors']);
log(`Data from: ${source}${dry ? ' (dry run: no voice, no AI calls, $0)' : ''}`);

const reel = buildScoreboard(tables);
if (!reel) {
  log('WARNING: no fresh S&P 500 quote, so no scoreboard reel was made.');
  process.exit(0);
}

// Accuracy gate: every spoken number must be on the fact sheet.
const allowed = new Set(reel.facts.flatMap((f) => numbersIn(f.display)));
const problems = verifyScript(reel.scenes, allowed);
if (problems.length) {
  log('STOPPED: the script contains numbers that are not in the data:');
  for (const p of problems) log('  ' + p);
  process.exit(1);
}
log(`Accuracy check passed: ${reel.facts.length} facts, ${reel.scenes.length} scenes.`);

// Never make the same reel twice: if this exact reel is already on the site, stop here.
const willPublish = hosting && !dry && source === 'cloud';
const live = willPublish ? await liveManifest() : null;
const hash = reelHash(reel);
if (willPublish && !process.env.FORCE && live.reels.some((r) => r.id === reel.id && r.hash === hash)) {
  log('This reel is already on the site and nothing has changed, so nothing was made or uploaded.');
  process.exit(0);
}

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
  const result = await publish([{ reel, hash, video: outFile, poster: outFile.replace(/\.mp4$/, '.jpg') }], live);
  log(`Published: ${result.added} new reel, ${result.kept} earlier reels kept, ${result.total} on the site now.${result.dropped ? ` WARNING: ${result.dropped} earlier reels could not be fetched back and were dropped.` : ''}`);
} else if (!dry) {
  log(source === 'cloud' ? 'Not published: hosting is not set up on this machine.' : 'Not published: sample data is never put on the site.');
}
