// "Sin Ruido" filter: reject obvious noise from aggregated headlines.

const PRICE_PATTERNS = [
  /\$\s?\d{1,3}(,?\d{3})*(\.\d+)?\s?k?\b/i,
  /\bprice prediction\b/i,
  /\bto the moon\b/i,
  /\bmoonshot\b/i,
  /\ball[\s-]?time high\b/i,
  /\bnuevo m[áa]ximo\b/i,
  /\bcrash\b/i,
  /\b(dump|pump)\b/i,
  /\bwhale alert\b/i,
  /\bskyrocket(ed|s|ing)?\b/i,
  /\b(soar|surge|plunge|tank|rally)(ed|s|ing)?\b/i,
  /\bstuck\s+in\s+(downtrend|uptrend|range)\b/i,
  /\bbreakout\b/i,
  /\bmillionaire\b/i,
  /\b(target|forecast)\s+\$\d/i,
  /\b\d{1,3}%\s+(gain|loss|drop|rise|jump|surge)/i,
];

const CLICKBAIT_PATTERNS = [
  /you won['']?t believe/i,
  /\bshocking\b/i,
  /este truco/i,
  /\bmillonario\b/i,
  /\bhizo rico\b/i,
  /\bnumber \d+ will/i,
  /\bsecret\s+(of|to|behind)\b/i,
  /\bgenius (move|investor)\b/i,
];

// Tickers commonly used to hype shitcoin spam. Title that mentions 2+ of these
// alongside BTC is usually pump-list content rather than real news.
const SHITCOIN_TICKERS = [
  'eth', 'sol', 'xrp', 'ada', 'doge', 'shib', 'pepe', 'bnb', 'matic', 'avax',
  'dot', 'link', 'trx', 'ltc', 'bch', 'near', 'apt', 'arb', 'op',
];

export interface FilterDecision {
  keep: boolean;
  reason?: string;
}

export function decide(title: string): FilterDecision {
  const t = title.trim();
  if (t.length < 8) return { keep: false, reason: 'title too short' };

  for (const p of PRICE_PATTERNS) {
    if (p.test(t)) return { keep: false, reason: `price-pattern:${p.source}` };
  }
  for (const p of CLICKBAIT_PATTERNS) {
    if (p.test(t)) return { keep: false, reason: `clickbait:${p.source}` };
  }

  // Count shitcoin tickers as whole words
  const lower = t.toLowerCase();
  const hits = SHITCOIN_TICKERS.filter((tk) => new RegExp(`\\b${tk}\\b`, 'i').test(lower));
  if (hits.length >= 2) {
    return { keep: false, reason: `shitcoin-list:${hits.join(',')}` };
  }

  return { keep: true };
}

// Extract simple tags from the title to help client-side filtering.
const TAG_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: 'lightning', re: /\blightning\b/i },
  { tag: 'taproot', re: /\btaproot\b/i },
  { tag: 'bitvm', re: /\bbitvm\b/i },
  { tag: 'mining', re: /\b(mining|hashrate|miner)\b/i },
  { tag: 'regulation', re: /\b(sec|cftc|regulation|regulator|law|legal)\b/i },
  { tag: 'L2', re: /\b(rollup|zk|layer\s?2|sidechain)\b/i },
  { tag: 'security', re: /\b(hack|exploit|vulnerability|cuant|quantum)\b/i },
  { tag: 'wallet', re: /\bwallet\b/i },
  { tag: 'etf', re: /\betf\b/i },
];

export function extractTags(title: string): string[] {
  const out: string[] = [];
  for (const r of TAG_RULES) if (r.re.test(title)) out.push(r.tag);
  return out;
}
