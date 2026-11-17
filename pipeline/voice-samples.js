// Makes the same short narration in several voices so Avi can pick one:  node pipeline/voice-samples.js
// Then set the winner with VOICE=<name> (it becomes the default in voice.js).
import fs from 'node:fs';
import path from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { ROOT } from './data.js';

const voices = (process.argv[2] || 'am_michael,af_heart,bm_george').split(',');
const text = 'Your market scoreboard for Monday, November 16. Stocks are sharply lower today. The S and P 500 is down 1.91 percent.';
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
fs.mkdirSync(path.join(ROOT, 'out', 'voices'), { recursive: true });
for (const voice of voices) {
  const audio = await tts.generate(text, { voice, speed: Number(process.env.VOICE_SPEED || 1.2) });
  await audio.save(path.join(ROOT, 'out', 'voices', `${voice}.wav`));
  console.log('made', voice);
}
