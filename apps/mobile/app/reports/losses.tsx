import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { HeroCard } from "@/components/ui/hero-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  currentMonth,
  PeriodBar,
  type Period,
} from "@/components/ui/period-bar";
import {
  getLossesBreakdown,
  type LossCategory,
  type LossesBreakdown,
} from "@/db/queries";
import { getTypeLabel } from "@/drizzle/constants/expenses";
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

const EMPTY_LOSSES: LossesBreakdown = { categories: [], total: 0 };

function shortDate(iso: string): string {
  return format(parseISO(iso), "d MMM", { locale: es });
}

export default function LossesReportScreen() {
  const c = useAppColors();
  const [period, setPeriod] = useState<Period>(() => currentMonth());
  const [data, setData] = useState<LossesBreakdown>(EMPTY_LOSSES);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await getLossesBreakdown(period.from, period.to);
      if (!active) return;
      setData(result);
      setExpanded(new Set());
    })();
    return () => {
      active = false;
    };
  }, [period]);

  const toggle = (type: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const lossRows: (string | number)[][] = [
        ["Categoría", "Concepto", "Fecha", "Monto"],
      ];
      for (const cat of data.categories) {
        for (const r of cat.records) {
          lossRows.push([cat.label, r.label, r.date, r.amount]);
        }
      }
      lossRows.push(["TOTAL", "", "", data.total]);
      await exportToExcel(`reporte_perdidas_${period.from}.xlsx`, [
        { name: "Pérdidas", rows: lossRows },
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
  }, [data, period]);

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
        <HeroCard color={c.danger} padding={20}>
          <Text
            style={{
              fontSize: FontSize.xs,
              fontWeight: "700",
              color: Overlay.text,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Total de pérdidas y gastos
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
            {formatCurrency(data.total)}
          </Text>
        </HeroCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(360).springify()}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "700",
            color: c.textMuted,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Categorías
        </Text>
      </Animated.View>
    </View>
  );

  const renderCategory = (item: LossCategory, index: number) => {
    const isExpanded = expanded.has(item.type);
    const hasRecords = item.records.length > 0;
    return (
      <Animated.View
        entering={FadeInDown.delay(160 + index * 30).duration(280)}
      >
        <View
          style={{
            backgroundColor: c.surface,
            borderRadius: Radius.lg,
            padding: 14,
            borderCurve: "continuous",
            boxShadow: Shadows.sm,
          }}
        >
          <Pressable
            onPress={() => hasRecords && toggle(item.type)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{
                  fontSize: FontSize.base,
                  fontWeight: "600",
                  color: c.text,
                }}
              >
                {item.label}
              </Text>
              <Text style={{ fontSize: FontSize.sm, color: c.tabIconDefault }}>
                {getTypeLabel(item.type)} · {item.records.length}{" "}
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
            {hasRecords ? (
              <IconSymbol
                name="chevron.right"
                size={16}
                color={c.tabIconDefault}
                style={{
                  transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                }}
              />
            ) : null}
          </Pressable>

          {isExpanded && hasRecords ? (
            <View
              style={{
                marginTop: 12,
                paddingTop: 12,
                gap: 10,
                borderTopWidth: 1,
                borderTopColor: c.border,
              }}
            >
              {item.records.map((r) => (
                <View
                  key={r.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text
                    style={{
                      fontSize: FontSize.xs,
                      color: c.tabIconDefault,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {shortDate(r.date)}
                  </Text>
                  <Text
                    style={{ flex: 1, fontSize: FontSize.md, color: c.text }}
                    numberOfLines={1}
                  >
                    {r.label}
                  </Text>
                  <Text
                    style={{
                      fontSize: FontSize.md,
                      fontWeight: "600",
                      color: c.text,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatCurrency(r.amount)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Pérdidas y gastos" }} />
      <FlatList
        data={data.categories}
        extraData={expanded}
        keyExtractor={(item) => item.type}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => renderCategory(item, index)}
        ListFooterComponent={
          <Animated.View
            entering={FadeInDown.delay(240).duration(320)}
            style={{
              marginTop: 18,
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
              Total general
            </Text>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "800",
                color: c.danger,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCurrency(data.total)}
            </Text>
          </Animated.View>
        }
      />
    </View>
  );
}
