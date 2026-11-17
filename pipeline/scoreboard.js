// Index scoreboard reel. Built entirely from the scraped numbers with a fixed script: no AI call, no image cost.
// Returns a fact sheet (every number with its source and date) and the scenes that use it.
import { pct, signed, num, trim, move, etParts, plainDay } from './format.js';

const SECTOR_SYMBOLS = ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];

export function buildScoreboard({ indices, macro, sectors }) {
  const rows = new Map((indices?.rows || []).filter((r) => !r.error && !r.stale && r.movePct != null).map((r) => [r.symbol, r]));
  const spy = rows.get('SPY');
  if (!spy) return null; // no fresh S&P 500 number, so no reel
  const series = new Map((macro?.series || []).filter((s) => s.value != null && !s.stale).map((s) => [s.key, s]));

  const when = etParts(spy.asOf);
  const open = when.hour24 < 16; // quotes stamped before 4 pm ET are still intraday
  const span = open ? 'so far today' : 'today';
  const facts = [];
  const fact = (label, display, source, asOf) => (facts.push({ label, display, source, asOf }), display);

  // ---- Scene 1: headline, S&P 500 ----
  fact('Date', when.monthDay, 'Finnhub quote time', spy.asOf);
  fact('S&P 500 move', pct(spy.movePct), spy.tracks, spy.asOf);
  const sp = series.get('SP500');
  const spark = sp ? sp.history.slice(-60).map((h) => h.value) : [];
  if (sp) fact('S&P 500 index close', num(sp.value), 'FRED SP500', sp.date);
  const tone = Math.abs(spy.movePct) < 0.25 ? 'little changed' : `${Math.abs(spy.movePct) >= 1.5 ? 'sharply ' : ''}${spy.movePct > 0 ? 'higher' : 'lower'}`;
  const scenes = [
    {
      type: 'hero',
      narration: `Your market scoreboard for ${when.weekday}, ${when.monthDay}. Stocks are ${tone} ${span}. The S&P 500 is ${move(spy.movePct)}.`,
      visual: {
        label: 'S&P 500',
        value: signed(spy.movePct),
        sign: Math.sign(spy.movePct),
        sub: `${spy.tracks}, ${span}`,
        spark,
        sparkLabel: sp ? `S&P 500 index, last ${spark.length} daily closes through ${plainDay(sp.date)}: ${num(sp.value)}` : '',
      },
    },
  ];

  // ---- Scene 2: the other stock indexes ----
  const stockRows = ['SPY', 'QQQ', 'DIA', 'IWM'].map((s) => rows.get(s)).filter(Boolean);
  for (const r of stockRows) fact(`${r.label} move`, pct(r.movePct), r.tracks, r.asOf);
  const others = stockRows.filter((r) => r.symbol !== 'SPY');
  if (others.length) {
    const say = { QQQ: 'The Nasdaq 100 is', DIA: 'the Dow is', IWM: 'and the small-company Russell 2000 is' };
    scenes.push({
      type: 'bars',
      narration: others.map((r) => `${say[r.symbol]} ${move(r.movePct)}`).join(', ').replace(/^t/, 'T').replace(/^a/, 'A') + '.',
      visual: { heading: 'Stocks', note: `Funds that track each index, ${span}`, rows: stockRows.map((r) => ({ label: r.label, sub: r.symbol, value: signed(r.movePct), move: r.movePct })) },
    });
  }

  // ---- Scene 3: fear gauge and rates (official closes from FRED, each with its own date) ----
  const vix = series.get('VIXCLS');
  const ten = series.get('DGS10');
  const curve = series.get('T10Y2Y');
  const tiles = [];
  const parts = [];
  if (vix) {
    tiles.push({ label: 'VIX', hint: 'fear gauge', value: fact('VIX close', trim(vix.value), 'FRED VIXCLS', vix.date), prev: vix.previous ? `prior ${trim(vix.previous.value)}` : '', date: plainDay(vix.date) });
    if (vix.previous) fact('VIX prior close', trim(vix.previous.value), 'FRED VIXCLS', vix.previous.date);
    parts.push(`the VIX fear gauge last closed at ${trim(vix.value)}`);
  }
  if (ten) {
    tiles.push({ label: '10-year yield', hint: 'Treasury', value: `${fact('10-year yield', trim(ten.value), 'FRED DGS10', ten.date)}%`, prev: ten.previous ? `prior ${trim(ten.previous.value)}%` : '', date: plainDay(ten.date) });
    if (ten.previous) fact('10-year yield prior', trim(ten.previous.value), 'FRED DGS10', ten.previous.date);
    parts.push(`the 10-year Treasury yield at ${trim(ten.value)}%`);
  }
  if (curve) {
    tiles.push({ label: 'Yield curve', hint: '10-year minus 2-year', value: `${fact('Yield curve', trim(curve.value), 'FRED T10Y2Y', curve.date)} pts`, prev: curve.previous ? `prior ${trim(curve.previous.value)}` : '', date: plainDay(curve.date) });
    if (curve.previous) fact('Yield curve prior', trim(curve.previous.value), 'FRED T10Y2Y', curve.previous.date);
  }
  if (parts.length) {
    const joined = parts.join(', and ');
    scenes.push({ type: 'stats', narration: `${joined[0].toUpperCase()}${joined.slice(1)}.`, visual: { heading: 'Fear and rates', note: 'Latest official closes (FRED)', tiles } });
  }

  // ---- Scene 4: oil, gold, dollar, bitcoin ----
  const macroRows = ['USO', 'GLD', 'UUP', 'BINANCE:BTCUSDT'].map((s) => rows.get(s)).filter(Boolean);
  if (macroRows.length) {
    for (const r of macroRows) fact(`${r.label} move`, pct(r.movePct), r.tracks, r.asOf);
    const name = { USO: 'Oil', GLD: 'gold', UUP: 'the dollar', 'BINANCE:BTCUSDT': 'Bitcoin' };
    const list = macroRows.map((r) => `${name[r.symbol]} is ${move(r.movePct)}`);
    scenes.push({
      type: 'bars',
      narration: (list.length > 1 ? `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}` : list[0]).replace(/^g/, 'G').replace(/^t/, 'T') + '.',
      visual: { heading: 'Oil, gold, dollar, Bitcoin', note: `Tracking funds ${span}; Bitcoin since midnight UTC`, rows: macroRows.map((r) => ({ label: r.label, sub: r.symbol.replace('BINANCE:BTCUSDT', 'BTC'), value: signed(r.movePct), move: r.movePct })) },
    });
  }

  // ---- Scene 5: sectors, best to worst (the "rank the sectors" quiz idea) ----
  const names = new Map((sectors?.rows || []).map((r) => [r.symbol, r.name]));
  const sec = SECTOR_SYMBOLS.map((s) => ({ symbol: s, name: names.get(s) || s, ...(sectors?.today?.[s] || {}) }))
    .filter((s) => s.movePct != null && s.asOf && etParts(s.asOf).ymd === when.ymd) // same trading day only
    .sort((a, b) => b.movePct - a.movePct);
  if (sec.length >= 6) {
    for (const s of sec) fact(`${s.name} sector move`, pct(s.movePct), `SPDR ${s.symbol} (Finnhub)`, s.asOf);
    const best = sec[0];
    const worst = sec.at(-1);
    const up = sec.filter((s) => s.movePct > 0).length;
    fact('Sectors higher', String(up), 'count of sector funds above zero', best.asOf);
    fact('Sectors total', String(sec.length), 'sector funds with a quote', best.asOf);
    scenes.push({
      type: 'bars',
      narration: `${up} of ${sec.length} sectors are higher. Best: ${best.name}, ${move(best.movePct)}. Worst: ${worst.name}, ${move(worst.movePct)}.`,
      visual: { heading: 'Sectors, best to worst', note: `SPDR sector funds, ${span}`, compact: true, rows: sec.map((s) => ({ label: s.name, sub: s.symbol, value: signed(s.movePct), move: s.movePct })) },
    });
  }

  // ---- Scene 6: sign-off ----
  scenes.push({
    type: 'outro',
    narration: 'Swipe up for the stories behind the moves.',
    visual: { lines: ['That is your scoreboard', 'Swipe up for the stories'] },
  });

  return {
    id: `scoreboard-${when.ymd}-${open ? 'midday' : 'close'}`,
    kind: 'scoreboard',
    title: 'Market Scoreboard',
    dateLabel: `${when.weekday}, ${when.monthDay}`,
    footer: { source: 'Sources: Finnhub quotes, FRED', asOf: `As of ${when.time} ET, ${when.shortDay}` },
    ticker: (indices.rows || []).filter((r) => rows.has(r.symbol)).map((r) => ({ label: r.label, value: signed(r.movePct), move: r.movePct })),
    sources: [{ name: 'Finnhub', url: 'https://finnhub.io' }, { name: 'FRED', url: 'https://fred.stlouisfed.org' }],
    facts,
    scenes,
  };
}
