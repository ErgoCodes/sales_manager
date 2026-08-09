import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroCard } from "@/components/ui/hero-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  currentWeek,
  PeriodBar,
  type Period,
} from "@/components/ui/period-bar";
import { StatCard } from "@/components/ui/stat-card";
import { CONFIG_KEYS, getConfig, setConfig } from "@/db/config";
import {
  getDailyTotalsInRange,
  getLossesBreakdown,
  getRangeSummary,
  type DailySummary,
  type DayTotals,
  type LossesBreakdown,
} from "@/db/queries";
import { listSales } from "@/db/sales";
import {
  Colors,
  FontSize,
  Overlay,
  Radius,
  Shadows,
} from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { exportToExcel } from "@/lib/excel";
import { formatCurrency } from "@/lib/format";
import {
  requestPermissions,
  scheduleBackupReminder,
  scheduleWeeklyReminder,
} from "@/lib/notifications";

function methodLabel(method: string): string {
  if (method === "efectivo") return "Efectivo";
  if (method === "transferencia") return "Transferencia";
  return "Costo";
}

const EMPTY_SUMMARY: DailySummary = {
  cash: 0,
  transfer: 0,
  total: 0,
  profit: 0,
};
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
  const [exporting, setExporting] = useState(false);

  // Programa recordatorios una sola vez (gateados por config).
  useEffect(() => {
    let active = true;
    (async () => {
      const weeklyFlag = await getConfig(CONFIG_KEYS.weeklyReminderScheduled);
      const backupFlag = await getConfig(CONFIG_KEYS.backupReminderScheduled);
      if (!active) return;

      const needsWeekly = weeklyFlag !== "1";
      const needsBackup = backupFlag !== "1";
      if (!needsWeekly && !needsBackup) return;

      const granted = await requestPermissions();
      if (!granted || !active) return;

      if (needsWeekly) {
        await scheduleWeeklyReminder();
        await setConfig(CONFIG_KEYS.weeklyReminderScheduled, "1");
      }
      if (needsBackup) {
        await scheduleBackupReminder();
        await setConfig(CONFIG_KEYS.backupReminderScheduled, "1");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const isMonth = period.mode === "month";
      const [s, dayRows, lossRows] = await Promise.all([
        getRangeSummary(period.from, period.to),
        isMonth
          ? Promise.resolve<DayTotals[]>([])
          : getDailyTotalsInRange(period.from, period.to),
        isMonth
          ? getLossesBreakdown(period.from, period.to)
          : Promise.resolve(EMPTY_LOSSES),
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

  const isMonth = period.mode === "month";
  const netProfit = summary.profit - losses.total;

  const sectionLabel = useCallback(
    (text: string) => (
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: c.textMuted,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {text}
      </Text>
    ),
    [c.textMuted]
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const [sales, dayRows] = await Promise.all([
        listSales({ dateFrom: period.from, dateTo: period.to }),
        getDailyTotalsInRange(period.from, period.to),
      ]);

      const salesRows: (string | number)[][] = [
        [
          "Fecha",
          "Producto",
          "Unidad",
          "Cantidad",
          "Método",
          "Precio aplicado",
          "Costo unitario",
          "Importe",
          "Utilidad",
        ],
      ];
      let totalQty = 0;
      let totalRevenue = 0;
      let totalProfit = 0;
      for (const s of sales) {
        const amount = s.appliedPrice * s.quantity;
        totalQty += s.quantity;
        totalRevenue += amount;
        totalProfit += s.profit;
        salesRows.push([
          s.date,
          s.productName,
          s.unitOfMeasure,
          s.quantity,
          methodLabel(s.paymentMethod),
          s.appliedPrice,
          s.costAtSale,
          amount,
          s.profit,
        ]);
      }
      salesRows.push([
        "TOTAL",
        "",
        "",
        totalQty,
        "",
        "",
        "",
        totalRevenue,
        totalProfit,
      ]);

      const dayRowsSheet: (string | number)[][] = [
        ["Fecha", "Efectivo", "Transferencia", "Total", "Utilidad"],
      ];
      for (const d of dayRows) {
        dayRowsSheet.push([d.date, d.cash, d.transfer, d.total, d.profit]);
      }

      const sheets = [
        { name: "Ventas", rows: salesRows },
        { name: "Resumen por día", rows: dayRowsSheet },
      ];

      if (isMonth && losses.categories.length > 0) {
        const lossRows: (string | number)[][] = [
          ["Categoría", "Concepto", "Fecha", "Monto"],
        ];
        for (const cat of losses.categories) {
          for (const r of cat.records) {
            lossRows.push([cat.label, r.label, r.date, r.amount]);
          }
        }
        lossRows.push(["TOTAL", "", "", losses.total]);
        sheets.push({ name: "Pérdidas", rows: lossRows });
      }

      const prefix = isMonth ? "mensual" : "semanal";
      await exportToExcel(`reporte_${prefix}_${period.from}.xlsx`, sheets);
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error
          ? error.message
          : "No se pudo exportar el reporte."
      );
    } finally {
      setExporting(false);
    }
  }, [period, isMonth, losses]);

  const header = (
    <View style={{ gap: 14, marginBottom: 4 }}>
      <Animated.View entering={FadeInDown.duration(360).springify()}>
        <PeriodBar value={period} onChange={setPeriod} />
      </Animated.View>

      <Button
        label={exporting ? "Exportando…" : "Exportar a Excel"}
        icon="square.and.arrow.up"
        variant="soft"
        size="sm"
        loading={exporting}
        onPress={handleExport}
      />

      <Animated.View entering={FadeInDown.delay(60).duration(360).springify()}>
        <HeroCard padding={20}>
          <Text
            style={{
              fontSize: FontSize.xs,
              fontWeight: "700",
              color: Overlay.text,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Total del período
          </Text>
          <Text
            selectable
            style={{
              fontSize: 36,
              fontWeight: "800",
              color: Colors.light.surface,
              letterSpacing: -1,
              marginTop: 4,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatCurrency(summary.total)}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
            }}
          >
            <IconSymbol name="sparkles" size={13} color={Overlay.textStrong} />
            <Text style={{ fontSize: FontSize.md, color: Overlay.textStrong }}>
              Utilidad
            </Text>
            <Text
              style={{
                fontSize: FontSize.md,
                fontWeight: "700",
                color: Colors.light.surface,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCurrency(summary.profit)}
            </Text>
          </View>
        </HeroCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(120).duration(360).springify()}
        style={{ flexDirection: "row", gap: 10 }}
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

      <Animated.View
        entering={FadeInDown.delay(180).duration(360).springify()}
        style={{ marginTop: 6 }}
      >
        {sectionLabel(isMonth ? "Pérdidas del mes" : "Ventas por día")}
      </Animated.View>
    </View>
  );

  // ---- Month view: losses breakdown + net profit ----
  if (isMonth) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Stack.Screen options={{ title: "Semanal y mensual" }} />
        <FlatList
          data={losses.categories}
          keyExtractor={(item) => item.type}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(200 + index * 30).duration(280)}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 14,
                  borderCurve: "continuous",
                  boxShadow: Shadows.sm,
                }}
              >
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      fontSize: FontSize.base,
                      fontWeight: "600",
                      color: c.text,
                    }}
                  >
                    {item.label}
                  </Text>
                  <Text
                    style={{ fontSize: FontSize.sm, color: c.tabIconDefault }}
                  >
                    {item.records.length}{" "}
                    {item.records.length === 1 ? "registro" : "registros"}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: item.subtotal > 0 ? c.danger : c.tabIconDefault,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatCurrency(item.subtotal)}
                </Text>
              </View>
            </Animated.View>
          )}
          ListFooterComponent={
            <Animated.View
              entering={FadeInDown.delay(260).duration(320)}
              style={{ marginTop: 18, gap: 12 }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: c.surface,
                  borderRadius: Radius.lg,
                  padding: 16,
                  borderCurve: "continuous",
                  boxShadow: Shadows.sm,
                }}
              >
                <Text
                  style={{
                    fontSize: FontSize.lg,
                    fontWeight: "600",
                    color: c.text,
                  }}
                >
                  Total de pérdidas
                </Text>
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "800",
                    color: c.danger,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatCurrency(losses.total)}
                </Text>
              </View>

              <HeroCard color={netProfit >= 0 ? c.tint : c.danger} padding={18}>
                <Text
                  style={{
                    fontSize: FontSize.xs,
                    fontWeight: "700",
                    color: Overlay.text,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Utilidad neta
                </Text>
                <Text
                  selectable
                  style={{
                    fontSize: 30,
                    fontWeight: "800",
                    color: Colors.light.surface,
                    letterSpacing: -0.5,
                    marginTop: 4,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatCurrency(netProfit)}
                </Text>
                <Text
                  style={{
                    fontSize: FontSize.sm,
                    color: Overlay.textStrong,
                    marginTop: 4,
                  }}
                >
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
      <Stack.Screen options={{ title: "Semanal y mensual" }} />
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
          <Animated.View
            entering={FadeInDown.delay(200 + index * 30).duration(280)}
          >
            <View
              style={{
                backgroundColor: c.surface,
                borderRadius: Radius.lg,
                padding: 14,
                gap: 10,
                borderCurve: "continuous",
                boxShadow: Shadows.sm,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    fontSize: FontSize.base,
                    fontWeight: "600",
                    color: c.text,
                  }}
                >
                  {dayLabel(item.date)}
                </Text>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    color: c.text,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatCurrency(item.total)}
                </Text>
              </View>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: c.cash,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: FontSize.sm,
                      color: c.textMuted,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatCurrency(item.cash)}
                  </Text>
                </View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: c.transfer,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: FontSize.sm,
                      color: c.textMuted,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatCurrency(item.transfer)}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: FontSize.sm,
                    color: c.cash,
                    fontWeight: "600",
                    marginLeft: "auto",
                    fontVariant: ["tabular-nums"],
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
