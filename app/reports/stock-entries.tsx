import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  currentWeek,
  PeriodBar,
  type Period,
} from "@/components/ui/period-bar";
import {
  getEntriesSummaryByProduct,
  listEntries,
  type EntrySummary,
} from "@/db/movements";
import { FontSize, Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";
import { exportToExcel } from "@/lib/excel";
import { formatCurrency } from "@/lib/format";

function formatDate(isoString: string): string {
  try {
    return format(parseISO(isoString), "d MMM yyyy", { locale: es });
  } catch {
    return isoString;
  }
}

function formatFullDate(isoString: string): string {
  try {
    return format(parseISO(isoString), "yyyy-MM-dd HH:mm", { locale: es });
  } catch {
    return isoString;
  }
}

export default function StockEntriesReportScreen() {
  const c = useAppColors();
  const [period, setPeriod] = useState<Period>(() => currentWeek());
  const [rows, setRows] = useState<EntrySummary[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await getEntriesSummaryByProduct(period.from, period.to);
      if (active) setRows(data);
    })();
    return () => {
      active = false;
    };
  }, [period]);

  const maxCostValue = rows.reduce((max, r) => Math.max(max, r.totalCostValue), 0);
  const totalCostSum = rows.reduce((sum, r) => sum + r.totalCostValue, 0);
  const totalEntriesCount = rows.reduce((sum, r) => sum + r.entriesCount, 0);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const summaryRows: (string | number)[][] = [
        ["Producto", "Cantidad", "Unidad", "Valor a costo", "Nº entradas", "Última entrada"],
      ];
      rows.forEach((r) => {
        summaryRows.push([
          r.productName,
          r.totalQuantity,
          r.unitOfMeasure,
          r.totalCostValue,
          r.entriesCount,
          r.lastEntryDate ? formatFullDate(r.lastEntryDate) : "-",
        ]);
      });

      const details = await listEntries({
        dateFrom: period.from,
        dateTo: period.to,
      });

      const detailRows: (string | number)[][] = [
        ["Fecha", "Producto", "Cantidad", "Unidad", "Costo unitario", "Valor total", "Notas"],
      ];
      details.forEach((d) => {
        detailRows.push([
          d.date ? formatFullDate(d.date) : "-",
          d.productName,
          d.quantity,
          d.unitOfMeasure,
          d.unitCostPrice,
          d.quantity * d.unitCostPrice,
          d.notes ?? "",
        ]);
      });

      await exportToExcel(`reporte_entradas_${period.from}.xlsx`, [
        { name: "Resumen por producto", rows: summaryRows },
        { name: "Detalle por fecha", rows: detailRows },
      ]);
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
  }, [rows, period]);

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

      {rows.length > 0 && (
        <Animated.View
          entering={FadeInDown.delay(60).duration(360).springify()}
          style={{
            backgroundColor: c.surface,
            borderRadius: Radius.lg,
            padding: 14,
            gap: 6,
            borderCurve: "continuous",
            boxShadow: Shadows.sm,
          }}
        >
          <Text style={{ fontSize: FontSize.sm, color: c.textMuted, fontWeight: "600" }}>
            TOTAL REPOSICIONES
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={{ fontSize: FontSize["2xl"], fontWeight: "800", color: c.text, fontVariant: ["tabular-nums"] }}>
              {formatCurrency(totalCostSum)}
            </Text>
            <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault, fontVariant: ["tabular-nums"] }}>
              {rows.length} productos · {totalEntriesCount} {totalEntriesCount === 1 ? "entrada" : "entradas"}
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Entradas de inventario" }} />
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.productId)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="shippingbox.fill"
            title="Sin entradas en el período"
            description="Cuando registres entradas de inventario en el rango elegido, aquí verás el resumen por producto."
          />
        }
        renderItem={({ item, index }) => {
          const ratio = maxCostValue > 0 ? item.totalCostValue / maxCostValue : 0;
          return (
            <Animated.View
              entering={FadeInDown.delay(120 + index * 30).duration(280)}
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
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{
                        fontSize: FontSize.base,
                        fontWeight: "600",
                        color: c.text,
                      }}
                      numberOfLines={1}
                    >
                      {item.productName}
                    </Text>
                    <Text
                      style={{
                        fontSize: FontSize.sm,
                        color: c.tabIconDefault,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {item.totalQuantity} {item.unitOfMeasure} · {item.entriesCount} {item.entriesCount === 1 ? "entrada" : "entradas"} · {formatDate(item.lastEntryDate)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "700",
                      color: c.text,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatCurrency(item.totalCostValue)}
                  </Text>
                </View>

                {/* Proportional bar */}
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: c.surfaceMuted,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(ratio * 100, 2)}%`,
                      height: "100%",
                      borderRadius: 4,
                      backgroundColor: c.transfer,
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
