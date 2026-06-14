import { Pressable, Text, type PressableProps } from 'react-native';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  label: string;
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-blue-600 active:bg-blue-700',
  outline: 'border border-blue-600 bg-transparent active:bg-blue-50',
  ghost: 'bg-transparent active:bg-gray-100',
  destructive: 'bg-red-600 active:bg-red-700',
};

const labelStyles: Record<Variant, string> = {
  default: 'text-white',
  outline: 'text-blue-600',
  ghost: 'text-gray-700',
  destructive: 'text-white',
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-1.5 rounded-md',
  md: 'px-4 py-2.5 rounded-lg',
  lg: 'px-6 py-3.5 rounded-xl',
};

const labelSizeStyles: Record<Size, string> = {
  sm: 'text-sm font-medium',
  md: 'text-base font-semibold',
  lg: 'text-lg font-semibold',
};

export function Button({ variant = 'default', size = 'md', label, disabled, ...props }: ButtonProps) {
  return (
    <Pressable
      className={`items-center justify-center ${variantStyles[variant]} ${sizeStyles[size]} ${disabled ? 'opacity-50' : ''}`}
      disabled={disabled}
      {...props}
    >
      <Text className={`${labelStyles[variant]} ${labelSizeStyles[size]}`}>{label}</Text>
    </Pressable>
  );
}
