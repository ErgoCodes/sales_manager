import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'body' | 'caption' | 'label' | 'heading' | 'title';

interface UITextProps extends TextProps {
  variant?: Variant;
}

const variantStyles: Record<Variant, string> = {
  title: 'text-2xl font-bold text-gray-900',
  heading: 'text-lg font-semibold text-gray-900',
  body: 'text-base text-gray-700',
  label: 'text-sm font-medium text-gray-700',
  caption: 'text-xs text-gray-500',
};

export function Text({ variant = 'body', className = '', ...props }: UITextProps) {
  return <RNText className={`${variantStyles[variant]} ${className}`} {...props} />;
}
