// Accuracy gate. Every number that is spoken or captioned must be one of the numbers on the reel's fact sheet,
// written exactly the same way. Names that contain digits (S&P 500, 10-year) are ignored.
const NAMES = /S&P 500|Nasdaq 100|Russell 2000|10-year|2-year|30-year|3-month/g;

export function numbersIn(text) {
  return (String(text).replace(NAMES, ' ').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''));
}

export function verifyScript(scenes, allowed) {
  const ok = new Set([...allowed].map((n) => String(n).replace(/,/g, '')));
  const problems = [];
  scenes.forEach((s, i) => {
    for (const n of numbersIn(s.narration)) if (!ok.has(n)) problems.push(`scene ${i + 1}: "${n}" is not on the fact sheet`);
  });
  return problems;
}
