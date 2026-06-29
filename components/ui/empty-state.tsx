import { Pressable, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';

interface EmptyStateProps {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  badge?: string;
}

export function EmptyState({ icon, title, description, action, badge }: EmptyStateProps) {
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
          backgroundColor: '#F1F5F9',
          alignItems: 'center',
          justifyContent: 'center',
          borderCurve: 'continuous',
          marginBottom: 4,
        }}
      >
        <IconSymbol name={icon} size={36} color="#94A3B8" />
      </View>
      {badge ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: '#FEF3C7',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400E', letterSpacing: 0.4 }}>
            {badge.toUpperCase()}
          </Text>
        </View>
      ) : null}
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A', textAlign: 'center' }}>{title}</Text>
      {description ? (
        <Text style={{ fontSize: 14, color: '#64748B', textAlign: 'center', maxWidth: 280, lineHeight: 20 }}>
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
            borderRadius: 14,
            backgroundColor: Colors.light.tint,
            opacity: pressed ? 0.85 : 1,
            borderCurve: 'continuous',
          })}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
