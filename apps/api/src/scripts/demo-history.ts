import { fromThousandths, toThousandths } from '@monaco/domain';

/*
 * The demo history as a plan (SP4 spec, "Seed demo"): pure data, no database. `demo-inventory-seed`
 * writes it through the catalog and inventory use cases and RecordSale. Deterministic: a seeded PRNG,
 * dates relative to "today" in the tenant time zone and UUIDv7 ids built from each document's
 * `occurredAt` plus PRNG bits, so two runs on the same day plan the same documents with the same ids.
 * The planner keeps the stock of every pair and never plans a line the pair cannot cover, so the
 * ledger (which refuses negative stock anyway) never sees a shortage.
 */

/** Index of a demo location in `seedDemo`'s list: 0 is P1, 1 is P2. */
export type LocationIndex = 0 | 1;
export const DEMO_LOCATION_COUNT = 2;

export interface DemoProduct {
  readonly key: string;
  readonly name: string;
  readonly unitOfMeasure: 'ud' | 'kg' | 'litro' | 'caja';
  readonly category: string;
  /** Minor units (CUP cents). */
  readonly cost: number;
  readonly cash: number;
  readonly transfer: number;
  readonly lowStockThreshold: number;
  /** Relative weight in the sales mix; 0 = never sold (stagnant, for the inventory health panel). */
  readonly demand: number;
  /** Not restocked in the last two weeks: ends near or under its threshold. */
  readonly lowStock?: boolean;
  /** Expiration date this many days after the first seed (near expiration in the health panel). */
  readonly expiresInDays?: number;
}

/** ~40 products in the 8 `CATEGORIES` of `@monaco/domain`, all in CUP. The first five are the SP3 demo catalog. */
export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  { key: 'rice', name: 'Arroz', unitOfMeasure: 'kg', category: 'Granos', cost: 22000, cash: 25000, transfer: 26000, lowStockThreshold: 10, demand: 10 },
  { key: 'beans', name: 'Frijoles negros', unitOfMeasure: 'kg', category: 'Granos', cost: 30000, cash: 35000, transfer: 36500, lowStockThreshold: 6, demand: 8 },
  { key: 'soda', name: 'Refresco de cola 1.5 L', unitOfMeasure: 'ud', category: 'Bebidas', cost: 28000, cash: 35000, transfer: 36000, lowStockThreshold: 12, demand: 9 },
  { key: 'milk', name: 'Leche en polvo 1 kg', unitOfMeasure: 'ud', category: 'Lácteos', cost: 180000, cash: 220000, transfer: 230000, lowStockThreshold: 6, demand: 5 },
  { key: 'detergent', name: 'Detergente 1 kg', unitOfMeasure: 'ud', category: 'Limpieza', cost: 45000, cash: 55000, transfer: 57000, lowStockThreshold: 4, demand: 4 },
  { key: 'sugar', name: 'Azúcar blanca', unitOfMeasure: 'kg', category: 'Granos', cost: 18000, cash: 21000, transfer: 22000, lowStockThreshold: 8, demand: 7 },
  { key: 'flour', name: 'Harina de trigo', unitOfMeasure: 'kg', category: 'Granos', cost: 20000, cash: 24000, transfer: 25000, lowStockThreshold: 5, demand: 4 },
  { key: 'pasta', name: 'Espaguetis 500 g', unitOfMeasure: 'ud', category: 'Granos', cost: 15000, cash: 18000, transfer: 19000, lowStockThreshold: 10, demand: 7 },
  { key: 'lentils', name: 'Lentejas', unitOfMeasure: 'kg', category: 'Granos', cost: 32000, cash: 38000, transfer: 39500, lowStockThreshold: 4, demand: 3 },
  { key: 'water', name: 'Agua mineral 1.5 L', unitOfMeasure: 'ud', category: 'Bebidas', cost: 12000, cash: 15000, transfer: 16000, lowStockThreshold: 12, demand: 8 },
  { key: 'beer', name: 'Cerveza en lata', unitOfMeasure: 'ud', category: 'Bebidas', cost: 16000, cash: 20000, transfer: 21000, lowStockThreshold: 24, demand: 10 },
  { key: 'juice', name: 'Jugo de mango 1 L', unitOfMeasure: 'ud', category: 'Bebidas', cost: 22000, cash: 27000, transfer: 28000, lowStockThreshold: 6, demand: 5 },
  { key: 'malt', name: 'Malta', unitOfMeasure: 'ud', category: 'Bebidas', cost: 17000, cash: 21000, transfer: 22000, lowStockThreshold: 12, demand: 6 },
  { key: 'rum', name: 'Ron añejo 700 ml', unitOfMeasure: 'ud', category: 'Bebidas', cost: 150000, cash: 185000, transfer: 192000, lowStockThreshold: 3, demand: 2, lowStock: true },
  { key: 'yogurt', name: 'Yogur natural 1 L', unitOfMeasure: 'ud', category: 'Lácteos', cost: 30000, cash: 37000, transfer: 38500, lowStockThreshold: 6, demand: 4, expiresInDays: 5 },
  { key: 'cheese', name: 'Queso gouda', unitOfMeasure: 'kg', category: 'Lácteos', cost: 250000, cash: 300000, transfer: 312000, lowStockThreshold: 2, demand: 2 },
  { key: 'butter', name: 'Mantequilla 250 g', unitOfMeasure: 'ud', category: 'Lácteos', cost: 45000, cash: 55000, transfer: 57000, lowStockThreshold: 4, demand: 3, expiresInDays: 10 },
  { key: 'mince', name: 'Picadillo de res', unitOfMeasure: 'kg', category: 'Cárnicos', cost: 90000, cash: 110000, transfer: 114000, lowStockThreshold: 5, demand: 4 },
  { key: 'chicken', name: 'Muslos de pollo', unitOfMeasure: 'kg', category: 'Cárnicos', cost: 70000, cash: 85000, transfer: 88000, lowStockThreshold: 10, demand: 8 },
  { key: 'sausages', name: 'Salchichas', unitOfMeasure: 'ud', category: 'Cárnicos', cost: 40000, cash: 48000, transfer: 50000, lowStockThreshold: 8, demand: 6 },
  { key: 'ham', name: 'Jamón de pierna', unitOfMeasure: 'kg', category: 'Cárnicos', cost: 160000, cash: 195000, transfer: 203000, lowStockThreshold: 3, demand: 2, lowStock: true },
  { key: 'eggs', name: 'Huevos (cartón de 30)', unitOfMeasure: 'caja', category: 'Cárnicos', cost: 90000, cash: 110000, transfer: 114000, lowStockThreshold: 5, demand: 6 },
  { key: 'soap', name: 'Jabón de lavar', unitOfMeasure: 'ud', category: 'Limpieza', cost: 8000, cash: 10000, transfer: 10500, lowStockThreshold: 10, demand: 5 },
  { key: 'bleach', name: 'Cloro 1 L', unitOfMeasure: 'litro', category: 'Limpieza', cost: 12000, cash: 15000, transfer: 15500, lowStockThreshold: 6, demand: 3 },
  { key: 'dishwash', name: 'Lavaplatos 500 ml', unitOfMeasure: 'ud', category: 'Limpieza', cost: 18000, cash: 22000, transfer: 23000, lowStockThreshold: 4, demand: 3 },
  { key: 'softener', name: 'Suavizante 1 L', unitOfMeasure: 'ud', category: 'Limpieza', cost: 30000, cash: 36000, transfer: 37500, lowStockThreshold: 3, demand: 0 },
  { key: 'toothpaste', name: 'Pasta dental', unitOfMeasure: 'ud', category: 'Aseo personal', cost: 20000, cash: 25000, transfer: 26000, lowStockThreshold: 6, demand: 4 },
  { key: 'handsoap', name: 'Jabón de tocador', unitOfMeasure: 'ud', category: 'Aseo personal', cost: 9000, cash: 11000, transfer: 11500, lowStockThreshold: 10, demand: 5 },
  { key: 'shampoo', name: 'Champú 400 ml', unitOfMeasure: 'ud', category: 'Aseo personal', cost: 40000, cash: 48000, transfer: 50000, lowStockThreshold: 4, demand: 2 },
  { key: 'deodorant', name: 'Desodorante', unitOfMeasure: 'ud', category: 'Aseo personal', cost: 35000, cash: 43000, transfer: 45000, lowStockThreshold: 4, demand: 2 },
  { key: 'tissue', name: 'Papel higiénico (4 rollos)', unitOfMeasure: 'ud', category: 'Aseo personal', cost: 25000, cash: 30000, transfer: 31000, lowStockThreshold: 8, demand: 5 },
  { key: 'crackers', name: 'Galletas de soda', unitOfMeasure: 'ud', category: 'Snacks', cost: 10000, cash: 13000, transfer: 13500, lowStockThreshold: 12, demand: 7 },
  { key: 'peanuts', name: 'Maní tostado', unitOfMeasure: 'ud', category: 'Snacks', cost: 8000, cash: 10000, transfer: 10500, lowStockThreshold: 10, demand: 6 },
  { key: 'chocolate', name: 'Chocolate 100 g', unitOfMeasure: 'ud', category: 'Snacks', cost: 20000, cash: 25000, transfer: 26000, lowStockThreshold: 6, demand: 4 },
  { key: 'chips', name: 'Papas fritas', unitOfMeasure: 'ud', category: 'Snacks', cost: 12000, cash: 15000, transfer: 15500, lowStockThreshold: 10, demand: 6 },
  { key: 'candy', name: 'Caramelos', unitOfMeasure: 'ud', category: 'Snacks', cost: 6000, cash: 8000, transfer: 8500, lowStockThreshold: 6, demand: 3 },
  { key: 'oil', name: 'Aceite vegetal 1 L', unitOfMeasure: 'litro', category: 'Otros', cost: 60000, cash: 72000, transfer: 75000, lowStockThreshold: 6, demand: 6 },
  { key: 'matches', name: 'Fósforos', unitOfMeasure: 'caja', category: 'Otros', cost: 2000, cash: 3000, transfer: 3200, lowStockThreshold: 20, demand: 3 },
  { key: 'candles', name: 'Velas', unitOfMeasure: 'ud', category: 'Otros', cost: 10000, cash: 13000, transfer: 13500, lowStockThreshold: 5, demand: 0 },
  { key: 'batteries', name: 'Pilas AA (par)', unitOfMeasure: 'ud', category: 'Otros', cost: 25000, cash: 31000, transfer: 32000, lowStockThreshold: 4, demand: 0 },
];

/** Overrides in P2 (the base price applies in P1). */
export const DEMO_LOCATION_PRICES: readonly { readonly location: LocationIndex; readonly product: string; readonly cash: number; readonly transfer: number }[] = [
  { location: 1, product: 'rice', cash: 26000, transfer: 27000 },
  { location: 1, product: 'soda', cash: 37000, transfer: 38000 },
  { location: 1, product: 'beer', cash: 21000, transfer: 22000 },
  { location: 1, product: 'chicken', cash: 88000, transfer: 91000 },
];

/** Fixed PRNG seed of the demo history. */
export const DEMO_HISTORY_SEED = 0x5d4e_3001;

export interface PlannedEntryLine {
  readonly product: string;
  readonly quantity: number;
  readonly unitCost: number;
}
export interface PlannedLine {
  readonly product: string;
  readonly quantity: number;
}
export interface PlannedSaleLine {
  readonly product: string;
  readonly quantity: number;
  /** The applied unit price (minor units): the location's cash or transfer price, or the cost for a cost sale. */
  readonly unitPrice: number;
  readonly paymentMethod: 'cash' | 'transfer';
  readonly isCostSale: boolean;
}

/** A document of the history, in the order it must be written. `occurredAt` is ISO 8601 UTC. */
export type PlannedDocument =
  | { readonly kind: 'entry'; readonly id: string; readonly occurredAt: string; readonly location: LocationIndex; readonly lines: readonly PlannedEntryLine[] }
  | {
      readonly kind: 'exit';
      readonly id: string;
      readonly occurredAt: string;
      readonly location: LocationIndex;
      readonly reason: 'shrinkage' | 'owner_withdrawal';
      readonly lines: readonly PlannedLine[];
    }
  | { readonly kind: 'transfer'; readonly id: string; readonly occurredAt: string; readonly from: LocationIndex; readonly to: LocationIndex; readonly lines: readonly PlannedLine[] }
  | { readonly kind: 'sale'; readonly id: string; readonly occurredAt: string; readonly location: LocationIndex; readonly lines: readonly PlannedSaleLine[] };

export interface HistoryOptions {
  /** Local calendar date of "today" in the tenant zone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly timeZone: string;
  /** Days of history, today included (today is planned in full, D14). */
  readonly historyDays: number;
  readonly seed?: number;
}

// --- PRNG and ids ---------------------------------------------------------------------------

/** mulberry32: small, fast and good enough for demo data. Returns floats in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A valid UUIDv7 (RFC 9562 §5.7) whose timestamp is `ms` and whose 74 random bits come from `rng`. */
export function seededUuidv7(ms: number, rng: () => number): string {
  const bytes = new Uint8Array(16);
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  for (let i = 6; i < 16; i++) bytes[i] = Math.floor(rng() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Calendar in the tenant zone ------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(instant: number, timeZone: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute), s: Number(parts.second) };
}

/** Local calendar date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const { y, m, d } = wallClock(instant.getTime(), timeZone);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `date` plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function offsetMs(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of local `date` at `secondOfDay` in `timeZone`. Demo times are between 07:00 and
 * 21:00, away from the DST jumps (America/Havana changes at midnight), so the wall time exists.
 */
export function zonedInstant(date: string, secondOfDay: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, 0, secondOfDay);
  let instant = wall - offsetMs(wall, timeZone);
  const corrected = offsetMs(instant, timeZone);
  if (wall - corrected !== instant) instant = wall - corrected;
  return instant;
}

// --- The planner ----------------------------------------------------------------------------

/** Sales volume (spec): 25–60 sales a day and location, with a weekly season (Sunday = 0). */
const WEEKDAY_FACTOR = [1.1, 0.85, 0.9, 0.95, 1, 1.15, 1.35] as const;
const BASE_SALES = 38;
const MIN_SALES = 25;
const MAX_SALES = 60;
/** 1–4 lines per sale. */
const LINE_COUNT_WEIGHTS = [0.2, 0.3, 0.3, 0.2] as const;
/** Expected units of a pair per week at full demand weight: weekly entries top every pair up to this. */
const UNITS_PER_DEMAND_WEEK = 9;

const H = 3600;

/** Integer thousandths of stock per pair, so the planner never accumulates float error. */
class StockBook {
  private readonly stock = new Map<string, number>();
  private key(location: LocationIndex, product: string): string {
    return `${location}:${product}`;
  }
  get(location: LocationIndex, product: string): number {
    return this.stock.get(this.key(location, product)) ?? 0;
  }
  add(location: LocationIndex, product: string, quantity: number): void {
    const next = this.get(location, product) + toThousandths(quantity);
    if (next < 0) throw new Error(`Planner bug: negative stock for ${product} in location ${location}`);
    this.stock.set(this.key(location, product), next);
  }
  covers(location: LocationIndex, product: string, quantity: number): boolean {
    return this.get(location, product) >= toThousandths(quantity);
  }
}

function target(product: DemoProduct): number {
  return Math.max(product.lowStockThreshold * 2, Math.ceil(product.demand * UNITS_PER_DEMAND_WEEK * 1.6) + product.lowStockThreshold);
}

function pick<T>(rng: () => number, items: readonly T[], weight: (item: T) => number): T | undefined {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (const item of items) {
    r -= weight(item);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

/** The first `count` items of a Fisher–Yates shuffle driven by `rng` (no repeats). */
function sample<T>(rng: () => number, items: readonly T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}

function lineCount(rng: () => number): number {
  let r = rng();
  for (let i = 0; i < LINE_COUNT_WEIGHTS.length; i++) {
    r -= LINE_COUNT_WEIGHTS[i]!;
    if (r < 0) return i + 1;
  }
  return LINE_COUNT_WEIGHTS.length;
}

function saleQuantity(rng: () => number, product: DemoProduct): number {
  // Weighed goods in quarters of a kilo (0.5–2.5 kg); the rest in whole units, mostly one.
  if (product.unitOfMeasure === 'kg') return 0.5 + Math.floor(rng() * 9) * 0.25;
  const r = rng();
  return r < 0.65 ? 1 : r < 0.9 ? 2 : 3;
}

function priceAt(location: LocationIndex, product: DemoProduct, method: 'cash' | 'transfer'): number {
  const override = DEMO_LOCATION_PRICES.find((p) => p.location === location && p.product === product.key);
  return method === 'cash' ? (override?.cash ?? product.cash) : (override?.transfer ?? product.transfer);
}

/**
 * Plans `historyDays` days ending today (included, in full) in the tenant zone:
 *   - day 1, 07:00: an opening entry per location; every 7 days, 07:30: a restock entry per location
 *     up to each product's target (`lowStock` products skip the last two weeks);
 *   - every 14 days, 08:00: a transfer P1 → P2 of 2–3 products;
 *   - 09:00–20:00: 25–60 sales per location with weekly seasonality, 1–4 lines each;
 *   - after 20:00: occasional shrinkage and owner withdrawals.
 * Documents come in chronological order; a line is planned only when the pair's stock covers it.
 */
export function planDemoHistory(options: HistoryOptions): PlannedDocument[] {
  const { today, timeZone, historyDays } = options;
  if (!Number.isInteger(historyDays) || historyDays < 1) throw new Error('historyDays must be a positive integer');
  const rng = createRng(options.seed ?? DEMO_HISTORY_SEED);
  const stock = new StockBook();
  const docs: PlannedDocument[] = [];
  const at = (date: string, second: number) => zonedInstant(date, second, timeZone);
  const doc = (ms: number) => ({ id: seededUuidv7(ms, rng), occurredAt: new Date(ms).toISOString() });
  const locations: readonly LocationIndex[] = [0, 1];
  const sellable = DEMO_PRODUCTS.filter((p) => p.demand > 0);

  for (let day = 0; day < historyDays; day++) {
    const date = addDays(today, day - (historyDays - 1));
    const daysLeft = historyDays - day;

    // Morning: stock in.
    if (day % 7 === 0) {
      for (const location of locations) {
        const lines: PlannedEntryLine[] = [];
        for (const product of DEMO_PRODUCTS) {
          if (day > 0 && product.lowStock && daysLeft <= 14) continue;
          const missing = fromThousandths(toThousandths(target(product)) - stock.get(location, product.key));
          const quantity = Math.ceil(missing);
          if (quantity <= 0) continue;
          // Suppliers' prices drift a little (±4 %), so the average cost moves.
          const unitCost = Math.round(product.cost * (0.96 + rng() * 0.08));
          lines.push({ product: product.key, quantity, unitCost });
          stock.add(location, product.key, quantity);
        }
        if (lines.length > 0) docs.push({ kind: 'entry', ...doc(at(date, (day === 0 ? 7 : 7.5) * H + location * 60)), location, lines });
      }
    }
    if (day % 14 === 10) {
      const lines: PlannedLine[] = [];
      for (const product of sample(rng, sellable, 2 + Math.floor(rng() * 2))) {
        const available = Math.floor(fromThousandths(stock.get(0, product.key)) / 4);
        const quantity = Math.min(available, 10);
        if (quantity < 1) continue;
        lines.push({ product: product.key, quantity });
        stock.add(0, product.key, -quantity);
        stock.add(1, product.key, quantity);
      }
      if (lines.length > 0) docs.push({ kind: 'transfer', ...doc(at(date, 8 * H)), from: 0, to: 1, lines });
    }

    // Opening hours: sales of both locations, interleaved in time.
    const sales: { second: number; location: LocationIndex }[] = [];
    for (const location of locations) {
      const count = Math.min(MAX_SALES, Math.max(MIN_SALES, Math.round(BASE_SALES * WEEKDAY_FACTOR[weekday(date)]! * (0.85 + rng() * 0.3))));
      for (let i = 0; i < count; i++) sales.push({ second: 9 * H + Math.floor(rng() * 11 * H), location });
    }
    sales.sort((a, b) => a.second - b.second || a.location - b.location);
    for (const { second, location } of sales) {
      const wanted = lineCount(rng);
      const paymentMethod = rng() < 0.7 ? 'cash' : 'transfer';
      const lines: PlannedSaleLine[] = [];
      const used = new Set<string>();
      for (let i = 0; i < wanted; i++) {
        const product = pick(rng, sellable, (p) => (used.has(p.key) ? 0 : p.demand));
        if (!product) break;
        used.add(product.key);
        const quantity = saleQuantity(rng, product);
        if (!stock.covers(location, product.key, quantity)) continue;
        const isCostSale = rng() < 0.01;
        lines.push({ product: product.key, quantity, unitPrice: isCostSale ? product.cost : priceAt(location, product, paymentMethod), paymentMethod, isCostSale });
        stock.add(location, product.key, -quantity);
      }
      if (lines.length > 0) docs.push({ kind: 'sale', ...doc(at(date, second)), location, lines });
    }

    // Evening: losses and withdrawals, only out of what is left.
    const exits: { reason: 'shrinkage' | 'owner_withdrawal'; probability: number; second: number }[] = [
      { reason: 'shrinkage', probability: 0.25, second: 20.5 * H },
      { reason: 'owner_withdrawal', probability: 0.1, second: 20.75 * H },
    ];
    for (const { reason, probability, second } of exits) {
      if (rng() >= probability) continue;
      const location: LocationIndex = rng() < 0.5 ? 0 : 1;
      const lines: PlannedLine[] = [];
      for (const product of sample(rng, sellable, 1 + Math.floor(rng() * 2))) {
        const quantity = product.unitOfMeasure === 'kg' ? 0.5 : 1;
        if (!stock.covers(location, product.key, quantity)) continue;
        lines.push({ product: product.key, quantity });
        stock.add(location, product.key, -quantity);
      }
      if (lines.length > 0) docs.push({ kind: 'exit', ...doc(at(date, second)), location, reason, lines });
    }
  }
  return docs;
}
