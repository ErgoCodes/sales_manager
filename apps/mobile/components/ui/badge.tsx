import { Text, View, type ViewProps } from 'react-native';

import { useAppColors } from '@/hooks/use-app-colors';

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'cost';
type Size = 'sm' | 'md';

interface BadgeProps extends ViewProps {
  label: string;
  tone?: BadgeTone;
  size?: Size;
  dot?: boolean;
}

export function Badge({ label, tone = 'neutral', size = 'sm', dot = false, style, ...props }: BadgeProps) {
  const c = useAppColors();
  const toneColors: Record<BadgeTone, { bg: string; fg: string }> = {
    success: { bg: c.cashSoft, fg: c.cash },
    info: { bg: c.transferSoft, fg: c.transfer },
    warning: { bg: c.warningSoft, fg: c.warningDark },
    danger: { bg: c.dangerSoft, fg: c.danger },
    neutral: { bg: c.neutralSoft, fg: c.neutral },
    cost: { bg: c.costSoft, fg: c.cost },
  };
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
