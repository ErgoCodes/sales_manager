import { Text, View, type ViewProps } from 'react-native';

import { Semantic } from '@/constants/theme';

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'cost';
type Size = 'sm' | 'md';

interface BadgeProps extends ViewProps {
  label: string;
  tone?: BadgeTone;
  size?: Size;
  dot?: boolean;
}

const toneColors: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: Semantic.cashSoft, fg: Semantic.cash },
  info: { bg: Semantic.transferSoft, fg: Semantic.transfer },
  warning: { bg: Semantic.warningSoft, fg: '#92400E' },
  danger: { bg: Semantic.dangerSoft, fg: Semantic.danger },
  neutral: { bg: Semantic.neutralSoft, fg: Semantic.neutral },
  cost: { bg: Semantic.costSoft, fg: Semantic.cost },
};

export function Badge({ label, tone = 'neutral', size = 'sm', dot = false, style, ...props }: BadgeProps) {
  const { bg, fg } = toneColors[tone];
  const px = size === 'sm' ? 8 : 10;
  const py = size === 'sm' ? 3 : 5;
  const fontSize = size === 'sm' ? 11 : 12;
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: bg,
          paddingHorizontal: px,
          paddingVertical: py,
          borderRadius: 999,
        },
        style,
      ]}
      {...props}
    >
      {dot ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
      ) : null}
      <Text
        style={{
          color: fg,
          fontSize,
          fontWeight: '600',
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
