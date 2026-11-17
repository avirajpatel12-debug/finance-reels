// Google's Gemini on the free tier: the AI that researches and writes the story reels.
// No paid model is ever called. If the free allowance runs out, the call fails and the reel falls back to a script
// built from the data alone (see market.js), so a quota problem can never cost money.
const KEY = process.env.GEMINI_API_KEY || '';
const AUTH = process.env.GEMINI_AUTH || 'header';
// Tried in order. Tested 17 Nov 2026 on the free key: the full Flash models are often "busy" at peak hours and the two
// newest hang, the 2.5 models are closed to new users, and the Lite models answer in seconds. So: Flash first for
// better writing, Lite when Google is busy.
export const MODELS = (process.env.GEMINI_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);
const MAX_CALLS = Number(process.env.MAX_AI_CALLS || 20); // per run, a hard stop (free tier, so this guards time, not money)
let calls = 0;

export const available = () => Boolean(KEY);
export const callsMade = () => calls;

async function once(model, body, timeoutMs) {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { 'Content-Type': 'application/json' };
  let url = base;
  if (AUTH === 'query') url = `${base}?key=${encodeURIComponent(KEY)}`;
  else if (AUTH === 'bearer') headers.Authorization = `Bearer ${KEY}`;
  else headers['x-goog-api-key'] = KEY;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: { error: { message: err.name === 'AbortError' ? 'took too long' : err.message } } };
  } finally {
    clearTimeout(timer);
  }
}

// system: standing instructions; prompt: the task; schema: JSON shape to return (optional);
// search: let the model look things up on Google Search (not part of the free tier, kept for later).
// Goes round the models in order; if every one is busy, waits and goes round once more.
export async function ask({ system, prompt, schema, search = false, temperature = 0.4, timeoutMs = 45_000, rounds = 2, pauseMs = 30_000 }) {
  if (!KEY) throw new Error('No Google AI key (GEMINI_API_KEY).');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  const errors = [];
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((r) => setTimeout(r, pauseMs));
    let retryable = false;
    for (const model of MODELS) {
      if (calls >= MAX_CALLS) throw new Error(`Stopped at the limit of ${MAX_CALLS} AI calls for this run. ${errors.at(-1) || ''}`);
      calls++;
      const { status, json } = await once(model, body, timeoutMs);
      if (status === 200) {
        const cand = json.candidates?.[0];
        const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
        if (!text) {
          errors.push(`${model}: empty answer (${cand?.finishReason || 'no reason given'})`);
          retryable = true;
          continue;
        }
        let parsed = null;
        if (schema) {
          try {
            parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          } catch {
            errors.push(`${model}: the answer was not valid JSON`);
            retryable = true;
            continue;
          }
        }
        const chunks = cand?.groundingMetadata?.groundingChunks || [];
        const sources = chunks.map((c) => c.web).filter((w) => w?.uri).map((w) => ({ name: w.title || new URL(w.uri).hostname, url: w.uri }));
        return { model, text, json: parsed, sources };
      }
      errors.push(`${model}: ${status ? `HTTP ${status}` : 'no answer in time'} ${String(json?.error?.message || '').replace(/\s+/g, ' ').slice(0, 120)}`);
      if ([0, 429, 500, 503].includes(status)) retryable = true; // busy or slow: worth another round
    }
    if (!retryable) break;
  }
  throw new Error(`Google AI did not answer. ${errors.slice(-2).join(' | ')}`);
}
