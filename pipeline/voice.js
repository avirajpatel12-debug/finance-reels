// Narration audio and word timings (the timings drive the captions).
// DRY_RUN: no voice at all, just estimated timings and a silent track, so the whole chain can be tested for free.
const CHARS_PER_SEC = 17; // calm narrator pace, about 160 words a minute

export function estimateTimings(narration) {
  const words = [];
  let t = 0.25; // small lead-in
  for (const w of narration.split(/\s+/).filter(Boolean)) {
    const dur = Math.max(0.16, (w.replace(/[^A-Za-z0-9%]/g, '').length + 1) / CHARS_PER_SEC);
    words.push({ w, start: t, end: t + dur });
    t += dur + (/[.!?]$/.test(w) ? 0.35 : /[,;:]$/.test(w) ? 0.15 : 0);
  }
  return { words, duration: Math.max(3.5, t + 0.4) };
}

export async function addVoice(scenes, { dry }) {
  if (!dry) throw new Error('Real voice is not built yet (next step of milestone 2). Run with DRY_RUN=1.');
  for (const s of scenes) Object.assign(s, estimateTimings(s.narration), { audio: null });
  return scenes;
}
