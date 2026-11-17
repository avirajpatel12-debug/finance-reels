// Makes reels. For now: the index scoreboard only (milestone 2).
//   DRY_RUN=1 node pipeline/run.js   no voice, no AI, no cost: tests the whole chain
import fs from 'node:fs';
import path from 'node:path';
import { loadTables, ROOT } from './data.js';
import { buildScoreboard } from './scoreboard.js';
import { verifyScript, numbersIn } from './verify.js';
import { addVoice } from './voice.js';
import { renderReel } from './render.js';

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

const outFile = path.join(outDir, `${reel.id}.mp4`);
const voice = await addVoice(reel.scenes, { dry, wavFile: path.join(ROOT, '.cache', `${reel.id}.wav`) });
reel.audioFile = voice.audioFile;
log(`Voice: ${voice.voice}, ${voice.made} new sentences generated (the rest came from the cache).`);
const started = Date.now();
const { frames, seconds } = await renderReel(reel, outFile);
fs.writeFileSync(outFile.replace(/\.mp4$/, '.json'), JSON.stringify({ ...reel, audioFile: undefined, scenes: reel.scenes.map(({ words, ...s }) => s) }, null, 2));
log(`Rendered ${path.relative(ROOT, outFile)}: ${seconds.toFixed(1)}s, ${frames} frames, ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB, took ${((Date.now() - started) / 1000).toFixed(0)}s.`);
