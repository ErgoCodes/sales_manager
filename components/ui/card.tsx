import { View, type ViewProps } from 'react-native';

import { Shadows } from '@/constants/theme';

type Variant = 'default' | 'tinted' | 'outline' | 'flat';

interface CardProps extends ViewProps {
  variant?: Variant;
  padded?: boolean;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-surface dark:bg-slate-900',
  tinted: 'bg-primary-soft dark:bg-teal-950',
  outline: 'bg-surface dark:bg-slate-900 border border-border dark:border-slate-700',
  flat: 'bg-surface-muted dark:bg-slate-800',
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
