import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Badge } from '@/components/ui/badge';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontSize, Radius, Shadows } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

type IconName = Parameters<typeof IconSymbol>[0]['name'];

interface ReportCardProps {
  icon: IconName;
  title: string;
  subtitle: string;
  delay: number;
  onPress?: () => void;
  disabled?: boolean;
}

function ReportCard({ icon, title, subtitle, delay, onPress, disabled }: ReportCardProps) {
  const c = useAppColors();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(320).springify()}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          backgroundColor: c.surface,
          borderRadius: Radius.lg,
          padding: 16,
          borderCurve: 'continuous',
          boxShadow: Shadows.sm,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: c.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconSymbol name={icon} size={22} color={c.tint} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: FontSize.base, fontWeight: '700', color: c.text }}>{title}</Text>
            {disabled ? <Badge tone="neutral" label="Próximamente" /> : null}
          </View>
          <Text style={{ fontSize: FontSize.sm, color: c.textMuted }}>{subtitle}</Text>
        </View>
        {!disabled ? <IconSymbol name="chevron.right" size={18} color={c.tabIconDefault} /> : null}
      </Pressable>
    </Animated.View>
  );
}

export default function ReportsScreen() {
  const c = useAppColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      showsVerticalScrollIndicator={false}
    >
      <ReportCard
        icon="chart.bar.fill"
        title="Reporte diario"
        subtitle="Ventas del día con detalle e inventario"
        delay={0}
        onPress={() => router.push('/reports/daily')}
      />
      <ReportCard
        icon="calendar"
        title="Semanal y mensual"
        subtitle="Totales por período para compartir"
        delay={60}
        disabled
      />
      <ReportCard
        icon="sparkles"
        title="Rankings"
        subtitle="Más vendidos y más rentables"
        delay={120}
        disabled
      />
      <ReportCard
        icon="creditcard.fill"
        title="Pérdidas y gastos"
        subtitle="Desglose por categoría"
        delay={180}
        disabled
      />
    </ScrollView>
  );
}
