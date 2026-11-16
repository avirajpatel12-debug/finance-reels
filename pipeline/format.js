// One place that turns raw numbers into the exact text shown and spoken, so the accuracy check can compare like with like.
const ET = 'America/New_York';
export const pct = (x) => `${Math.abs(x).toFixed(2)}%`; // 1.85%
export const signed = (x) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x).toFixed(2)}%`; // -1.85%
export const num = (x, d = 2) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const trim = (x, d = 2) => String(Number(Number(x).toFixed(d))); // 19.30 -> 19.3
export const dir = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
export const move = (x) => (x === 0 ? 'flat' : `${dir(x)} ${pct(x)}`); // "down 1.85%"

export const etParts = (iso) => {
  const d = new Date(iso);
  const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: ET, ...opts }).format(d);
  return {
    weekday: f({ weekday: 'long' }),
    monthDay: f({ month: 'long', day: 'numeric' }),
    shortDay: f({ month: 'short', day: 'numeric' }),
    time: f({ hour: 'numeric', minute: '2-digit' }),
    hour24: Number(f({ hour: 'numeric', hour12: false })) % 24,
    ymd: f({ year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'),
  };
};
// FRED dates are plain calendar dates (2026-11-13); format without shifting time zones.
export const plainDay = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));
