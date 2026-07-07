import { addDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Pressable, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontSize, Radius, Shadows } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

export function formatDateHuman(iso: string): string {
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

export function DateBar({ date, onChange }: DateBarProps) {
  const c = useAppColors();
  const isToday = date === format(new Date(), 'yyyy-MM-dd');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c.surface,
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
          backgroundColor: pressed ? c.surfaceMuted : 'transparent',
        })}
      >
        <IconSymbol name="chevron.right" size={18} color={c.textMuted} style={{ transform: [{ rotate: '180deg' }] }} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
        <Text style={{ fontSize: FontSize.base, fontWeight: '700', color: c.text }}>{formatDateHuman(date)}</Text>
        <Text style={{ fontSize: FontSize.xs, color: c.tabIconDefault, fontVariant: ['tabular-nums'] }}>
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
          backgroundColor: pressed ? c.surfaceMuted : 'transparent',
        })}
      >
        <IconSymbol name="chevron.right" size={18} color={c.textMuted} />
      </Pressable>
    </View>
  );
}
