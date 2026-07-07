import { format } from 'date-fns';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { DateBar } from '@/components/ui/date-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { HeroCard } from '@/components/ui/hero-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StatCard } from '@/components/ui/stat-card';
import { getProductThreshold } from '@/constants/catalog';
import { Colors, FontSize, Overlay, Radius, Semantic, Shadows } from '@/constants/theme';
import { CONFIG_KEYS, getConfig } from '@/db/config';
import { listProducts } from '@/db/products';
import { getDailySummary, type DailySummary } from '@/db/queries';
import { listSales, type SaleWithProduct } from '@/db/sales';
import { useAppColors } from '@/hooks/use-app-colors';
import { formatCurrency } from '@/lib/format';

interface ProductGroup {
  productId: number;
  productName: string;
  unitOfMeasure: string;
  totalQty: number;
  totalRevenue: number;
  totalProfit: number;
  sales: SaleWithProduct[];
}

interface LowStockItem {
  id: number;
  name: string;
  stock: number;
  threshold: number;
}

interface Inventory {
  totalValue: number;
  lowStock: LowStockItem[];
}

const EMPTY_SUMMARY: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };

function methodBadge(method: string): { tone: BadgeTone; label: string } {
  if (method === 'efectivo') return { tone: 'success', label: 'Efectivo' };
  if (method === 'transferencia') return { tone: 'info', label: 'Transfer.' };
  return { tone: 'cost', label: 'Costo' };
}

function groupByProduct(sales: SaleWithProduct[]): ProductGroup[] {
  const map = new Map<number, ProductGroup>();
  for (const s of sales) {
    let g = map.get(s.productId);
    if (!g) {
      g = {
        productId: s.productId,
        productName: s.productName,
        unitOfMeasure: s.unitOfMeasure,
        totalQty: 0,
        totalRevenue: 0,
        totalProfit: 0,
        sales: [],
      };
      map.set(s.productId, g);
    }
    g.totalQty += s.quantity;
    g.totalRevenue += s.appliedPrice * s.quantity;
    g.totalProfit += s.profit;
    g.sales.push(s);
  }
  return [...map.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export default function DailyReportScreen() {
  const c = useAppColors();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [rows, setRows] = useState<ProductGroup[]>([]);
  const [inventory, setInventory] = useState<Inventory>({ totalValue: 0, lowStock: [] });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const [s, sales, products, thresholdStr] = await Promise.all([
        getDailySummary(date),
        listSales({ dateFrom: date, dateTo: date }),
        listProducts(),
        getConfig(CONFIG_KEYS.generalStockThreshold),
      ]);
      if (!active) return;

      const generalThreshold = Number(thresholdStr ?? 5);
      let totalValue = 0;
      const lowStock: LowStockItem[] = [];
      for (const p of products) {
        totalValue += p.stock * (p.averageCost ?? 0);
        const threshold = getProductThreshold(p, generalThreshold);
        if (p.stock < threshold) {
          lowStock.push({ id: p.id, name: p.name, stock: p.stock, threshold });
        }
      }

      setSummary(s);
      setRows(groupByProduct(sales));
      setInventory({ totalValue, lowStock });
      setExpanded(new Set());
    })();
    return () => {
      active = false;
    };
  }, [date]);

  useFocusEffect(load);

  const totalUnits = useMemo(() => rows.reduce((acc, r) => acc + r.totalQty, 0), [rows]);

  const toggle = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sectionLabel = (text: string) => (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '700',
        color: c.textMuted,
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}
    >
      {text}
    </Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'Reporte diario' }} />
      <FlatList
        data={rows}
        extraData={expanded}
        keyExtractor={(item) => String(item.productId)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <Animated.View entering={FadeInDown.duration(360).springify()}>
              <DateBar date={date} onChange={setDate} />
            </Animated.View>

            {/* HERO */}
            <Animated.View entering={FadeInDown.delay(60).duration(360).springify()}>
              <HeroCard padding={20}>
                <Text
                  style={{
                    fontSize: FontSize.xs,
                    fontWeight: '700',
                    color: Overlay.text,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Total vendido
                </Text>
                <Text
                  selectable
                  style={{
                    fontSize: 36,
                    fontWeight: '800',
                    color: Colors.light.surface,
                    letterSpacing: -1,
                    marginTop: 4,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatCurrency(summary.total)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <IconSymbol name="sparkles" size={13} color={Overlay.textStrong} />
                  <Text style={{ fontSize: FontSize.md, color: Overlay.textStrong }}>Utilidad</Text>
                  <Text
                    style={{
                      fontSize: FontSize.md,
                      fontWeight: '700',
                      color: Colors.light.surface,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {formatCurrency(summary.profit)}
                  </Text>
                </View>
              </HeroCard>
            </Animated.View>

            {/* Mini stats row */}
            <Animated.View
              entering={FadeInDown.delay(120).duration(360).springify()}
              style={{ flexDirection: 'row', gap: 10 }}
            >
              <StatCard
                icon="dollarsign.circle.fill"
                label="Efectivo"
                value={formatCurrency(summary.cash)}
                accent={Semantic.cash}
                iconBg={Semantic.cashSoft}
              />
              <StatCard
                icon="arrow.left.arrow.right.circle.fill"
                label="Transferencia"
                value={formatCurrency(summary.transfer)}
                accent={Semantic.transfer}
                iconBg={Semantic.transferSoft}
              />
            </Animated.View>

            {rows.length > 0 ? (
              <Animated.View
                entering={FadeInDown.delay(180).duration(360).springify()}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 6,
                }}
              >
                {sectionLabel('Ventas del día')}
                <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault, fontVariant: ['tabular-nums'] }}>
                  {rows.length} · {totalUnits} unidades
                </Text>
              </Animated.View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="cart.fill"
            title="Sin ventas este día"
            description="Cuando registres una venta, aparecerá aquí el detalle por producto."
            action={{ label: 'Registrar venta', onPress: () => router.push('/sales/new-session') }}
          />
        }
        renderItem={({ item, index }) => {
          const isExpanded = expanded.has(item.productId);
          return (
            <Animated.View entering={FadeInDown.delay(220 + index * 30).duration(280)}>
              <View
                style={{
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  borderCurve: 'continuous',
                  boxShadow: Shadows.sm,
                }}
              >
                <Pressable
                  onPress={() => toggle(item.productId)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      backgroundColor: c.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <IconSymbol name="bag.fill" size={18} color={c.tint} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: FontSize.base, fontWeight: '600', color: c.text }} numberOfLines={1}>
                      {item.productName}
                    </Text>
                    <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault, fontVariant: ['tabular-nums'] }}>
                      {item.totalQty} vendidos · {item.sales.length}{' '}
                      {item.sales.length === 1 ? 'venta' : 'ventas'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>
                      {formatCurrency(item.totalRevenue)}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: Semantic.cash,
                        fontWeight: '600',
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      +{formatCurrency(item.totalProfit)}
                    </Text>
                  </View>
                  <IconSymbol
                    name="chevron.right"
                    size={16}
                    color={c.tabIconDefault}
                    style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
                  />
                </Pressable>

                {isExpanded ? (
                  <View
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      gap: 10,
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                    }}
                  >
                    {item.sales.map((s) => {
                      const badge = methodBadge(s.paymentMethod);
                      return (
                        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Badge tone={badge.tone} label={badge.label} />
                          <Text
                            style={{
                              fontSize: FontSize.sm,
                              color: c.textMuted,
                              fontVariant: ['tabular-nums'],
                            }}
                          >
                            ×{s.quantity}
                            {s.discountPercent > 0 ? `  −${Math.round(s.discountPercent)}%` : ''}
                          </Text>
                          <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
                            <Text
                              style={{
                                fontSize: FontSize.md,
                                fontWeight: '600',
                                color: c.text,
                                fontVariant: ['tabular-nums'],
                              }}
                            >
                              {formatCurrency(s.appliedPrice * s.quantity)}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                color: c.tabIconDefault,
                                fontVariant: ['tabular-nums'],
                              }}
                            >
                              costo {formatCurrency(s.costAtSale * s.quantity)} · util{' '}
                              {formatCurrency(s.profit)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            </Animated.View>
          );
        }}
        ListFooterComponent={
          <Animated.View entering={FadeInDown.delay(240).duration(320)} style={{ marginTop: 22, gap: 12 }}>
            {sectionLabel('Inventario')}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 16,
                borderCurve: 'continuous',
                boxShadow: Shadows.sm,
              }}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: FontSize.md, color: c.textMuted }}>Valor del inventario</Text>
                <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>
                  {formatCurrency(inventory.totalValue)}
                </Text>
              </View>
              <IconSymbol name="shippingbox.fill" size={26} color={c.tint} />
            </View>

            {inventory.lowStock.length > 0 ? (
              <View
                style={{
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  gap: 10,
                  borderCurve: 'continuous',
                  boxShadow: Shadows.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={16} color={Semantic.warningDark} />
                  <Text style={{ fontSize: FontSize.md, fontWeight: '700', color: c.text }}>
                    Stock bajo ({inventory.lowStock.length})
                  </Text>
                </View>
                {inventory.lowStock.map((p) => (
                  <View
                    key={p.id}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={{ fontSize: FontSize.md, color: c.text }} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: FontSize.sm,
                        color: Semantic.warningDark,
                        fontWeight: '600',
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {p.stock} / {p.threshold}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  borderCurve: 'continuous',
                  boxShadow: Shadows.sm,
                }}
              >
                <IconSymbol name="checkmark.circle.fill" size={16} color={Semantic.cash} />
                <Text style={{ fontSize: FontSize.md, color: c.textMuted }}>Sin alertas de stock</Text>
              </View>
            )}
          </Animated.View>
        }
      />
    </View>
  );
}
