import { View, type ViewProps } from 'react-native';

import { Shadows } from '@/constants/theme';

type Variant = 'default' | 'tinted' | 'outline' | 'flat';

interface CardProps extends ViewProps {
  variant?: Variant;
  padded?: boolean;
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-white',
  tinted: 'bg-teal-50',
  outline: 'bg-white border border-slate-200',
  flat: 'bg-slate-50',
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
      className={`rounded-2xl ${variantClasses[variant]} ${padded ? 'p-4' : ''} ${className}`}
      style={[{ borderCurve: 'continuous' }, shadow ? { boxShadow: shadow } : null, style]}
      {...props}
    >
      {children}
    </View>
  );
}
