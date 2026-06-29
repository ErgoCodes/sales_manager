import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'overline';

interface UITextProps extends TextProps {
  variant?: Variant;
  tabular?: boolean;
}

const variantStyles: Record<Variant, string> = {
  display: 'text-5xl font-bold text-slate-900 tracking-tight',
  title: 'text-2xl font-bold text-slate-900 tracking-tight',
  heading: 'text-lg font-semibold text-slate-900',
  body: 'text-base text-slate-700',
  label: 'text-sm font-medium text-slate-700',
  caption: 'text-xs text-slate-500',
  overline: 'text-xs font-bold text-slate-500 uppercase tracking-wider',
};

const dataVariants = new Set<Variant>(['display', 'title', 'heading', 'body']);

export function Text({ variant = 'body', tabular, className = '', style, selectable, ...props }: UITextProps) {
  const isData = dataVariants.has(variant);
  const composedStyle = tabular
    ? [{ fontVariant: ['tabular-nums' as const] }, style]
    : style;
  return (
    <RNText
      selectable={selectable ?? isData}
      className={`${variantStyles[variant]} ${className}`}
      style={composedStyle}
      {...props}
    />
  );
}
