import { View, type ViewProps } from 'react-native';

import { Shadows } from '@/constants/theme';

type Variant = 'default' | 'tinted' | 'outline' | 'flat';

interface CardProps extends ViewProps {
  variant?: Variant;
  padded?: boolean;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-surface',
  tinted: 'bg-primary-soft',
  outline: 'bg-surface border border-border',
  flat: 'bg-surface-muted',
};

export function Card({
  variant = 'default',
  padded = true,
  className = '',
  style,
  children,
  ...props
}: CardProps) {
  const shadow = variant === 'default' ? Shadows.md : undefined;
  return (
    <View
      className={`rounded-card ${variantClasses[variant]} ${padded ? 'p-4' : ''} ${className}`}
      style={[{ borderCurve: 'continuous' }, shadow ? { boxShadow: shadow } : null, style]}
      {...props}
    >
      {children}
    </View>
  );
}
