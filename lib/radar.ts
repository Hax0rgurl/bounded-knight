import { farmPlan, routes } from './plans.ts';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

const hasTokenRecord = (p: Protocol) => Boolean(p.symbol || p.gecko_id || (p.mcap_usd ?? 0) > 0);
const structural = /^(Bridge|Canonical Bridge|Cross Chain Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX|Anchor BTC|Decentralized BTC)$/;
const derivedName = /\b(wrapped|staked|staking)\b|\s[vV]\d+(\.\d+)?$|\s\d+\.\d+$|^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

function quantile(sorted: number[], p: number) {
  const i = (sorted.length - 1) * p;
  return sorted[Math.floor(i)] + (i % 1) * (sorted[Math.ceil(i)] - sorted[Math.floor(i)]);
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const byLogRatio = (a: Peer, b: Peer) => a.logRatio - b.logRatio || a.protocol.slug.localeCompare(b.protocol.slug);
type Peer = { protocol: Protocol; logRatio: number };

function valueProtocol(p: Protocol, peers: Peer[], date: string) {
  const same = peers.filter(peer => p.category !== null && peer.protocol.category === p.category);
  const family = routes[p.category ?? ''];
  const related = peers.filter(peer => family && routes[peer.protocol.category ?? ''] === family);
  const local = same.length >= 4 ? same : related.length >= 4 ? related : same;
  const scope = local.length === 0 ? 'Market universe' : local === same ? (p.category ?? 'Unclassified') : family;
  const close = (pool: Peer[], limit: number) => [...pool].sort((a, b) =>
    Math.abs(Math.log(a.protocol.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.protocol.tvl_usd / p.tvl_usd)) ||
    a.protocol.slug.localeCompare(b.protocol.slug)
  ).slice(0, limit).sort(byLogRatio);
  const comparable = close(local, 16);
  const background = close(peers.filter(peer => !comparable.includes(peer)), 32);
  const broad = (background.length ? background : close(peers, 32)).map(peer => peer.logRatio);
  const narrow = comparable.map(peer => peer.logRatio);
  const weight = narrow.length / (narrow.length + 6);
  function blend(q: number) {
    return quantile(broad, q) * (1 - weight) + (narrow.length ? quantile(narrow, q) * weight : 0);
  }

  const base = Math.exp(blend(0.5));
  const growth = 1 + clamp(p.change_7d ?? 0, -30, 30) / 200;
  const elapsed = (Date.parse(date) - Date.parse(p.listed_at ?? '')) / 86_400_000;
  const days = Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed) : null;
  const seasoning = days === null ? 1 : 0.9 + 0.2 * Math.min(days, 730) / 730;
  const center = p.tvl_usd * base * growth * seasoning;
  const inputPenalty = (p.change_7d === null ? 0.15 : 0) + (days === null ? 0.15 : 0);
  const spread = 0.25 * (1 - weight) + inputPenalty;
  const round = (n: number) => Math.max(1, Math.round(n));
  const sample = comparable.length ? comparable : close(peers, 16);
  return {
    implied_value_usd: round(center),
    low: round(p.tvl_usd * Math.exp(blend(0.2) - spread) * growth * seasoning),
    high: round(p.tvl_usd * Math.exp(blend(0.8) + spread) * growth * seasoning),
    scope, weight, base, growth, seasoning, days,
    localCount: narrow.length, marketCount: broad.length,
    peers: sample.map(({ protocol, logRatio }) => ({
      name: protocol.name, tvl: protocol.tvl_usd, ratio: Math.exp(logRatio),
    })),
  };
}

export function buildRadar(snapshot: Snapshot) {
  const watchlist = new Set(snapshot.watchlist);
  const reference = snapshot.protocols.filter(hasTokenRecord);
  const peers = reference
    .filter(p => p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0 && !structural.test(p.category ?? ''))
    .map(protocol => ({ protocol, logRatio: Math.log(protocol.mcap_usd! / protocol.tvl_usd) }));
  if (!peers.length) throw new Error('Snapshot has no eligible observed market-cap peers');

  const candidates = snapshot.protocols.filter(p => watchlist.has(p.slug) ||
    (!hasTokenRecord(p) && !structural.test(p.category ?? '') && !derivedName.test(p.name)));
  const rows = candidates.map(p => ({
    ...p, ...valueProtocol(p, peers.filter(peer => peer.protocol.slug !== p.slug), snapshot.as_of),
    watchlist: watchlist.has(p.slug), route: routes[p.category ?? ''] ?? 'Research', ...farmPlan(p),
  })).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug))
    .map((p, index) => ({ ...p, rank: index + 1 }));
  if (rows.length < 100 || snapshot.watchlist.some(slug => !rows.some(row => row.slug === slug))) {
    throw new Error('Snapshot cannot satisfy the minimum board size and watchlist coverage');
  }
  return {
    rows, reference, asOf: snapshot.as_of, source: snapshot.source,
    floor: snapshot.floor_usd, watchlistCount: watchlist.size, peerCount: peers.length,
  };
}
