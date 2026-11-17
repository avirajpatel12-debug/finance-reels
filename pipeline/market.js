// The market story reel: what happened today, why, why it matters, what it means for other companies and markets,
// and what to watch next.
//   1. facts.js builds the fact sheet (every allowed number, with its source and date).
//   2. Gemini searches today's news for the reasons behind the move (with sources). It is told not to guess.
//   3. Gemini writes the script, choosing only from the facts, reasons and briefing stories.
//   4. verify.js checks it. One retry with the problems listed; if it still fails, or the AI is unavailable,
//      a plain script is built from the data alone, so a reel is always made and nothing is ever invented.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.js';
import { marketFacts } from './facts.js';
import { plainDay } from './format.js';
import * as ai from './gemini.js';
import { todaysHeadlines } from './headlines.js';
import { checkStory, allowedNumbers, numbersIn } from './verify.js';

const PROMPT_VERSION = 1;
const BEAT_LABEL = { what: 'What happened', why: 'Why', matters: 'Why it matters', implications: 'What it means', ripple: 'Ripple effects', watch: 'What to watch', outro: '' };
const log = (...a) => console.log(new Date().toISOString(), ...a);

const SYSTEM = `You write the narration for a 40 to 55 second vertical video about today's US stock market. The viewer is a college student learning about markets. Sound like a calm, clear morning-news anchor. Plain English. Explain a market term in a few words the first time you use it.

Tell a story, not a list of numbers. Use these beats, in this order:
1. what: what happened in the market, with at most two numbers.
2. why: why it happened. Use only the REASONS or STORIES given, and list their ids in sourceIds. If none explains the move, leave this beat out. Never guess a cause.
3. matters: why it matters. Use the significance facts: is this unusual compared with the past?
4. implications: what it means for markets: which kinds of companies or assets tend to win or lose, and why. You may explain general market mechanics (for example: when bond yields are high, future profits are worth less today, which weighs on stock prices). Say "could" or "tends to" for anything that is a view, not a fact.
5. ripple: knock-on effects on other sectors, companies or assets, using their actual moves from the FACTS.
6. watch: what to watch next, from the calendar facts.
You may merge implications and ripple. Use 5 to 7 scenes.

Hard rules:
- Every number you write must be copied exactly from the FACTS (value or meaning) or the STORIES. Write numbers as digits. Never round, convert, add up, subtract or estimate. If a number is not given, do not use one.
- Do not state any event, cause or company action that is not in the FACTS, REASONS or STORIES.
- Moves: write "down 1.25%" or "up 0.40%" (no plus or minus signs in the narration).
- Each scene: 1 or 2 short sentences, at most 30 words. The whole video: 70 to 120 words.
- sourceIds lists only REASON ids (r1, r2...) or STORY ids (story1...), never fact ids.
- No abbreviations a beginner would not know: say "earnings per share", not "EPS". No em dashes.
- Pick one visual per scene:
  headline: a short news-style headline (at most 60 characters), best for what and why.
  stat: one big number: factId of a level, significance or move fact, plus a context line (at most 60 characters).
  bars: 2 to 6 move facts to compare (factIds), for example sectors or the stocks in a story.
  ripple: a cause (fromLabel, at most 28 characters) and 2 to 4 move facts it hit (toFactIds).
  watch: 1 to 3 calendar factIds.
- The title is at most 40 characters and has no numbers.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          beat: { type: 'STRING', enum: ['what', 'why', 'matters', 'implications', 'ripple', 'watch'] },
          narration: { type: 'STRING' },
          visual: {
            type: 'OBJECT',
            properties: {
              kind: { type: 'STRING', enum: ['headline', 'stat', 'bars', 'ripple', 'watch'] },
              headline: { type: 'STRING' },
              factId: { type: 'STRING' },
              context: { type: 'STRING' },
              factIds: { type: 'ARRAY', items: { type: 'STRING' } },
              fromLabel: { type: 'STRING' },
              toFactIds: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['kind'],
          },
          sourceIds: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['beat', 'narration', 'visual', 'sourceIds'],
      },
    },
  },
  required: ['title', 'scenes'],
};

// Same data in, same reel out: the fingerprint of what the reel is made from. If it matches the reel already on the
// site, nothing is researched, written or rendered.
export function inputHash(sheet) {
  const core = { v: PROMPT_VERSION, facts: sheet.facts.map((f) => [f.id, f.display, f.asOf]), stories: sheet.stories.map((s) => [s.id, s.headline]) };
  return crypto.createHash('sha1').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

export function prepare(tables) {
  const sheet = marketFacts(tables);
  if (!sheet) return null;
  const { when } = sheet;
  return {
    sheet,
    id: `market-${when.ymd}-${when.open ? 'midday' : 'close'}`,
    hash: inputHash(sheet),
  };
}

// ---------- 2. Why did the market move? (today's headlines) ----------
// Google's free tier does not include its web search, so the AI reads today's headlines from public newsroom feeds
// and picks out the reasons they give. Each reason keeps links to the articles it came from.
async function research(sheet) {
  const headlines = await todaysHeadlines();
  if (!headlines.length) return { reasons: [], sources: [], note: 'no headlines from the news feeds' };
  const f = new Map(sheet.facts.map((x) => [x.id, x]));
  const sectors = sheet.facts.filter((x) => x.group === 'sector');
  const say = (id) => (f.get(id) ? `${f.get(id).label} ${f.get(id).display}` : null);
  const et = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const prompt = `Today is ${sheet.when.weekday}, ${sheet.when.monthDay}, ${sheet.when.year}. ${sheet.when.open ? 'US markets are open; the moves are so far today.' : 'US markets have closed for the day.'}
US stocks today: ${['move.SPY', 'move.DIA', 'move.QQQ', 'move.IWM'].map(say).filter(Boolean).join(', ')}.
${sectors.length ? `Strongest sector: ${sectors[0].label} ${sectors[0].display}. Weakest: ${sectors.at(-1).label} ${sectors.at(-1).display}.` : ''}

Headlines published in the last few hours (id | outlet | time ET | headline | summary):
${headlines.map((h) => `${h.id} | ${h.outlet} | ${et(h.at)} | ${h.title} | ${h.summary}`).join('\n')}

Using ONLY these headlines, list the reasons they give for today's US stock market move.
Rules:
- 2 to 4 reasons, one short sentence each, plain English, in your own words.
- Only reasons about today's overall market or a large group of stocks, not one small company.
- End each line with the ids of the headlines it comes from, in square brackets, like [h3, h7].
- Start each line with "- ". Do not include any numbers.
- If none of the headlines explain today's move, reply with exactly: NO_REASONS`;
  const res = await ai.ask({ prompt, temperature: 0.2 });
  if (/NO_REASONS/.test(res.text)) return { reasons: [], sources: [], model: res.model, note: 'the headlines did not explain the move' };
  const byId = new Map(headlines.map((h) => [h.id, h]));
  const reasons = res.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => {
      const tagged = /\[([^\]]+)\][.\s]*$/; // "[h3, h7]" at the end, sometimes followed by a period
      const ids = ((l.match(tagged) || [])[1] || '').split(/[,\s]+/).filter((id) => byId.has(id));
      return { text: l.replace(/^[-*•]\s+/, '').replace(/\s*\[[^\]]+\][.\s]*$/, '').replace(/([^.!?])$/, '$1.').trim(), headlines: ids };
    })
    .filter((r) => r.text && r.headlines.length) // a reason must point to a real headline
    .slice(0, 4)
    .map((r, i) => ({ id: `r${i + 1}`, text: r.text, publication: [...new Set(r.headlines.map((id) => byId.get(id).outlet))].join(', '), links: r.headlines.map((id) => byId.get(id)) }));
  if (!reasons.length) console.log(`(reasons reply could not be read: ${res.text.replace(/\s+/g, ' ').slice(0, 400)})`);
  const seen = new Set();
  const sources = reasons.flatMap((r) => r.links).filter((h) => !seen.has(h.url) && seen.add(h.url)).map((h) => ({ name: h.outlet, url: h.url, title: h.title }));
  return { reasons, sources, model: res.model, headlines: headlines.length };
}

// ---------- 3. The script ----------
function brief(sheet, found) {
  const line = (x) => `${x.id} | ${x.meaning} | value: ${x.display}`;
  const groups = [
    ['Markets (funds that track each index)', 'market'],
    ['Sectors, best to worst', 'sector'],
    ['Levels (official closes, each with its date)', 'level'],
    ['Significance (is it unusual?)', 'significance'],
    ['Counts', 'count'],
    ['Calendar (what to watch)', 'calendar'],
    ['Stocks in today\'s stories', 'story'],
  ];
  const facts = groups
    .map(([title, g]) => [title, sheet.facts.filter((x) => x.group === g)])
    .filter(([, xs]) => xs.length)
    .map(([title, xs]) => `${title}:\n${xs.map(line).join('\n')}`)
    .join('\n\n');
  const reasons = found.reasons.length ? found.reasons.map((r) => `${r.id} | ${r.text} | ${r.publication}`).join('\n') : '(none found)';
  const stories = sheet.stories.map((s) => `${s.id} | ${s.headline}\n  What: ${s.what}\n  Why it matters: ${s.bigPicture}${s.report ? `\n  Results: ${s.report}` : ''}`).join('\n');
  return `DATE: ${sheet.when.weekday}, ${sheet.when.monthDay}, ${sheet.when.year}, as of ${sheet.when.time} ET. ${sheet.when.open ? 'Markets are open: moves are so far today.' : 'Markets have closed.'}

FACTS (id | what it is | value, exactly as you must write it):
${facts}

REASONS from today's news (id | reason | publication):
${reasons}

STORIES from today's briefing (id | headline):
${stories}

Write the script.`;
}

async function write(sheet, found) {
  const sourceIds = new Set([...found.reasons.map((r) => r.id), ...sheet.stories.map((s) => s.id)]);
  let prompt = brief(sheet, found);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await ai.ask({ system: SYSTEM, prompt, schema: SCHEMA, temperature: 0.5 });
    const script = clean(res.json);
    for (const sc of script?.scenes || []) sc.sourceIds = (sc.sourceIds || []).filter((id) => sourceIds.has(id));
    const problems = checkStory(script, sheet, sourceIds);
    if (!problems.length) return { script, model: res.model, attempts: attempt };
    log(`Script check found ${problems.length} problem(s)${attempt === 1 ? ', asking for a fix' : ''}: ${problems.slice(0, 4).join(' | ')}`);
    try {
      fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'out', `rejected-script-${attempt}.json`), JSON.stringify({ problems, script }, null, 2)); // for review; never published
    } catch {
      /* not important */
    }
    prompt = `${brief(sheet, found)}\n\nYour previous script was:\n${JSON.stringify(script)}\n\nIt has these problems. Fix all of them and return the whole script again:\n- ${problems.join('\n- ')}`;
  }
  return null;
}

// Small tidy-ups that do not change meaning.
function clean(script) {
  if (!script?.scenes) return script;
  const tidy = (t) => String(t || '').replace(/\s*[—–]\s*/g, ', ').replace(/\bS\s*(?:&|and)\s*P\s*500\b/gi, 'S&P 500').replace(/\s+/g, ' ').trim();
  script.title = tidy(script.title);
  for (const s of script.scenes) {
    s.narration = tidy(s.narration);
    if (s.visual) for (const k of ['headline', 'context', 'fromLabel']) if (s.visual[k]) s.visual[k] = tidy(s.visual[k]);
    s.sourceIds = (s.sourceIds || []).filter(Boolean);
  }
  return script;
}

// ---------- 4. Fallback: a plain story from the data alone (no AI) ----------
function plainScript(sheet) {
  const f = new Map(sheet.facts.map((x) => [x.id, x]));
  const mv = (id) => {
    const x = f.get(id);
    return x ? `${x.move < 0 ? 'down' : x.move > 0 ? 'up' : 'flat at'} ${x.display.replace(/^[+-]/, '')}` : null;
  };
  const scenes = [];
  const spy = f.get('move.SPY');
  const tone = Math.abs(spy.move) < 0.25 ? 'little changed' : spy.move > 0 ? 'higher' : 'lower';
  const others = [['move.DIA', 'the Dow'], ['move.QQQ', 'the Nasdaq 100']].filter(([id]) => f.has(id));
  scenes.push({ beat: 'what', narration: `Stocks closed ${tone} ${sheet.span}. The S&P 500 is ${mv('move.SPY')}${others.map(([id, n]) => `, ${n} ${mv(id)}`).join('')}.`.replace('closed', sheet.when.open ? 'are' : 'closed'), visual: { kind: 'bars', factIds: ['move.SPY', ...others.map(([id]) => id), 'move.IWM'].filter((id) => f.has(id)) }, sourceIds: [] });
  // The most unusual thing today: a big S&P 500 move, or else the level furthest from normal for the past ten years.
  const top = f.get('rank.SPY') || sheet.facts.filter((x) => x.id.startsWith('decade.') && x.id !== 'decade.SP500').sort((a, b) => Math.abs(parseFloat(b.display) - 50) - Math.abs(parseFloat(a.display) - 50))[0];
  if (top) {
    const level = top.id === 'rank.SPY' ? null : f.get(top.id.replace(/^decade\./, 'level.'));
    const narration = top.id === 'rank.SPY' ? `${top.meaning.replace(/ \(today.*$/, '')}.` : `The ${level ? `${level.label} is ${level.display}, ` : ''}${top.meaning}.`;
    scenes.push({ beat: 'matters', narration: narration.charAt(0).toUpperCase() + narration.slice(1), visual: { kind: 'stat', factId: level ? level.id : top.id, context: top.meaning.slice(0, 60) }, sourceIds: [] });
  }
  const sec = sheet.facts.filter((x) => x.group === 'sector');
  if (sec.length >= 6) {
    const up = f.get('sectors.up').display;
    const total = f.get('sectors.total').display;
    const breadth = up === '0' ? `All ${total} sectors fell.` : up === total ? `All ${total} sectors rose.` : `${up} of ${total} sectors rose.`;
    scenes.push({ beat: 'ripple', narration: `${breadth} ${sec[0].label} did best, ${mv(sec[0].id)}. ${sec.at(-1).label} did worst, ${mv(sec.at(-1).id)}.`, visual: { kind: 'bars', factIds: [...sec.slice(0, 3), ...sec.slice(-3)].map((x) => x.id) }, sourceIds: [] });
  }
  const cal = sheet.facts.filter((x) => x.group === 'calendar').slice(0, 3);
  if (cal.length) scenes.push({ beat: 'watch', narration: `Coming up: ${cal.map((x) => `${x.label.replace(/ earnings$/, '')} reports ${x.display.replace(/, /, ' ')}`).join('; ')}.`, visual: { kind: 'watch', factIds: cal.map((x) => x.id) }, sourceIds: [] });
  return { title: 'Today in the markets', scenes };
}

// ---------- Turning the script into scenes the template can draw ----------
function toScenes(script, sheet, found) {
  const f = new Map(sheet.facts.map((x) => [x.id, x]));
  const src = new Map([...found.reasons.map((r) => [r.id, r.publication || 'News reports']), ...sheet.stories.map((s) => [s.id, s.sources[0]?.name || 'Briefing'])]);
  const asOfText = (x) => (x.group === 'level' || x.group === 'significance' ? `Close on ${plainDay(String(x.asOf).slice(0, 10))}` : sheet.span);
  const row = (x) => ({ label: x.label, sub: x.id.split('.').pop(), value: x.display, move: x.move });
  const scenes = script.scenes.map((s) => {
    const v = s.visual;
    const used = [v.factId, ...(v.factIds || []), ...(v.toFactIds || [])].map((id) => f.get(id)).filter(Boolean);
    const names = [...new Set([...(s.sourceIds || []).map((id) => src.get(id)).filter(Boolean), ...used.map((x) => x.sourceName)])];
    const base = { beat: s.beat, beatLabel: BEAT_LABEL[s.beat], narration: s.narration, sourceLine: names.length ? `Source: ${names.slice(0, 3).join(' · ')}` : '' };
    if (v.kind === 'headline') return { ...base, type: 'headline', visual: { headline: v.headline, sources: names.slice(0, 3) } };
    if (v.kind === 'stat') {
      const x = f.get(v.factId);
      return { ...base, type: 'stat', visual: { label: x.label, value: x.display, sign: x.kind === 'move' ? Math.sign(x.move) : 0, context: v.context || '', date: asOfText(x), spark: x.history || [] } };
    }
    if (v.kind === 'bars') {
      const xs = v.factIds.map((id) => f.get(id));
      const group = xs[0].group;
      const heading = { market: 'The market', sector: 'Sectors', story: 'Stocks in the story' }[group] || 'Moves';
      return { ...base, type: 'bars', visual: { heading, note: `${group === 'market' ? 'Funds that track each index' : group === 'sector' ? 'SPDR sector funds' : 'Share price'}, ${sheet.span}`, compact: xs.length > 4, rows: xs.map(row) } };
    }
    if (v.kind === 'ripple') return { ...base, type: 'ripple', visual: { from: v.fromLabel, rows: v.toFactIds.map((id) => row(f.get(id))) } };
    return { ...base, type: 'watch', visual: { items: v.factIds.map((id) => ({ label: f.get(id).label, when: f.get(id).display })) } };
  });
  scenes.push({ beat: 'outro', beatLabel: '', type: 'outro', narration: 'Swipe up for the next story.', sourceLine: '', visual: { lines: ['That is the market story', 'Swipe up for more'] } });
  return scenes;
}

// Builds the whole reel. dry: no AI calls at all.
export async function buildMarketReel(prep, { dry = false } = {}) {
  const { sheet } = prep;
  let found = { reasons: [], sources: [] };
  let script = null;
  let how = 'plain script from the data (no AI)';
  if (!dry && ai.available()) {
    try {
      found = await research(sheet);
      log(`Why the market moved: ${found.reasons.length} reason(s) from ${found.headlines ?? 0} headlines${found.model ? ` (${found.model})` : ''}${found.note ? `; ${found.note}` : ''}.`);
    } catch (err) {
      log(`WARNING: could not work out why the market moved, so the reel will not say. ${err.message}`);
    }
    try {
      const out = await write(sheet, found);
      if (out) {
        script = out.script;
        how = `written by ${out.model}${out.attempts > 1 ? ' (fixed after one check)' : ''}`;
      } else log('WARNING: the AI script failed the checks twice, so a plain script from the data is used instead.');
    } catch (err) {
      log(`WARNING: the AI writer was not available, so a plain script from the data is used instead. ${err.message}`);
    }
  }
  if (!script) {
    script = plainScript(sheet);
    found = { reasons: [], sources: [] };
  }
  const cited = new Set(script.scenes.flatMap((s) => s.sourceIds || []));
  const storyLinks = sheet.stories.filter((s) => cited.has(s.id)).flatMap((s) => s.sources.slice(0, 1));
  const seenLink = new Set();
  const newsLinks = found.reasons.filter((r) => cited.has(r.id)).flatMap((r) => r.links || []).filter((h) => !seenLink.has(h.url) && seenLink.add(h.url)).slice(0, 3).map((h) => ({ name: h.outlet, url: h.url }));
  const { when } = sheet;
  return {
    id: prep.id,
    kind: 'market',
    title: script.title,
    dateLabel: `${when.weekday}, ${when.monthDay}`,
    footer: { source: 'Sources: Finnhub, FRED, news reports', asOf: `As of ${when.time} ET, ${when.shortDay}` },
    ticker: sheet.ticker,
    sources: [...newsLinks, ...storyLinks, { name: 'Finnhub', url: 'https://finnhub.io' }, { name: 'FRED', url: 'https://fred.stlouisfed.org' }].slice(0, 6),
    facts: sheet.facts.map(({ history, ...x }) => x),
    reasons: found.reasons,
    allowed: [...allowedNumbers(sheet)],
    how,
    scenes: toScenes(script, sheet, found),
  };
}

// Final gate on the finished scenes, whatever wrote them.
export function finalCheck(reel) {
  const ok = new Set(reel.allowed);
  const problems = [];
  reel.scenes.forEach((s, i) => {
    const texts = [s.narration, s.visual?.headline, s.visual?.context, s.visual?.from];
    for (const t of texts) for (const n of numbersIn(t)) if (!ok.has(n)) problems.push(`scene ${i + 1}: "${n}" is not on the fact sheet`);
  });
  return problems;
}
