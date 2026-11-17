// Accuracy gate. Every number that is spoken or shown must be on the reel's fact sheet, written the same way.
// Names that contain digits (S&P 500, 10-year) are ignored, and number words ("two", "eleven") count as numbers, so
// the writer cannot slip a figure past the check by spelling it out.
const NAMES = /S\s*&\s*P\s*500|S\s+and\s+P\s+500|\bSP\s?500\b|Nasdaq[- ]100|Russell[- ]2000|\b\d+-(?:year|day|week|month)\b|\b(?:one|two|three|five|ten|thirty)-(?:year|day|week|month)\b|\bQ[1-4]\b|\b(?:first|second|third|fourth)[- ]quarter\b/gi;
const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

export function numbersIn(text) {
  const t = String(text ?? '').replace(NAMES, ' ');
  const digits = (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
  const words = (t.toLowerCase().match(/\b[a-z]+\b/g) || []).filter((w) => w in WORDS).map((w) => String(WORDS[w]));
  return [...digits, ...words];
}

// Old-style check used by the plain template scripts.
export function verifyScript(scenes, allowed) {
  const ok = new Set([...allowed].map((n) => String(n).replace(/,/g, '')));
  const problems = [];
  scenes.forEach((s, i) => {
    for (const n of numbersIn(s.narration)) if (!ok.has(n)) problems.push(`scene ${i + 1}: "${n}" is not on the fact sheet`);
  });
  return problems;
}

export function allowedNumbers(sheet) {
  const out = new Set();
  for (const f of sheet.facts) for (const n of numbersIn([f.label, f.display, f.meaning].join(' '))) out.add(n);
  for (const s of sheet.stories || []) for (const n of s.numbers || []) out.add(n);
  return out;
}

const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
export const BEATS = ['what', 'why', 'matters', 'implications', 'ripple', 'watch'];

// Checks a script written by the AI against the fact sheet. Returns a list of problems (empty = passed).
export function checkStory(script, sheet, sourceIds) {
  const problems = [];
  const facts = new Map(sheet.facts.map((f) => [f.id, f]));
  const allowed = allowedNumbers(sheet);
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  if (scenes.length < 4 || scenes.length > 7) problems.push(`Use 4 to 7 scenes (there are ${scenes.length}).`);
  if (scenes[0]?.beat !== 'what') problems.push('The first scene must be the "what" beat.');
  const total = scenes.reduce((n, s) => n + words(s.narration), 0);
  if (total < 60 || total > 140) problems.push(`The narration must be 60 to 140 words in total (it is ${total}).`);
  if (!String(script?.title || '').trim() || String(script.title).length > 48) problems.push('Give a title of at most 48 characters.');
  for (const n of numbersIn(script?.title)) if (!allowed.has(n)) problems.push(`Title: "${n}" is not in the FACTS.`);
  scenes.forEach((s, i) => {
    const at = `Scene ${i + 1} (${s.beat})`;
    const v = s.visual || {};
    if (!BEATS.includes(s.beat)) problems.push(`${at}: unknown beat.`);
    if (!String(s.narration || '').trim()) problems.push(`${at}: narration is empty.`);
    if (words(s.narration) > 34) problems.push(`${at}: narration has ${words(s.narration)} words; use at most 34.`);
    for (const text of [s.narration, v.headline, v.context, v.fromLabel]) for (const n of numbersIn(text)) if (!allowed.has(n)) problems.push(`${at}: "${n}" is not in the FACTS. Use only numbers exactly as written there.`);
    // A level from an earlier day must be dated in the narration ("at Monday's close").
    for (const f of sheet.facts) {
      if (f.group !== 'level' || !sheet.when || String(f.asOf).slice(0, 10) === sheet.when.ymd) continue;
      if (!String(s.narration || '').includes(f.display.replace(/ a barrel| points/, ''))) continue;
      const d = new Date(`${String(f.asOf).slice(0, 10)}T12:00:00Z`);
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(d);
      const md = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
      const ok = new RegExp(`${weekday}|yesterday|${md.replace(' ', '\\.?\\s+')}|(?:previous|prior|last|latest|most recent) (?:close|session|trading day)`, 'i').test(s.narration);
      if (!ok) problems.push(`${at}: ${f.display} is the close on ${weekday}, ${md}, not today. Say so, for example "at ${weekday}'s close".`);
    }
    const cited = (s.sourceIds || []).filter(Boolean);
    for (const id of cited) if (!sourceIds.has(id)) problems.push(`${at}: source id "${id}" does not exist.`);
    if (s.beat === 'why' && !cited.some((id) => sourceIds.has(id))) problems.push(`${at}: a "why" scene must cite at least one REASON or STORY id; if none fits, leave the "why" beat out.`);
    const need = (id, kinds) => {
      const f = facts.get(id);
      if (!f) problems.push(`${at}: fact id "${id}" does not exist.`);
      else if (kinds && !kinds.includes(f.kind)) problems.push(`${at}: fact "${id}" is a ${f.kind} fact; this visual needs ${kinds.join(' or ')}.`);
    };
    switch (v.kind) {
      case 'headline':
        if (!String(v.headline || '').trim() || String(v.headline).length > 64) problems.push(`${at}: the headline must be 1 to 64 characters.`);
        break;
      case 'stat':
        need(v.factId, ['level', 'stat', 'move', 'count']);
        if (String(v.context || '').length > 70) problems.push(`${at}: the context line must be at most 70 characters.`);
        break;
      case 'bars':
        if (!Array.isArray(v.factIds) || v.factIds.length < 2 || v.factIds.length > 11) problems.push(`${at}: bars need 2 to 11 move facts.`);
        else v.factIds.forEach((id) => need(id, ['move']));
        break;
      case 'ripple':
        if (!String(v.fromLabel || '').trim() || String(v.fromLabel).length > 30) problems.push(`${at}: the ripple cause (fromLabel) must be 1 to 30 characters.`);
        if (!Array.isArray(v.toFactIds) || v.toFactIds.length < 2 || v.toFactIds.length > 4) problems.push(`${at}: a ripple needs 2 to 4 move facts it affected.`);
        else v.toFactIds.forEach((id) => need(id, ['move']));
        break;
      case 'watch':
        if (!Array.isArray(v.factIds) || v.factIds.length < 1 || v.factIds.length > 3) problems.push(`${at}: watch needs 1 to 3 calendar facts.`);
        else v.factIds.forEach((id) => need(id, ['event']));
        break;
      default:
        problems.push(`${at}: unknown visual kind "${v.kind}".`);
    }
  });
  return problems;
}
