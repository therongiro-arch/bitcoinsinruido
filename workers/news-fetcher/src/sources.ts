// RSS feeds aggregated by the BitcoinNews Worker.
// Each source can declare a minimum score (HN, Reddit) or a topical filter.

export interface SourceConfig {
  name: string;
  url: string;
  lang: 'en' | 'es';
  topicalFilter?: boolean; // require "bitcoin"/"btc" in title to keep
  minScore?: number;       // for HN / Reddit feeds
}

export const SOURCES: SourceConfig[] = [
  {
    name: 'Bitcoin Magazine',
    url: 'https://bitcoinmagazine.com/feed',
    lang: 'en',
  },
  {
    name: 'Bitcoinist',
    url: 'https://bitcoinist.com/feed/',
    lang: 'en',
    topicalFilter: true,
  },
  {
    name: 'Bitcoin Optech',
    url: 'https://bitcoinops.org/feed.xml',
    lang: 'en',
  },
  {
    name: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml',
    lang: 'en',
    topicalFilter: true,
  },
  {
    name: 'Cointelegraph',
    url: 'https://cointelegraph.com/rss/tag/bitcoin',
    lang: 'en',
  },
  {
    name: 'The Block',
    url: 'https://www.theblock.co/rss.xml',
    lang: 'en',
    topicalFilter: true,
  },
  {
    name: 'r/Bitcoin',
    url: 'https://www.reddit.com/r/Bitcoin/top.rss?t=day',
    lang: 'en',
    minScore: 500,
  },
  {
    name: 'Hacker News',
    url: 'https://hnrss.org/newest?q=bitcoin&points=50',
    lang: 'en',
    minScore: 50,
  },
];

export const BITCOIN_TOPICAL_REGEX = /\b(bitcoin|btc|satoshi|lightning|taproot|bitvm|halving|mempool|nakamoto)\b/i;
