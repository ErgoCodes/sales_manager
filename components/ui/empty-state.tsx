import { Pressable, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Semantic, Radius } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

interface EmptyStateProps {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  badge?: string;
}

export function EmptyState({ icon, title, description, action, badge }: EmptyStateProps) {
  const c = useAppColors();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        paddingHorizontal: 24,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          backgroundColor: c.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          borderCurve: 'continuous',
          marginBottom: 4,
        }}
      >
        <IconSymbol name={icon} size={36} color={c.tabIconDefault} />
      </View>
      {badge ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: Semantic.warningSoft,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: Semantic.warningDark, letterSpacing: 0.4 }}>
            {badge.toUpperCase()}
          </Text>
        </View>
      ) : null}
      <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, textAlign: 'center' }}>{title}</Text>
      {description ? (
        <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 20 }}>
          {description}
        </Text>
      ) : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => ({
            marginTop: 8,
            paddingHorizontal: 18,
            paddingVertical: 11,
            borderRadius: Radius.md,
            backgroundColor: Colors.light.tint,
            opacity: pressed ? 0.85 : 1,
            borderCurve: 'continuous',
          })}
        >
          <Text style={{ color: Colors.light.surface, fontSize: 14, fontWeight: '600' }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
