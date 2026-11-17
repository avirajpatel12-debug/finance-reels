// The fact sheet for a market story reel. Every number the reel may say or show is in here, written exactly the way it
// will appear, with where it came from and its date. The AI writer can only pick from these: it never supplies a
// number. "Why it matters" facts (is this unusual?) are worked out here from the stored history, not by the AI.
import { signed, num, trim, etParts, plainDay } from './format.js';
import { numbersIn } from './verify.js';

const SECTOR_SYMBOLS = ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
const SHORT = { SPY: 'SPY', QQQ: 'QQQ', DIA: 'DIA', IWM: 'IWM', GLD: 'GLD', USO: 'USO', UUP: 'UUP', 'BINANCE:BTCUSDT': 'BTC' };
// Names for the earnings calendar (it only gives ticker symbols).
const NAMES = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta', NVDA: 'Nvidia', AVGO: 'Broadcom', AMD: 'AMD', TSM: 'TSMC',
  MU: 'Micron', ORCL: 'Oracle', CRWV: 'CoreWeave', NOW: 'ServiceNow', CRM: 'Salesforce', ADBE: 'Adobe', NFLX: 'Netflix', TSLA: 'Tesla', GM: 'General Motors',
  NKE: 'Nike', SBUX: 'Starbucks', MCD: "McDonald's", CMG: 'Chipotle', TGT: 'Target', WMT: 'Walmart', COST: 'Costco', HD: 'Home Depot', ABNB: 'Airbnb',
  CPRT: 'Copart', INTU: 'Intuit', HUBS: 'HubSpot', ONON: 'On Holding', DECK: 'Deckers', LULU: 'Lululemon', ACM: 'AECOM', WCN: 'Waste Connections',
  RSG: 'Republic Services', WM: 'Waste Management', UNH: 'UnitedHealth', HUM: 'Humana', CVS: 'CVS Health', ELV: 'Elevance Health', CI: 'Cigna', INTC: 'Intel',
  QCOM: 'Qualcomm', ARM: 'Arm', SMCI: 'Super Micro', DELL: 'Dell', ANET: 'Arista', PLTR: 'Palantir', SNOW: 'Snowflake', DDOG: 'Datadog', CRWD: 'CrowdStrike',
  PANW: 'Palo Alto Networks', SHOP: 'Shopify', UBER: 'Uber', DIS: 'Disney', KLAR: 'Klarna', TU: 'Telus', BCE: 'BCE', HTHT: 'H World', LOW: "Lowe's", TJX: 'TJX',
  XOM: 'Exxon Mobil', CVX: 'Chevron', BA: 'Boeing', CAT: 'Caterpillar', V: 'Visa', MA: 'Mastercard', PYPL: 'PayPal', COIN: 'Coinbase', HOOD: 'Robinhood',
  LLY: 'Eli Lilly', NVO: 'Novo Nordisk', MRK: 'Merck', PFE: 'Pfizer', JNJ: 'Johnson & Johnson', ABBV: 'AbbVie', T: 'AT&T', VZ: 'Verizon', TMUS: 'T-Mobile',
  CMCSA: 'Comcast', WBD: 'Warner Bros. Discovery', SPOT: 'Spotify', BABA: 'Alibaba', ASML: 'ASML', SAP: 'SAP', PG: 'Procter & Gamble', KO: 'Coca-Cola', PEP: 'PepsiCo', HSY: 'Hershey', KMB: 'Kimberly-Clark', CL: 'Colgate-Palmolive', MDLZ: 'Mondelez',
  JPM: 'JPMorgan', BAC: 'Bank of America', C: 'Citigroup', WFC: 'Wells Fargo', GS: 'Goldman Sachs', MS: 'Morgan Stanley', DOW: 'Dow Inc.', LYB: 'LyondellBasell',
  IP: 'International Paper', PKG: 'Packaging Corp.', SHW: 'Sherwin-Williams', APD: 'Air Products', LIN: 'Linde', CF: 'CF Industries', ECL: 'Ecolab', DD: 'DuPont',
};
// Levels from FRED, each with its own date. "fmt" is exactly how the number is written.
const LEVELS = [
  ['VIXCLS', 'VIX fear gauge', (v) => trim(v)],
  ['DGS10', '10-year Treasury yield', (v) => `${trim(v)}%`],
  ['DGS2', '2-year Treasury yield', (v) => `${trim(v)}%`],
  ['T10Y2Y', 'Gap between the 10-year and 2-year yields', (v) => `${trim(v)} points`],
  ['BAMLH0A0HYM2', 'Junk bond spread (extra yield on risky company bonds)', (v) => `${trim(v)} points`],
  ['DCOILWTICO', 'WTI oil price', (v) => `$${num(v)} a barrel`],
  ['DTWEXBGS', 'Dollar index against major trading partners', (v) => num(v)],
  ['MORTGAGE30US', '30-year mortgage rate', (v) => `${trim(v)}%`],
  ['SP500', 'S&P 500 index close', (v) => num(v)],
];

const dayKey = (iso) => etParts(iso).ymd;
// A company name from the briefing's own lookup table when the short list above does not have it.
const cleanName = (n) => String(n || '').replace(/,?\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Holdings?|Group|Ltd\.?|Limited|plc|PLC|N\.V\.|S\.A\.|AG|SE|Class [A-C])\b\.?/g, '').replace(/\s+/g, ' ').trim();

// The most recent earlier day that was at least as extreme as today, within the stored history (about a year).
function extremeSince(history, value, dir) {
  const past = history.slice(0, -1);
  for (let i = past.length - 1; i >= 0; i--) if (dir === 'highest' ? past[i].value >= value : past[i].value <= value) return { date: past[i].date, within: true };
  return past.length >= 240 ? { date: past[0].date, within: false } : null; // none in the window: "in more than a year"
}

export function marketFacts({ indices, macro, sectors, earnings, feed, 'market-caps': caps }) {
  const nameOf = (sym) => NAMES[sym] || cleanName(caps?.[sym]?.name) || sym;
  const rows = new Map((indices?.rows || []).filter((r) => !r.error && !r.stale && r.movePct != null).map((r) => [r.symbol, r]));
  const spy = rows.get('SPY');
  if (!spy) return null; // no fresh S&P 500 quote, so no market reel
  const when = { ...etParts(spy.asOf), year: new Date(spy.asOf).getUTCFullYear() };
  when.open = when.hour24 < 16;
  const span = when.open ? 'so far today' : 'today';
  const facts = [];
  const add = (f) => (facts.push(f), f);

  // 1. Stock indexes and other markets, through the funds that track them.
  for (const r of rows.values()) {
    add({ id: `move.${SHORT[r.symbol] || r.symbol}`, kind: 'move', group: 'market', label: r.label, display: signed(r.movePct), move: r.movePct, meaning: `${r.label} ${span}, measured by ${r.tracks}`, asOf: r.asOf, source: r.tracks, sourceName: 'Finnhub' });
  }

  // 2. Sectors, same trading day only, best to worst.
  const names = new Map((sectors?.rows || []).map((r) => [r.symbol, r.name]));
  const sec = SECTOR_SYMBOLS.map((s) => ({ s, name: names.get(s) || s, ...(sectors?.today?.[s] || {}) }))
    .filter((x) => x.movePct != null && x.asOf && dayKey(x.asOf) === when.ymd)
    .sort((a, b) => b.movePct - a.movePct);
  sec.forEach((x, i) => add({ id: `sector.${x.s}`, kind: 'move', group: 'sector', label: x.name, display: signed(x.movePct), move: x.movePct, meaning: `${x.name} sector ${span}, rank ${i + 1} of ${sec.length}`, asOf: x.asOf, source: `SPDR ${x.s} sector fund`, sourceName: 'Finnhub' }));
  if (sec.length >= 6) {
    const up = sec.filter((x) => x.movePct > 0).length;
    add({ id: 'sectors.up', kind: 'count', label: 'Sectors that rose', display: String(up), meaning: `${up} of ${sec.length} sectors rose ${span}`, asOf: sec[0].asOf, source: 'SPDR sector funds', sourceName: 'Finnhub' });
    add({ id: 'sectors.total', kind: 'count', label: 'Sectors with a price', display: String(sec.length), meaning: `${sec.length} sectors in total`, asOf: sec[0].asOf, source: 'SPDR sector funds', sourceName: 'Finnhub' });
  }

  // 3. Rates, fear, oil, dollar: official closes from FRED, plus how unusual each level is.
  const series = new Map((macro?.series || []).filter((s) => s.value != null && !s.stale).map((s) => [s.key, s]));
  for (const [key, label, fmt] of LEVELS) {
    const s = series.get(key);
    if (!s) continue;
    const date = plainDay(s.date);
    add({ id: `level.${key}`, kind: 'level', group: 'level', label, display: fmt(s.value), meaning: `${label} at the close on ${date}`, asOf: s.date, source: `FRED ${s.seriesId}`, sourceName: 'FRED', history: (s.history || []).slice(-60).map((h) => h.value) });
    if (s.previous) add({ id: `prev.${key}`, kind: 'level', group: 'level', label: `${label}, close before`, display: fmt(s.previous.value), meaning: `${label} at the close on ${plainDay(s.previous.date)}`, asOf: s.previous.date, source: `FRED ${s.seriesId}`, sourceName: 'FRED' });
    if (s.decade?.percentile != null) {
      const since = String(s.decade.since).slice(0, 4);
      // The percentile counts days at or below today's level; with prices to two decimals, ties are too rare to change the rounded number.
      add({ id: `decade.${key}`, kind: 'stat', group: 'significance', label: `${label} compared with the past ten years`, display: `${s.decade.percentile}%`, meaning: `higher than on ${s.decade.percentile}% of days since ${since}`, asOf: s.date, source: `FRED ${s.seriesId}, ten years of closes`, sourceName: 'FRED' });
    }
    if (s.history?.length > 20 && key !== 'SP500') {
      for (const dir of ['highest', 'lowest']) {
        const x = extremeSince(s.history, s.value, dir);
        if (!x) continue;
        const gap = s.history.length - 1 - s.history.findIndex((h) => h.date === x.date);
        if (x.within && gap < 15) continue; // "highest since last week" is not news
        const phrase = x.within ? `${dir} close since ${plainDay(x.date)}, ${x.date.slice(0, 4)}` : `${dir} close in more than a year`;
        add({ id: `since.${key}`, kind: 'stat', group: 'significance', label: `${label}: ${phrase}`, display: x.within ? plainDay(x.date) : 'more than a year', meaning: `${label}: ${phrase}`, asOf: s.date, source: `FRED ${s.seriesId}`, sourceName: 'FRED' });
        break;
      }
    }
  }

  // 4. Is today's S&P 500 move unusual? Compared with daily changes of the index over the stored year.
  const sp = series.get('SP500');
  if (sp?.history?.length > 100) {
    const h = sp.history;
    const changes = h.slice(1).map((p, i) => ({ date: p.date, pct: (p.value / h[i].value - 1) * 100 }));
    const today = spy.movePct;
    const bigger = [...changes].reverse().find((c) => (today < 0 ? c.pct <= today : c.pct >= today));
    const word = today < 0 ? 'drop' : 'gain';
    const gap = bigger ? changes.length - changes.indexOf(bigger) : changes.length;
    if (!bigger || gap >= 15) {
      const phrase = bigger ? `biggest one-day ${word} since ${plainDay(bigger.date)}, ${bigger.date.slice(0, 4)}` : `biggest one-day ${word} in more than a year`;
      add({ id: 'rank.SPY', kind: 'stat', group: 'significance', label: `S&P 500: ${when.open ? 'on track for its ' : 'its '}${phrase}`, display: bigger ? plainDay(bigger.date) : 'more than a year', meaning: `${when.open ? 'If it closes here, ' : ''}the S&P 500's ${phrase} (today's move from SPY; past days from S&P 500 index closes)`, asOf: spy.asOf, source: 'SPY (Finnhub) and S&P 500 closes (FRED)', sourceName: 'FRED' });
    }
  }

  // 5. What to watch: company results due in the next few days.
  const horizon = new Date(`${when.ymd}T12:00:00Z`).getTime() + 4 * 864e5;
  const weekday = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${ymd}T12:00:00Z`));
  const timing = { bmo: 'before the market opens', amc: 'after the market closes' };
  const upcoming = (earnings?.items || [])
    .filter((e) => e.date >= when.ymd && new Date(`${e.date}T12:00:00Z`).getTime() <= horizon)
    .filter((e) => !(e.date === when.ymd && (e.hour === 'bmo' || !when.open) && e.hour !== 'amc')) // already reported
    .sort((a, b) => (a.date + (a.hour === 'bmo' ? 0 : 1)).localeCompare(b.date + (b.hour === 'bmo' ? 0 : 1)))
    .slice(0, 4);
  for (const e of upcoming) {
    const day = e.date === when.ymd ? 'today' : weekday(e.date);
    add({ id: `cal.${e.symbol}`, kind: 'event', group: 'calendar', label: `${nameOf(e.symbol)} earnings`, display: `${day}${timing[e.hour] ? `, ${timing[e.hour]}` : ''}`, meaning: `${nameOf(e.symbol)} (${e.symbol}) reports quarterly results ${day}${timing[e.hour] ? ` ${timing[e.hour]}` : ''}`, asOf: earnings.fetchedAt, source: 'Finnhub earnings calendar', sourceName: 'Finnhub' });
  }

  // 6. Today's stories from the briefing, best first. Their stock moves become facts too.
  const stories = [];
  const seen = new Set();
  const todays = (feed?.batches || []).filter((b) => dayKey(b.at) === when.ymd).flatMap((b) => b.items);
  for (const it of todays.sort((a, b) => (b.impact?.score || 0) - (a.impact?.score || 0))) {
    if (stories.length >= 6 || seen.has(it.dedupeKey || it.id)) continue;
    seen.add(it.dedupeKey || it.id);
    const id = `story${stories.length + 1}`;
    const sources = (it.sources || []).filter((s) => s?.name && /^https?:\/\//.test(s.url || '') && !/finnhub\.io/.test(s.url)).slice(0, 3);
    const report = it.earningsReport;
    const reportText = report ? [...(report.results || []).map((r) => `${r.metric}: ${r.actual} vs ${r.estimate} expected (${r.verdict})`), report.guidance?.summary || ''].join('. ') : '';
    stories.push({ id, kind: it.kind, headline: it.headline, what: it.what, bigPicture: String(it.bigPicture || '').replace(/^Interpretation:\s*/, ''), report: reportText, sources, numbers: numbersIn([it.headline, it.what, reportText].join(' ')) });
    for (const t of (it.tickers || []).slice(0, 4)) {
      if (t.movePct == null) continue;
      add({ id: `${id}.${t.symbol}`, kind: 'move', group: 'story', label: nameOf(t.symbol), display: signed(t.movePct), move: t.movePct, meaning: `${nameOf(t.symbol)} (${t.symbol}) stock, ${t.asOf || 'today'}`, asOf: t.asOf || it.createdAt, source: `${sources[0]?.name || 'Briefing'} via the briefing`, sourceName: sources[0]?.name || 'Briefing' });
    }
  }

  return {
    when,
    span,
    facts,
    stories,
    ticker: [...rows.values()].map((r) => ({ label: r.label, value: signed(r.movePct), move: r.movePct })),
  };
}
