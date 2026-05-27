// Curated catalogue of well-known Bitcoin mining nodes — both the pools
// (where block-publishing decisions happen) and the industrial farms /
// state-led operations (where the hashing physically lives).
//
// Sources used for the picks below:
// - Pool data: mempool.space/mining, btc.com/pool, Hashrate Index pool stats
// - Farm locations: SEC filings (10-K/10-Q) of public miners (Marathon,
//   Riot, CleanSpark, Core Scientific, IREN, TeraWulf, Hut 8, Bitfarms),
//   press releases from sovereign programs (Bhutan, El Salvador, Ethiopia)
// - Coordinates are HQ city centres or the principal operational site
//   when a company runs from multiple facilities.
//
// Last review: 2026-Q2.

export type MiningKind = 'pool' | 'farm' | 'state';

export interface MiningLocation {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  kind: MiningKind;
  /** Optional short context shown in the hover tooltip. */
  notes?: string;
}

export const MINING_LOCATIONS: MiningLocation[] = [
  // === Pools (block-publishing layer) ===
  { id: 'foundry-usa',  name: 'Foundry USA Pool',   city: 'Rochester, NY', country: 'EE.UU.',    lat: 43.1566, lng: -77.6088, kind: 'pool',  notes: 'Mayor pool por hashrate. Filial de DCG.' },
  { id: 'antpool',      name: 'AntPool',            city: 'Pekín',         country: 'China',     lat: 39.9042, lng: 116.4074, kind: 'pool',  notes: 'Operado por Bitmain.' },
  { id: 'f2pool',       name: 'F2Pool',             city: 'Pekín',         country: 'China',     lat: 39.9142, lng: 116.4174, kind: 'pool',  notes: 'Fundado en 2013 ("Discus Fish").' },
  { id: 'viabtc',       name: 'ViaBTC',             city: 'Hong Kong',     country: 'HK',        lat: 22.3193, lng: 114.1694, kind: 'pool' },
  { id: 'binance-pool', name: 'Binance Pool',       city: 'Singapur',      country: 'Singapur',  lat: 1.3521,  lng: 103.8198, kind: 'pool' },
  { id: 'braiins',      name: 'Braiins Pool',       city: 'Praga',         country: 'Chequia',   lat: 50.0755, lng: 14.4378,  kind: 'pool',  notes: 'Antes Slush Pool. El primer pool de Bitcoin (2010).' },
  { id: 'mara-pool',    name: 'MARA Pool',          city: 'Fort Lauderdale', country: 'EE.UU.',  lat: 26.1124, lng: -80.1273, kind: 'pool',  notes: 'Pool propio de Marathon Digital.' },
  { id: 'sbi-crypto',   name: 'SBI Crypto',         city: 'Tokio',         country: 'Japón',     lat: 35.6762, lng: 139.6503, kind: 'pool' },
  { id: 'ocean',        name: 'OCEAN',              city: 'Cheyenne, WY',  country: 'EE.UU.',    lat: 41.1400, lng: -104.8202, kind: 'pool', notes: 'Pool sin custodia impulsado por Jack Dorsey y Luke Dashjr.' },
  { id: 'luxor',        name: 'Luxor Technology',   city: 'Cheyenne, WY',  country: 'EE.UU.',    lat: 41.1500, lng: -104.8302, kind: 'pool' },

  // === Industrial farms ===
  { id: 'riot',         name: 'Riot Platforms',     city: 'Rockdale, TX',  country: 'EE.UU.',    lat: 30.6552, lng: -97.0014, kind: 'farm',  notes: 'Granja de Rockdale — de las mayores del mundo (1+ GW).' },
  { id: 'core-sci',     name: 'Core Scientific',    city: 'Austin, TX',    country: 'EE.UU.',    lat: 30.2672, lng: -97.7431, kind: 'farm' },
  { id: 'cleanspark',   name: 'CleanSpark',         city: 'Henderson, NV', country: 'EE.UU.',    lat: 36.0395, lng: -114.9817, kind: 'farm' },
  { id: 'hut8',         name: 'Hut 8',              city: 'Medicine Hat, AB', country: 'Canadá', lat: 50.0405, lng: -110.6764, kind: 'farm', notes: 'Operación canadiense pionera.' },
  { id: 'iren',         name: 'IREN',               city: 'Childress, TX', country: 'EE.UU.',    lat: 34.4259, lng: -100.2040, kind: 'farm', notes: 'Antes Iris Energy. 100 % renovable.' },
  { id: 'terawulf',     name: 'TeraWulf',           city: 'Lake Mariner, NY', country: 'EE.UU.', lat: 43.3014, lng: -78.7236, kind: 'farm',  notes: 'Mix de nuclear e hidroeléctrica.' },
  { id: 'bitfarms',     name: 'Bitfarms',           city: 'Villarrica',    country: 'Paraguay',  lat: -25.7833, lng: -56.4333, kind: 'farm', notes: 'Aprovecha excedente de Itaipú.' },

  // === State-led / sovereign mining ===
  { id: 'bhutan-mining',  name: 'Druk Holdings',         city: 'Thimphu',    country: 'Bután',       lat: 27.4728, lng: 89.6390,  kind: 'state', notes: 'Minería estatal con hidroeléctrica del Himalaya.' },
  { id: 'sv-volcano',     name: 'Volcano Energy',        city: 'Berlín',     country: 'El Salvador', lat: 13.4933, lng: -88.5331, kind: 'state', notes: 'Energía geotérmica del Tecapa.' },
  { id: 'bitriver',       name: 'BitRiver',              city: 'Bratsk',     country: 'Rusia',       lat: 56.1326, lng: 101.6140, kind: 'farm',  notes: 'Hidroeléctrica siberiana.' },
  { id: 'ethiopia',       name: 'Minería etíope',        city: 'Adís Abeba', country: 'Etiopía',     lat: 9.0320,  lng: 38.7423,  kind: 'state', notes: 'Crecimiento desde 2024 con la presa GERD.' },
  { id: 'kazakhstan',     name: 'Kazajistán mining hub', city: 'Pavlodar',   country: 'Kazajistán',  lat: 52.2873, lng: 76.9674,  kind: 'state', notes: 'Receptor de la migración china de 2021.' },
];

export const MINING_KIND_LABEL: Record<MiningKind, string> = {
  pool: 'Pool',
  farm: 'Granja',
  state: 'Minería estatal',
};
