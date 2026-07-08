import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { currentWeek, PeriodBar, type Period } from '@/components/ui/period-bar';
import { Colors, FontSize, Radius, Semantic, Shadows } from '@/constants/theme';
import { getRangeRanking, type ProductRanking, type RankingSortBy } from '@/db/queries';
import { useAppColors } from '@/hooks/use-app-colors';
import { exportToExcel } from '@/lib/excel';
import { formatCurrency } from '@/lib/format';

export default function RankingsScreen() {
  const c = useAppColors();
  const [period, setPeriod] = useState<Period>(() => currentWeek());
  const [sortBy, setSortBy] = useState<RankingSortBy>('quantity');
  const [rows, setRows] = useState<ProductRanking[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await getRangeRanking(period.from, period.to, sortBy);
      if (active) setRows(data);
    })();
    return () => {
      active = false;
    };
  }, [period, sortBy]);

  const isQuantity = sortBy === 'quantity';
  const accent = isQuantity ? Semantic.transfer : Semantic.cash;
  const metric = (r: ProductRanking) => (isQuantity ? r.totalQuantity : r.totalProfit);
  const maxMetric = rows.reduce((max, r) => Math.max(max, metric(r)), 0);

  const toggles: { key: RankingSortBy; label: string }[] = [
    { key: 'quantity', label: 'Más vendidos' },
    { key: 'profit', label: 'Más rentables' },
  ];

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const rankRows: (string | number)[][] = [
        ['Posición', 'Producto', 'Cantidad', 'Ingreso', 'Utilidad', 'Margen %'],
      ];
      rows.forEach((r, i) => {
        rankRows.push([
          i + 1,
          r.productName,
          r.totalQuantity,
          r.totalRevenue,
          r.totalProfit,
          Number((r.margin * 100).toFixed(1)),
        ]);
      });
      await exportToExcel(`reporte_rankings_${period.from}.xlsx`, [{ name: 'Ranking', rows: rankRows }]);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  }, [rows, period]);

  const header = (
    <View style={{ gap: 14, marginBottom: 4 }}>
      <Animated.View entering={FadeInDown.duration(360).springify()}>
        <PeriodBar value={period} onChange={setPeriod} />
      </Animated.View>

      <Button
        label={exporting ? 'Exportando…' : 'Exportar a Excel'}
        icon="square.and.arrow.up"
        variant="soft"
        size="sm"
        loading={exporting}
        onPress={handleExport}
      />

      <Animated.View
        entering={FadeInDown.delay(60).duration(360).springify()}
        style={{
          flexDirection: 'row',
          backgroundColor: c.surface,
          borderRadius: Radius.lg,
          padding: 4,
          gap: 4,
          borderCurve: 'continuous',
          boxShadow: Shadows.sm,
        }}
      >
        {toggles.map((t) => {
          const active = t.key === sortBy;
          return (
            <Pressable
              key={t.key}
              onPress={() => setSortBy(t.key)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: Radius.md,
                alignItems: 'center',
                backgroundColor: active ? accent : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: FontSize.base,
                  fontWeight: '700',
                  color: active ? Colors.light.surface : c.textMuted,
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'Rankings' }} />
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.productId)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="sparkles"
            title="Sin datos en el período"
            description="Cuando haya ventas en el rango elegido, aquí verás el ranking de productos."
          />
        }
        renderItem={({ item, index }) => {
          const value = metric(item);
          const ratio = maxMetric > 0 ? value / maxMetric : 0;
          return (
            <Animated.View entering={FadeInDown.delay(120 + index * 30).duration(280)}>
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      backgroundColor: index < 3 ? accent : c.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: FontSize.lg,
                        fontWeight: '800',
                        color: index < 3 ? Colors.light.surface : c.textMuted,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{ fontSize: FontSize.base, fontWeight: '600', color: c.text }}
                      numberOfLines={1}
                    >
                      {item.productName}
                    </Text>
                    <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault, fontVariant: ['tabular-nums'] }}>
                      {isQuantity
                        ? `${item.totalQuantity} vendidos · ${formatCurrency(item.totalRevenue)}`
                        : `margen ${Math.round(item.margin * 100)}% · ${formatCurrency(item.totalRevenue)}`}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: accent,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {isQuantity ? item.totalQuantity : formatCurrency(item.totalProfit)}
                  </Text>
                </View>

                {/* Proportional bar */}
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: c.surfaceMuted,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(ratio * 100, 2)}%`,
                      height: '100%',
                      borderRadius: 4,
                      backgroundColor: accent,
                    }}
                  />
                </View>
              </View>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}
