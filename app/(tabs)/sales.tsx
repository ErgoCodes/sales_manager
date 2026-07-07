import { addDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/ui/empty-state';
import { HeroCard } from '@/components/ui/hero-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StatCard } from '@/components/ui/stat-card';
import { Colors, Semantic, Shadows, Radius, FontSize, Overlay } from '@/constants/theme';
import { formatCurrency } from '@/lib/format';
import {
  getDailyBreakdown,
  getDailySummary,
  type DailySummary,
  type ProductDaySummary,
} from '@/db/queries';



function formatDateHuman(iso: string): string {
  try {
    const d = parseISO(iso);
    const txt = format(d, "EEEE d 'de' MMMM", { locale: es });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  } catch {
    return iso;
  }
}

interface DateBarProps {
  date: string;
  onChange: (next: string) => void;
}

function DateBar({ date, onChange }: DateBarProps) {
  const isToday = date === format(new Date(), 'yyyy-MM-dd');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.lg,
        padding: 6,
        gap: 4,
        borderCurve: 'continuous',
        boxShadow: Shadows.sm,
      }}
    >
      <Pressable
        onPress={() => onChange(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: Radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? Colors.light.surfaceMuted : 'transparent',
        })}
      >
        <IconSymbol name="chevron.right" size={18} color={Semantic.neutral} style={{ transform: [{ rotate: '180deg' }] }} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
        <Text style={{ fontSize: FontSize.base, fontWeight: '700', color: Colors.light.text }}>{formatDateHuman(date)}</Text>
        <Text style={{ fontSize: FontSize.xs, color: Colors.light.tabIconDefault, fontVariant: ['tabular-nums'] }}>
          {date} {isToday ? '· Hoy' : ''}
        </Text>
      </View>
      <Pressable
        onPress={() => onChange(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? Colors.light.surfaceMuted : 'transparent',
        })}
      >
        <IconSymbol name="chevron.right" size={18} color={Semantic.neutral} />
      </Pressable>
    </View>
  );
}

export default function SalesScreen() {
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
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
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
                    color: Colors.light.textMuted,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Productos vendidos
                </Text>
                <Text style={{ fontSize: FontSize.sm, color: Colors.light.tabIconDefault, fontVariant: ['tabular-nums'] }}>
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
                backgroundColor: Colors.light.surface,
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
                  backgroundColor: Colors.light.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconSymbol name="bag.fill" size={18} color={Colors.light.tint} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: FontSize.base, fontWeight: '600', color: Colors.light.text }} numberOfLines={1}>
                  {item.productName}
                </Text>
                <Text style={{ fontSize: FontSize.sm, color: Colors.light.tabIconDefault, fontVariant: ['tabular-nums'] }}>
                  {item.totalQuantity} vendidos
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '700',
                    color: Colors.light.text,
                    fontVariant: ['tabular-nums'],
                  }}
                >
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

