import { ActivityIndicator, Pressable, Text, View, type PressableProps } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

type Variant = 'default' | 'soft' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  label: string;
  icon?: Parameters<typeof IconSymbol>[0]['name'];
  loading?: boolean;
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-teal-700 active:bg-teal-800',
  soft: 'bg-teal-50 active:bg-teal-100 dark:bg-teal-950 dark:active:bg-teal-900',
  outline: 'border border-teal-700 dark:border-teal-500 bg-white dark:bg-slate-900 active:bg-teal-50 dark:active:bg-slate-800',
  ghost: 'bg-transparent active:bg-slate-100 dark:active:bg-slate-800',
  destructive: 'bg-red-600 active:bg-red-700',
};

const labelStyles: Record<Variant, string> = {
  default: 'text-white',
  soft: 'text-teal-700 dark:text-teal-300',
  outline: 'text-teal-700 dark:text-teal-300',
  ghost: 'text-slate-700 dark:text-slate-200',
  destructive: 'text-white',
};

const sizeStyles: Record<Size, { container: string; label: string; iconSize: number; minHeight: number }> = {
  sm: { container: 'px-3.5 py-2 rounded-xl', label: 'text-sm font-semibold', iconSize: 16, minHeight: 36 },
  md: { container: 'px-4 py-3 rounded-2xl', label: 'text-base font-semibold', iconSize: 18, minHeight: 46 },
  lg: { container: 'px-5 py-3.5 rounded-2xl', label: 'text-base font-semibold tracking-wide', iconSize: 20, minHeight: 52 },
};

export function Button({
  variant = 'default',
  size = 'md',
  label,
  icon,
  loading,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const c = useAppColors();
  const iconColors: Record<Variant, string> = {
    // default / destructive keep white content on their teal / red fill in both modes
    default: Colors.light.surface,
    soft: c.tint,
    outline: c.tint,
    ghost: c.text,
    destructive: Colors.light.surface,
  };
  const sizing = sizeStyles[size];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      className={`flex-row items-center justify-center gap-2 ${variantStyles[variant]} ${sizing.container} ${
        isDisabled ? 'opacity-50' : ''
      }`}
      style={[{ minHeight: sizing.minHeight, borderCurve: 'continuous' }, style as object]}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColors[variant]} />
      ) : icon ? (
        <IconSymbol name={icon} size={sizing.iconSize} color={iconColors[variant]} />
      ) : null}
      <Text className={`${labelStyles[variant]} ${sizing.label}`}>{label}</Text>
      <View />
    </Pressable>
  );
}
