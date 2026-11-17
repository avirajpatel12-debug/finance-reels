// The two free AI models that run inside the job itself (no API, no account, no cost):
//   Kokoro  = the narrator voice
//   Whisper = listens back to the narration to find exactly when each word is spoken (for the captions)
// Both are downloaded once into .cache/models and reused after that.
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { ROOT } from './data.js';

env.cacheDir = path.join(ROOT, '.cache', 'models');

let ttsPromise;
export function narrator() {
  ttsPromise ??= import('kokoro-js').then(({ KokoroTTS }) => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' }));
  return ttsPromise;
}

let asrPromise;
export function listener() {
  asrPromise ??= pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en_timestamped', { dtype: 'fp32' });
  return asrPromise;
}
