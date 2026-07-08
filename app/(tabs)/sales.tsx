import { format } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { DateBar } from '@/components/ui/date-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { HeroCard } from '@/components/ui/hero-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StatCard } from '@/components/ui/stat-card';
import { Colors, Semantic, Shadows, Radius, FontSize, Overlay } from '@/constants/theme';
import {
  getDailyBreakdown,
  getDailySummary,
  type DailySummary,
  type ProductDaySummary,
} from '@/db/queries';
import { useAppColors } from '@/hooks/use-app-colors';
import { formatCurrency } from '@/lib/format';



export default function SalesScreen() {
  const c = useAppColors();
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [summary, setSummary] = useState<DailySummary>({
    cash: 0,
    transfer: 0,
    total: 0,
    profit: 0,
  });
  const [breakdown, setBreakdown] = useState<ProductDaySummary[]>([]);

  const load = useCallback(() => {
    let active = true;
    (async () => {
      const [s, b] = await Promise.all([getDailySummary(date), getDailyBreakdown(date)]);
      if (active) {
        setSummary(s);
        setBreakdown(b);
      }
    })();
    return () => {
      active = false;
    };
  }, [date]);

  useFocusEffect(load);

  const totalUnits = useMemo(
    () => breakdown.reduce((acc, item) => acc + item.totalQuantity, 0),
    [breakdown],
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={breakdown}
        keyExtractor={(item) => String(item.productId)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
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
                accent={c.cash}
                iconBg={c.cashSoft}
              />
              <StatCard
                icon="arrow.left.arrow.right.circle.fill"
                label="Transferencia"
                value={formatCurrency(summary.transfer)}
                accent={c.transfer}
                iconBg={c.transferSoft}
              />
            </Animated.View>

            {breakdown.length > 0 ? (
              <Animated.View
                entering={FadeInDown.delay(180).duration(360).springify()}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: c.textMuted,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Productos vendidos
                </Text>
                <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault, fontVariant: ['tabular-nums'] }}>
                  {breakdown.length} · {totalUnits} unidades
                </Text>
              </Animated.View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="cart.fill"
            title="Sin ventas este día"
            description="Cuando registres una venta, aparecerá aquí el desglose por producto."
            action={{ label: 'Registrar venta', onPress: () => router.push('/sales/new-session') }}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(220 + index * 30).duration(280)}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 14,
                gap: 12,
                borderCurve: 'continuous',
                boxShadow: Shadows.sm,
              }}
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
                  {item.totalQuantity} vendidos
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '700',
                    color: c.text,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatCurrency(item.totalRevenue)}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: c.cash,
                    fontWeight: '600',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  +{formatCurrency(item.totalProfit)}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}
      />

      <Pressable
        onPress={() => router.push('/sales/new-session')}
        style={({ pressed }) => ({
          position: 'absolute',
          bottom: 24,
          right: 20,
          height: 56,
          paddingHorizontal: 22,
          borderRadius: Radius.xl,
          backgroundColor: Colors.light.tint,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderCurve: 'continuous',
          boxShadow: Shadows.lg,
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        <IconSymbol name="plus" size={22} color={Colors.light.surface} />
        <Text style={{ color: Colors.light.surface, fontSize: 15, fontWeight: '700' }}>Vender</Text>
      </Pressable>
    </View>
  );
}

