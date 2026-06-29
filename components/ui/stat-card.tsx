import { Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Shadows } from '@/constants/theme';

interface StatCardProps {
  label: string;
  value: string;
  accent?: string;
  icon?: Parameters<typeof IconSymbol>[0]['name'];
  iconBg?: string;
  caption?: string;
}

export function StatCard({ label, value, accent = '#0F172A', icon, iconBg, caption }: StatCardProps) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 14,
        gap: 10,
        borderCurve: 'continuous',
        boxShadow: Shadows.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', letterSpacing: 0.3, textTransform: 'uppercase' }}>
          {label}
        </Text>
        {icon ? (
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              backgroundColor: iconBg ?? `${accent}15`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconSymbol name={icon} size={18} color={accent} />
          </View>
        ) : null}
      </View>
      <Text
        selectable
        style={{
          fontSize: 22,
          fontWeight: '700',
          color: accent,
          letterSpacing: -0.5,
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      {caption ? (
        <Text style={{ fontSize: 11, color: '#94A3B8' }}>{caption}</Text>
      ) : null}
    </View>
  );
}
