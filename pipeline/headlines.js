// Today's market headlines from public newsroom feeds (RSS, the feeds newsrooms publish for apps and readers).
// Used only so the AI can say WHY the market moved, in its own words, with a link to each source article.
// Nothing from these feeds is copied into a reel.
const FEEDS = [
  ['WSJ', 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['CNBC', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'],
];
const WINDOW_HOURS = 16;
const ABOUT_MARKETS = /stock|shares|dow|s&p|nasdaq|russell|market|wall street|yield|treasur|bond|fed\b|rate|inflation|oil|dollar|vix|fear gauge|earnings|sell-?off|rally|investor|trader/i;

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const tag = (xml, t) => decode((xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);

export async function todaysHeadlines(now = Date.now(), max = 30) {
  const out = [];
  await Promise.all(
    FEEDS.map(async ([outlet, url]) => {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 20_000);
        const xml = await (await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal RSS reader)' } })).text();
        clearTimeout(timer);
        for (const raw of xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []) {
          const at = new Date(tag(raw, 'pubDate'));
          const title = tag(raw, 'title');
          const summary = tag(raw, 'description').slice(0, 220);
          const link = tag(raw, 'link').split('?')[0];
          if (!title || !/^https?:\/\//.test(link) || !(now - at < WINDOW_HOURS * 3600e3) || at > now + 3600e3) continue;
          if (!ABOUT_MARKETS.test(`${title} ${summary}`)) continue;
          out.push({ outlet, title, summary, url: link, at: at.toISOString() });
        }
      } catch {
        /* one feed being down is fine */
      }
    }),
  );
  const seen = new Set();
  return out
    .filter((h) => !seen.has(h.url) && seen.add(h.url))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, max)
    .map((h, i) => ({ id: `h${i + 1}`, ...h }));
}
