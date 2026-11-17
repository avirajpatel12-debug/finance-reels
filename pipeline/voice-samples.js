// Makes the same short narration in several voices, to choose a narrator:  node pipeline/voice-samples.js
// Set the winner as the default VOICE in voice.js (or pass VOICE=<name> for one run).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.js';
import { narrator } from './models.js';

const voices = (process.argv[2] || 'am_michael,af_heart,bm_george').split(',');
const text = 'Your market scoreboard for Monday, November 16. Stocks are sharply lower today. The S and P 500 is down 1.91 percent.';
const tts = await narrator();
fs.mkdirSync(path.join(ROOT, 'out', 'voices'), { recursive: true });
for (const voice of voices) {
  const audio = await tts.generate(text, { voice, speed: Number(process.env.VOICE_SPEED || 1.2) });
  await audio.save(path.join(ROOT, 'out', 'voices', `${voice}.wav`));
  console.log('made', voice);
}
