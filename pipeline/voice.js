// Narration audio and word timings (the timings drive the captions).
// Real mode: Kokoro, a free open-source voice that runs right here (no API, no account, no cost), then Whisper
// listens back to find exactly when each word is spoken.
// DRY_RUN: no voice at all, just estimated timings and silence, so the whole chain can be tested instantly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.js';

const RATE = 24000; // Kokoro's sample rate
const CHARS_PER_SEC = 17;
const SENTENCE_GAP = 0.12; // seconds of quiet between sentences
const SCENE_TAIL = 0.3; // quiet at the end of each scene
export const VOICE = process.env.VOICE || 'am_michael'; // chosen from three samples, 16 Nov 2026
const SPEED = Number(process.env.VOICE_SPEED || 1.2); // a touch brisker than the default, like the reference reel
const cacheDir = path.join(ROOT, '.cache', 'voice');

export function estimateTimings(narration) {
  const words = [];
  let t = 0.25;
  for (const w of narration.split(/\s+/).filter(Boolean)) {
    const dur = Math.max(0.16, sayLength(w) / CHARS_PER_SEC);
    words.push({ w, start: t, end: t + dur });
    t += dur + (/[.!?]$/.test(w) ? 0.35 : /[,;:]$/.test(w) ? 0.15 : 0);
  }
  return { words, duration: Math.max(3.5, t + 0.4) };
}

// What the voice should say for each written word. The caption keeps the written form.
// Each respelling here was checked by having Whisper listen to the result.
const spoken = (w) =>
  w
    .replace(/S&P/g, 'S and P')
    .replace(/(\d)%/g, '$1 percent')
    .replace(/\b10-year/g, 'ten year')
    .replace(/\b2-year/g, 'two year')
    .replace(/\bVIX\b/g, 'Vix') // plain "AI" and "US" are already read correctly; respelling AI made it say "eye"
    .replace(/\bNasdaq\b/gi, 'Nazdack') // the plain spelling comes out sounding like "Nastec"
    .replace(/\bUTC\b/g, 'U T C');

// Rough "how long is this to say", counting digits and symbols as the words they become ("2.67%" is five words aloud).
const sayLength = (w) => {
  const s = spoken(w);
  return s.replace(/[^A-Za-z]/g, '').length + (s.match(/\d/g) || []).length * 4.5 + (/\d\.\d/.test(s) ? 5 : 0) + 1.5 + (/[,;:]$/.test(w) ? 2.5 : 0);
};

const keyFor = (text) => crypto.createHash('sha1').update(`${VOICE}|${SPEED}|${text}`).digest('hex');

// One sentence of speech as raw samples. Cached on disk so an unchanged sentence is never generated twice.
async function speak(text) {
  const file = path.join(cacheDir, `${keyFor(text)}.f32`);
  if (fs.existsSync(file)) {
    const b = fs.readFileSync(file);
    return { samples: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), cached: true };
  }
  const { narrator } = await import('./models.js');
  const audio = await (await narrator()).generate(text, { voice: VOICE, speed: SPEED });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(audio.audio.buffer, audio.audio.byteOffset, audio.audio.byteLength));
  return { samples: audio.audio, cached: false };
}

// Where the speech actually starts and stops inside a clip (skips the quiet lead-in and tail).
function voicedSpan(samples) {
  const loud = (i) => Math.abs(samples[i]) > 0.012;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  return [a / RATE, b / RATE];
}

// When each word of the sentence is spoken, measured by listening back (cached with the clip).
// If the listener cannot run, falls back to an estimate so a reel is still made.
async function wordStarts(text, ws, samples, span) {
  const file = path.join(cacheDir, `${keyFor(text)}.${crypto.createHash('sha1').update(ws.join(' ')).digest('hex').slice(0, 8)}.words.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let result;
  try {
    const { heardWords, alignWords } = await import('./align.js');
    result = { ...alignWords(ws, await heardWords(samples), span), measured: true };
  } catch (err) {
    console.warn(`WARNING: could not measure word timing (${String(err.message).slice(0, 120)}); captions use an estimate for this sentence.`);
    const weight = ws.map(sayLength);
    const total = weight.reduce((x, y) => x + y, 0);
    let at = span[0];
    result = { starts: ws.map((_, i) => { const s = at; at += ((span[1] - span[0]) * weight[i]) / total; return s; }), unclear: [], measured: false };
    return result; // not cached, so the next run tries to measure again
  }
  fs.writeFileSync(file, JSON.stringify(result));
  return result;
}

async function voiceScene(scene) {
  const sentences = scene.narration.split(/(?<=[.!?])\s+/).filter(Boolean);
  const pieces = [];
  const words = [];
  const unclear = [];
  let t = 0.15;
  let made = 0;
  let measured = true;
  for (const sentence of sentences) {
    const ws = sentence.split(/\s+/);
    const text = ws.map(spoken).join(' ');
    const { samples, cached } = await speak(text);
    if (!cached) made++;
    const span = voicedSpan(samples);
    const timing = await wordStarts(text, ws, samples, span);
    measured &&= timing.measured;
    unclear.push(...timing.unclear);
    ws.forEach((w, i) => words.push({ w, start: t + timing.starts[i], end: t + (timing.starts[i + 1] ?? span[1]) }));
    pieces.push({ at: t, samples });
    t += Math.min(samples.length / RATE, span[1] + 0.12) + SENTENCE_GAP; // drop the long quiet tail Kokoro leaves
  }
  const duration = Math.max(3.5, t - SENTENCE_GAP + SCENE_TAIL);
  const audio = new Float32Array(Math.ceil(duration * RATE));
  for (const p of pieces) audio.set(p.samples.subarray(0, audio.length - Math.round(p.at * RATE)), Math.round(p.at * RATE));
  return { words, duration, audio, made, unclear, measured };
}

function writeWav(file, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

// Adds words + duration to every scene. Returns the narration file for the whole reel (null in a dry run).
export async function addVoice(scenes, { dry, wavFile }) {
  if (dry) {
    for (const s of scenes) Object.assign(s, estimateTimings(s.narration));
    return { audioFile: null, made: 0, voice: 'none (dry run)', unclear: [], measured: false };
  }
  const clips = [];
  const unclear = [];
  let made = 0;
  let measured = true;
  for (const s of scenes) {
    const v = await voiceScene(s);
    s.words = v.words;
    s.duration = v.audio.length / RATE; // exact, so picture and sound stay in step
    clips.push(v.audio);
    made += v.made;
    measured &&= v.measured;
    unclear.push(...v.unclear);
  }
  const all = new Float32Array(clips.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of clips) {
    all.set(c, off);
    off += c.length;
  }
  fs.mkdirSync(path.dirname(wavFile), { recursive: true });
  writeWav(wavFile, all);
  return { audioFile: wavFile, made, voice: VOICE, unclear, measured };
}
