import { View, type ViewProps } from 'react-native';

import { Shadows, Radius } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

type Variant = 'default' | 'tinted' | 'outline' | 'flat';

interface CardProps extends ViewProps {
  variant?: Variant;
  padded?: boolean;
}

export function Card({
  variant = 'default',
  padded = true,
  style,
  children,
  ...props
}: CardProps) {
  const c = useAppColors();
  const shadow = variant === 'default' ? Shadows.md : undefined;

  let bg = c.surface;
  let borderColor = 'transparent';
  let borderWidth = 0;

  if (variant === 'tinted') {
    bg = c.scheme === 'dark' ? '#134E4A' : c.tealSoft;
  } else if (variant === 'outline') {
    bg = c.surface;
    borderColor = c.border;
    borderWidth = 1;
  } else if (variant === 'flat') {
    bg = c.surfaceMuted;
  }

  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderColor,
          borderWidth,
          borderRadius: Radius.lg,
          padding: padded ? 16 : 0,
          borderCurve: 'continuous',
        },
        shadow ? { boxShadow: shadow } : null,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
