import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { BarChart } from '../bar-chart';
import { CurrencyTabs } from '../currency-tabs';
import { DailyChart } from '../daily-chart';
import { DashboardFilters } from '../dashboard-filters';
import { HealthPanel } from '../health-panel';
import { SummaryCards } from '../summary-cards';
import { dailySeries, inventoryHealth, L1, L2, summary } from './fixtures';

const locations = [
  { id: L1, name: 'Centro', archivedAt: null },
  { id: L2, name: 'Norte', archivedAt: null },
];
const html = (element: React.ReactElement) => renderToStaticMarkup(element);
const hrefs = (out: string) => [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));

describe('DashboardFilters (filters live in the URL)', () => {
  it('offers the ≤30-day presets as links that keep the location, currency and order', () => {
    const out = html(<DashboardFilters filters={{ period: '7d', locationId: L1, currency: 'USD', order: 'profit' }} locations={locations} />);
    expect(hrefs(out)).toEqual([`/tablero?punto=${L1}&moneda=USD&orden=profit`, `/tablero?punto=${L1}&periodo=7d&moneda=USD&orden=profit`, `/tablero?punto=${L1}&periodo=30d&moneda=USD&orden=profit`]);
    expect(out).toMatch(/aria-current="page"[^>]*>7 días</);
    for (const label of ['Hoy', '7 días', '30 días']) expect(out).toContain(`>${label}<`);
  });

  it('the location selector lists only the visible locations plus "Todos mis puntos", and submits by GET', () => {
    const out = html(<DashboardFilters filters={{ period: 'hoy', locationId: L2, order: 'revenue' }} locations={locations} />);
    expect(out).toMatch(/<form(?=[^>]*method="get")(?=[^>]*action="\/tablero")/);
    expect(out).toContain('<option value="">Todos mis puntos</option>');
    expect(out).toMatch(new RegExp(`<option value="${L2}" selected="">Norte</option>`));
    expect(out).toContain('name="punto"');
  });

  it('the custom range form carries desde/hasta and preserves the other filters as hidden fields', () => {
    const out = html(<DashboardFilters filters={{ period: 'rango', from: '2026-11-01', to: '2026-11-10', locationId: L1, currency: 'CUP', order: 'quantity' }} locations={locations} />);
    expect(out).toMatch(/name="desde"[^>]*value="2026-11-01"|value="2026-11-01"[^>]*name="desde"/);
    expect(out).toMatch(/name="hasta"[^>]*value="2026-11-10"|value="2026-11-10"[^>]*name="hasta"/);
    expect(out).toMatch(/type="hidden" name="moneda" value="CUP"/);
    expect(out).toMatch(/type="hidden" name="orden" value="quantity"/);
    expect(out).not.toContain('aria-current');
  });
});

describe('multi-currency summary', () => {
  it('tabs list only the currencies with data; the cards show the chosen one, formatted with its currency', () => {
    const data = summary();
    const tabs = html(<CurrencyTabs currencies={['CUP', 'USD']} selected="USD" filters={{ period: 'hoy', order: 'revenue' }} />);
    expect(hrefs(tabs)).toEqual(['/tablero?moneda=CUP', '/tablero?moneda=USD']);
    expect(tabs).toMatch(/aria-current="page"[^>]*>USD</);
    expect(tabs).not.toContain('MLC');

    const usd = html(<SummaryCards totals={data.currencies[1]!} />);
    for (const text of ['Ventas totales', 'USD', '50.00', 'Utilidad bruta', '15.00', '30%', 'Tickets', 'Ticket promedio', '25.00']) expect(usd).toContain(text);
    expect(usd).not.toContain('CUP');
    const cup = html(<SummaryCards totals={data.currencies[0]!} />);
    for (const text of ['10,000.00', 'Efectivo', '6,000.00', 'Transferencia', '4,000.00', 'Pérdidas', 'Merma', '12.00', 'Retiros', '8.00', 'Entradas valoradas', '3,000.00', '25%']) expect(cup).toContain(text);
  });

  it('a null margin or average ticket is a dash, never a zero', () => {
    const out = html(<SummaryCards totals={{ ...summary().currencies[0]!, margin: null, averageTicket: null, tickets: 0 }} />);
    expect(out).toContain('—');
    expect(out).not.toContain('0%');
  });

  it('the inventory value lists every currency', () => {
    const out = html(<HealthPanel health={inventoryHealth()} />);
    for (const text of ['Valor del inventario', 'CUP', '45,001.23', 'USD', '120.00', 'Bajo stock', '12', 'Arroz', 'Estancados', 'Nunca vendido', 'Por vencer', 'Sin productos']) expect(out).toContain(text);
  });
});

describe('Recharts charts (CSP: client only, no style attributes in server HTML)', () => {
  const points = dailySeries().series[0]!.points;

  it('the daily chart renders a labelled placeholder on the server and an equivalent table', () => {
    const out = html(<DailyChart points={points} currency="CUP" />);
    expect(out).not.toMatch(/\sstyle=/);
    expect(out).not.toContain('recharts');
    expect(out).toMatch(/role="img"[^>]*aria-label="[^"]*ventas[^"]*"/i);
    expect(out).toContain('class="skeleton');
    for (const text of ['<table', 'Ver como tabla', '2026-11-21', '4,000.00']) expect(out).toContain(text);
    expect(out).toMatch(/<td[^>]*>-CUP\s20\.00<\/td>/);
  });

  it('the bar chart renders a labelled placeholder and, by default, its table; table={false} leaves it to the caller', () => {
    const items = [{ key: 'a', label: 'Centro', value: 700000, display: 'CUP 7,000.00' }, { key: 'b', label: 'Norte', value: 0, display: 'CUP 0.00' }];
    const out = html(<BarChart label="Ventas por punto" items={items} />);
    expect(out).not.toMatch(/\sstyle=/);
    expect(out).toMatch(/role="img"[^>]*aria-label="Ventas por punto"/);
    for (const text of ['<table', 'Centro', 'CUP 7,000.00', 'Norte']) expect(out).toContain(text);
    expect(html(<BarChart label="Ventas por punto" items={items} table={false} />)).not.toContain('<table');
  });

  it('charts survive a single point and all-zero values', () => {
    expect(html(<DailyChart points={[{ date: '2026-11-22', totalSales: 0, profit: 0 }]} currency="CUP" />)).not.toMatch(/NaN|Infinity/);
    expect(html(<BarChart label="x" items={[{ key: 'a', label: 'A', value: 0, display: '0' }]} />)).not.toMatch(/NaN|Infinity/);
  });
});

describe('chart modules', () => {
  it.each(['bar-chart.tsx', 'daily-chart.tsx'])('%s is a client component: Recharts draws only in the browser, where the CSP allows its CSSOM styles', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const source = await readFile(resolve(import.meta.dirname, '..', file), 'utf8');
    expect(source.startsWith("'use client';")).toBe(true);
  });
});
