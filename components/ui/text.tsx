import { Text as RNText, type TextProps } from 'react-native';

import { FontSize } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'overline';

interface UITextProps extends TextProps {
  variant?: Variant;
  tabular?: boolean;
}

const dataVariants = new Set<Variant>(['display', 'title', 'heading', 'body']);

export function Text({ variant = 'body', tabular, style, selectable, ...props }: UITextProps) {
  const c = useAppColors();
  const isData = dataVariants.has(variant);

  let fontSize: number = FontSize.base;
  let fontWeight: '400' | '500' | '600' | '700' | '800' = '400';
  let color = c.text;
  let letterSpacing = 0;
  let textTransform: 'none' | 'uppercase' = 'none';

  if (variant === 'display') {
    fontSize = 48; // aprox text-5xl
    fontWeight = '800';
    color = c.text;
    letterSpacing = -1.2;
  } else if (variant === 'title') {
    fontSize = FontSize['2xl'];
    fontWeight = '700';
    color = c.text;
    letterSpacing = -0.5;
  } else if (variant === 'heading') {
    fontSize = FontSize.xl;
    fontWeight = '600';
    color = c.text;
  } else if (variant === 'body') {
    fontSize = FontSize.base;
    fontWeight = '400';
    color = c.text;
  } else if (variant === 'label') {
    fontSize = FontSize.sm;
    fontWeight = '500';
    color = c.text;
  } else if (variant === 'caption') {
    fontSize = FontSize.xs;
    fontWeight = '400';
    color = c.textMuted;
  } else if (variant === 'overline') {
    fontSize = FontSize.xs;
    fontWeight = '700';
    color = c.textMuted;
    textTransform = 'uppercase';
    letterSpacing = 0.5;
  }

  const composedStyle = tabular
    ? [{ fontVariant: ['tabular-nums' as const] }, style]
    : style;

  return (
    <RNText
      selectable={selectable ?? isData}
      style={[
        {
          fontSize,
          fontWeight,
          color,
          letterSpacing,
          textTransform,
        },
        composedStyle,
      ]}
      {...props}
    />
  );
}
