import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAppColors } from "@/hooks/use-app-colors";

type IconName = Parameters<typeof IconSymbol>[0]["name"];

interface ReportCardProps {
  icon: IconName;
  title: string;
  subtitle: string;
  delay: number;
  onPress?: () => void;
  disabled?: boolean;
}

function ReportCard({
  icon,
  title,
  subtitle,
  delay,
  onPress,
  disabled,
}: ReportCardProps) {
  const c = useAppColors();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(320).springify()}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={`flex-row items-center gap-3.5 bg-surface rounded-2xl p-4 shadow-sm active:opacity-85 ${disabled ? "opacity-55" : ""}`}
      >
        <View className="w-[44px] h-[44px] rounded-[14px] bg-surface-muted items-center justify-center">
          <IconSymbol name={icon} size={22} color={c.tint} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="text-[16px] font-bold text-text-strong">
              {title}
            </Text>
            {disabled ? <Badge tone="neutral" label="Próximamente" /> : null}
          </View>
          <Text className="text-[14px] text-text-muted">
            {subtitle}
          </Text>
        </View>
        {!disabled ? (
          <IconSymbol name="chevron.right" size={18} color={c.tabIconDefault} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function ReportsScreen() {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4 gap-3"
      showsVerticalScrollIndicator={false}
    >
      <ReportCard
        icon="chart.bar.fill"
        title="Reporte diario"
        subtitle="Ventas del día con detalle e inventario"
        delay={0}
        onPress={() => router.push("/reports/daily")}
      />
      <ReportCard
        icon="calendar"
        title="Semanal y mensual"
        subtitle="Totales por período para compartir"
        delay={60}
        onPress={() => router.push("/reports/period")}
      />
      <ReportCard
        icon="sparkles"
        title="Rankings"
        subtitle="Más vendidos y más rentables"
        delay={120}
        onPress={() => router.push("/reports/rankings")}
      />
      <ReportCard
        icon="shippingbox.fill"
        title="Entradas de inventario"
        subtitle="Resumen de compras por producto"
        delay={180}
        onPress={() => router.push("/reports/stock-entries")}
      />
      <ReportCard
        icon="creditcard.fill"
        title="Pérdidas y gastos"
        subtitle="Desglose por categoría"
        delay={240}
        onPress={() => router.push("/reports/losses")}
      />
    </ScrollView>
  );
}
