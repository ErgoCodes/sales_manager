import { View, type ViewStyle } from 'react-native';

import { Colors, Overlay, Radius, Shadows } from '@/constants/theme';

/**
 * Reusable hero card with tinted background and decorative orb overlays.
 * Replaces the copy-pasted pattern across 4 tab screens.
 */
interface HeroCardProps {
  /** Primary background color. Defaults to the app tint. */
  color?: string;
  /** Extra ViewStyle overrides. */
  style?: ViewStyle;
  children: React.ReactNode;
}

export function HeroCard({ color = Colors.light.tint, style, children }: HeroCardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: color,
          borderRadius: Radius.xl,
          padding: Radius.xl,
          gap: 6,
          borderCurve: 'continuous',
          boxShadow: Shadows.hero,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* Decorative orb — top right */}
      <View
        style={{
          position: 'absolute',
          right: -40,
          top: -30,
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: Overlay.light,
        }}
      />
      {/* Decorative orb — bottom right */}
      <View
        style={{
          position: 'absolute',
          right: 30,
          bottom: -50,
          width: 110,
          height: 110,
          borderRadius: 55,
          backgroundColor: Overlay.subtle,
        }}
      />
      {children}
    </View>
  );
}
