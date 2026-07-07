import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'overline';

interface UITextProps extends TextProps {
  variant?: Variant;
  tabular?: boolean;
}

const variantStyles: Record<Variant, string> = {
  display: 'text-5xl font-bold text-slate-900 dark:text-slate-100 tracking-tight',
  title: 'text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight',
  heading: 'text-lg font-semibold text-slate-900 dark:text-slate-100',
  body: 'text-base text-slate-700 dark:text-slate-300',
  label: 'text-sm font-medium text-slate-700 dark:text-slate-300',
  caption: 'text-xs text-slate-500 dark:text-slate-400',
  overline: 'text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider',
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
