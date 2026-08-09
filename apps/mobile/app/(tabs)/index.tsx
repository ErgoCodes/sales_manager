import { format } from "date-fns";
import { es } from "date-fns/locale";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { HeroCard } from "@/components/ui/hero-card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StatCard } from "@/components/ui/stat-card";
import {
  countLowStock,
  getDailySummary,
  type DailySummary,
} from "@/db/queries";
import { useAppColors } from "@/hooks/use-app-colors";
import { formatCurrency } from "@/lib/format";

const EMPTY_SUMMARY: DailySummary = {
  cash: 0,
  transfer: 0,
  total: 0,
  profit: 0,
};

interface QuickActionProps {
  icon: Parameters<typeof IconSymbol>[0]["name"];
  label: string;
  onPress: () => void;
  accent: string;
  bg: string;
}

function QuickAction({ icon, label, onPress, accent, bg }: QuickActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 bg-surface rounded-2xl py-3.5 items-center gap-2 shadow-md active:opacity-70"
    >
      <View
        className="w-10 h-10 rounded-xl items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <IconSymbol name={icon} size={20} color={accent} />
      </View>
      <Text className="text-[14px] font-semibold text-text-strong text-center">
        {label}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const c = useAppColors();
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [lowStockCount, setLowStockCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const today = format(new Date(), "yyyy-MM-dd");
      (async () => {
        const [s, lsc] = await Promise.all([
          getDailySummary(today),
          countLowStock(),
        ]);
        if (active) {
          setSummary(s);
          setLowStockCount(lsc);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es });
  const todayCap = today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4 pb-8 gap-4"
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <Animated.View entering={FadeInDown.duration(380).springify()}>
        <Text className="text-[15px] text-tab-default font-medium tracking-wide">
          {todayCap}
        </Text>
        <Text className="text-[24px] font-bold text-text-strong mt-0.5">
          Resumen del día
        </Text>
      </Animated.View>

      {/* HERO Card */}
      <Animated.View entering={FadeInDown.delay(60).duration(380).springify()}>
        <HeroCard onPress={() => router.push("/(tabs)/sales")} padding={22}>
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-bold text-white/75 tracking-[1px] uppercase">
              Total del día
            </Text>
            <View className="flex-row items-center gap-1 bg-white/15 px-2.5 py-1 rounded-full">
              <Text className="text-[13px] font-semibold text-white">
                Ver desglose
              </Text>
              <IconSymbol
                name="arrow.up.right"
                size={11}
                color="#FFFFFF"
              />
            </View>
          </View>

          <Text
            selectable
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-[42px] font-extrabold text-white tracking-[-1.2px] mt-1.5"
          >
            {formatCurrency(summary.total)}
          </Text>

          <View className="flex-row items-center gap-2 mt-2 pt-3 border-t border-white/15">
            <IconSymbol name="sparkles" size={14} color="rgba(255,255,255,0.85)" />
            <Text className="text-[15px] text-white/85 font-medium">
              Utilidad
            </Text>
            <Text
              style={{ fontVariant: ["tabular-nums"] }}
              className="text-[15px] font-bold text-white"
            >
              {formatCurrency(summary.profit)}
            </Text>
          </View>
        </HeroCard>
      </Animated.View>

      {/* Stats grid */}
      <Animated.View
        entering={FadeInDown.delay(120).duration(380).springify()}
        className="flex-row gap-3"
      >
        <StatCard
          label="Efectivo"
          value={formatCurrency(summary.cash)}
          accent={c.cash}
          iconBg={c.cashSoft}
          icon="dollarsign.circle.fill"
        />
        <StatCard
          label="Transferencia"
          value={formatCurrency(summary.transfer)}
          accent={c.transfer}
          iconBg={c.transferSoft}
          icon="arrow.left.arrow.right.circle.fill"
        />
      </Animated.View>

      {/* Quick actions */}
      <Animated.View
        entering={FadeInDown.delay(180).duration(380).springify()}
        className="gap-2.5"
      >
        <Text className="text-[13px] font-bold text-text-muted tracking-wide uppercase ml-1">
          Acciones rápidas
        </Text>
        <View className="flex-row gap-2.5">
          <QuickAction
            icon="cart.fill"
            label="Nueva venta"
            onPress={() => router.push("/sales/new-session")}
            accent={c.cash}
            bg={c.cashSoft}
          />
          <QuickAction
            icon="shippingbox.fill"
            label="Entrada"
            onPress={() => router.push("/inventory/stock-entry")}
            accent={c.transfer}
            bg={c.transferSoft}
          />
          <QuickAction
            icon="square.grid.2x2"
            label="Catálogo"
            onPress={() => router.push("/catalog")}
            accent={c.tint}
            bg={c.tealSoft}
          />
        </View>
      </Animated.View>

      {/* Low stock alert */}
      <Animated.View entering={FadeInDown.delay(240).duration(380).springify()}>
        {lowStockCount > 0 ? (
          <Pressable
            onPress={() => router.push("/(tabs)/inventory")}
            className="flex-row items-center gap-3 bg-semantic-danger-soft rounded-2xl p-3.5 active:opacity-85"
          >
            <View className="w-10 h-10 rounded-xl bg-semantic-danger items-center justify-center">
              <IconSymbol
                name="exclamationmark.triangle.fill"
                size={20}
                color={c.surface}
              />
            </View>
            <View className="flex-1">
              <Text className="text-[16px] font-bold text-semantic-danger-dark">
                Stock bajo en {lowStockCount} producto
                {lowStockCount > 1 ? "s" : ""}
              </Text>
              <Text className="text-[14px] text-semantic-danger-dark mt-0.5">
                Toca para revisar el inventario
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={18} color={c.danger} />
          </Pressable>
        ) : (
          <View className="flex-row items-center gap-2.5 bg-surface rounded-2xl p-3.5 shadow-sm">
            <View className="w-9 h-9 rounded-xl bg-semantic-cash-soft items-center justify-center">
              <IconSymbol
                name="checkmark.circle.fill"
                size={20}
                color={c.cash}
              />
            </View>
            <Text className="text-[15px] text-text-muted font-medium flex-1">
              Inventario en orden — sin alertas
            </Text>
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}
