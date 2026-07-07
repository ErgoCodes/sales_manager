import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { EmptyState } from '@/components/ui/empty-state';
import { HeroCard } from '@/components/ui/hero-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  currentWeek,
  PeriodBar,
  type Period,
} from '@/components/ui/period-bar';
import { StatCard } from '@/components/ui/stat-card';
import { Colors, FontSize, Overlay, Radius, Semantic, Shadows } from '@/constants/theme';
import { CONFIG_KEYS, getConfig, setConfig } from '@/db/config';
import {
  getDailyTotalsInRange,
  getLossesBreakdown,
  getRangeSummary,
  type DailySummary,
  type DayTotals,
  type LossesBreakdown,
} from '@/db/queries';
import { useAppColors } from '@/hooks/use-app-colors';
import { formatCurrency } from '@/lib/format';
import { requestPermissions, scheduleWeeklyReminder } from '@/lib/notifications';

const EMPTY_SUMMARY: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };
const EMPTY_LOSSES: LossesBreakdown = { categories: [], total: 0 };

function dayLabel(iso: string): string {
  const txt = format(parseISO(iso), "EEEE d 'de' MMM", { locale: es });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export default function PeriodReportScreen() {
  const c = useAppColors();
  const [period, setPeriod] = useState<Period>(() => currentWeek());
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [days, setDays] = useState<DayTotals[]>([]);
  const [losses, setLosses] = useState<LossesBreakdown>(EMPTY_LOSSES);

  // Programa el recordatorio semanal una sola vez (gateado por config).
  useEffect(() => {
    let active = true;
    (async () => {
      const flag = await getConfig(CONFIG_KEYS.weeklyReminderScheduled);
      if (!active || flag === '1') return;
      const granted = await requestPermissions();
      if (!granted) return;
      await scheduleWeeklyReminder();
      await setConfig(CONFIG_KEYS.weeklyReminderScheduled, '1');
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const isMonth = period.mode === 'month';
      const [s, dayRows, lossRows] = await Promise.all([
        getRangeSummary(period.from, period.to),
        isMonth
          ? Promise.resolve<DayTotals[]>([])
          : getDailyTotalsInRange(period.from, period.to),
        isMonth ? getLossesBreakdown(period.from, period.to) : Promise.resolve(EMPTY_LOSSES),
      ]);
      if (!active) return;
      setSummary(s);
      setDays(dayRows);
      setLosses(lossRows);
    })();
    return () => {
      active = false;
    };
  }, [period]);

  const isMonth = period.mode === 'month';
  const netProfit = summary.profit - losses.total;

  const sectionLabel = useCallback(
    (text: string) => (
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
    ),
    [c.textMuted],
  );

  const header = (
    <View style={{ gap: 14, marginBottom: 4 }}>
      <Animated.View entering={FadeInDown.duration(360).springify()}>
        <PeriodBar value={period} onChange={setPeriod} />
      </Animated.View>

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
            Total del período
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

      <Animated.View
        entering={FadeInDown.delay(180).duration(360).springify()}
        style={{ marginTop: 6 }}
      >
        {sectionLabel(isMonth ? 'Pérdidas del mes' : 'Ventas por día')}
      </Animated.View>
    </View>
  );

  // ---- Month view: losses breakdown + net profit ----
  if (isMonth) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Stack.Screen options={{ title: 'Semanal y mensual' }} />
        <FlatList
          data={losses.categories}
          keyExtractor={(item) => item.type}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(200 + index * 30).duration(280)}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  borderCurve: 'continuous',
                  boxShadow: Shadows.sm,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Text style={{ fontSize: FontSize.base, fontWeight: '600', color: c.text }}>
                    {item.label}
                  </Text>
                  <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault }}>
                    {item.records.length}{' '}
                    {item.records.length === 1 ? 'registro' : 'registros'}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '700',
                    color: item.subtotal > 0 ? Semantic.danger : c.tabIconDefault,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatCurrency(item.subtotal)}
                </Text>
              </View>
            </Animated.View>
          )}
          ListFooterComponent={
            <Animated.View entering={FadeInDown.delay(260).duration(320)} style={{ marginTop: 18, gap: 12 }}>
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
                <Text style={{ fontSize: FontSize.lg, fontWeight: '600', color: c.text }}>
                  Total de pérdidas
                </Text>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: '800',
                    color: Semantic.danger,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatCurrency(losses.total)}
                </Text>
              </View>

              <HeroCard color={netProfit >= 0 ? Colors.light.tint : Semantic.danger} padding={18}>
                <Text
                  style={{
                    fontSize: FontSize.xs,
                    fontWeight: '700',
                    color: Overlay.text,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Utilidad neta
                </Text>
                <Text
                  selectable
                  style={{
                    fontSize: 30,
                    fontWeight: '800',
                    color: Colors.light.surface,
                    letterSpacing: -0.5,
                    marginTop: 4,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatCurrency(netProfit)}
                </Text>
                <Text style={{ fontSize: FontSize.sm, color: Overlay.textStrong, marginTop: 4 }}>
                  Utilidad de ventas menos pérdidas
                </Text>
              </HeroCard>
            </Animated.View>
          }
        />
      </View>
    );
  }

  // ---- Week / custom view: per-day totals ----
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'Semanal y mensual' }} />
      <FlatList
        data={days}
        keyExtractor={(item) => item.date}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="chart.bar.fill"
            title="Sin ventas en el período"
            description="Elige otra semana o un rango con actividad para ver el desglose por día."
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(200 + index * 30).duration(280)}>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: FontSize.base, fontWeight: '600', color: c.text }}>
                  {dayLabel(item.date)}
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>
                  {formatCurrency(item.total)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Semantic.cash }} />
                  <Text style={{ fontSize: FontSize.sm, color: c.textMuted, fontVariant: ['tabular-nums'] }}>
                    {formatCurrency(item.cash)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Semantic.transfer }} />
                  <Text style={{ fontSize: FontSize.sm, color: c.textMuted, fontVariant: ['tabular-nums'] }}>
                    {formatCurrency(item.transfer)}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: FontSize.sm,
                    color: Semantic.cash,
                    fontWeight: '600',
                    marginLeft: 'auto',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  +{formatCurrency(item.profit)}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}
      />
    </View>
  );
}
