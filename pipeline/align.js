// Caption timing. The narration clip is played back to a speech recognizer (Whisper), which reports when it heard
// each word. Those heard words are lined up, letter by letter, with the script we wrote, so every caption word
// lights up when the voice actually says it. The words on screen always come from the script, never from Whisper.
import { listener } from './models.js';

const VOICE_RATE = 24000;
const LISTEN_RATE = 16000;

function resample(samples) {
  const n = Math.floor((samples.length * LISTEN_RATE) / VOICE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * VOICE_RATE) / LISTEN_RATE;
    const a = Math.floor(x);
    out[i] = samples[a] * (1 - (x - a)) + (samples[Math.min(a + 1, samples.length - 1)] || 0) * (x - a);
  }
  return out;
}

// Letters and digits only, with symbols spelled the way they are heard, so "S&P" lines up with "S and P".
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const letters = (w) =>
  w
    .toLowerCase()
    .replace(/%/g, 'percent')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/, (x) => String(SMALL.indexOf(x))); // "Two" heard for "2" is a match

export async function heardWords(samples) {
  const out = await (await listener())(resample(samples), { return_timestamps: 'word' });
  return (out.chunks || [])
    .filter((c) => c.timestamp && c.timestamp[0] != null && letters(c.text))
    .map((c) => ({ w: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.25 }));
}

// Returns the start time of each script word inside the clip, plus the words that did not sound like the script.
export function alignWords(scriptWords, heard, [from, to]) {
  const a = []; // script letters, each tagged with its word
  scriptWords.forEach((w, i) => {
    for (const c of letters(w)) a.push({ c, word: i });
  });
  const b = []; // heard letters, each with the moment it was heard
  for (const h of heard) {
    const cs = letters(h.w);
    [...cs].forEach((c, k) => b.push({ c, t: h.start + ((h.end - h.start) * k) / cs.length }));
  }
  // Classic edit-distance table, then walk back through it to pair up the letters.
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1].c === b[j - 1].c ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const starts = new Array(scriptWords.length).fill(null);
  const hits = new Array(scriptWords.length).fill(0);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = a[i - 1].c === b[j - 1].c;
    if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      if (same) {
        hits[a[i - 1].word]++;
        starts[a[i - 1].word] = b[j - 1].t; // walking backwards, so the last one written is the word's first letter
      }
      i--;
      j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  // A word counts as heard when at least half of its letters matched.
  const size = scriptWords.map((w) => Math.max(1, letters(w).length));
  const unclear = [];
  scriptWords.forEach((w, k) => {
    if (hits[k] / size[k] < 0.5) {
      starts[k] = null;
      unclear.push(w);
    }
  });
  // Fill the gaps: spread unheard words evenly (by length) between their heard neighbours.
  starts[0] = starts[0] == null ? from : Math.max(from - 0.03, starts[0]);
  for (let k = 1; k < starts.length; k++) {
    if (starts[k] != null) continue;
    let next = k;
    while (next < starts.length && starts[next] == null) next++;
    const t0 = starts[k - 1];
    const t1 = next < starts.length ? starts[next] : to;
    const span = size.slice(k - 1, next).reduce((x, y) => x + y, 0);
    let acc = size[k - 1];
    for (let q = k; q < next; q++) {
      starts[q] = t0 + ((t1 - t0) * acc) / span;
      acc += size[q];
    }
    k = next - 1;
  }
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + 0.04); // never out of order
  return { starts, unclear };
}
