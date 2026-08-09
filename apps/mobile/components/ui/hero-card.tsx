import { Pressable, View, type ViewStyle } from "react-native";

import { Colors, Overlay, Radius, Shadows } from "@/drizzle/constants/theme";

/**
 * Reusable hero card with tinted background and decorative orb overlays.
 * Replaces the copy-pasted pattern across the tab screens.
 */
interface HeroCardProps {
  /** Primary background color. Defaults to the app tint. */
  color?: string;
  /** Inner padding. Defaults to Radius.xl (20). */
  padding?: number;
  /** When provided, the card becomes tappable with press feedback. */
  onPress?: () => void;
  /** Extra ViewStyle overrides. */
  style?: ViewStyle;
  children: React.ReactNode;
}

export function HeroCard({
  color = Colors.light.tint,
  padding = Radius.xl,
  onPress,
  style,
  children,
}: HeroCardProps) {
  const content = (
    <>
      {/* Decorative orb — top right */}
      <View
        style={{
          position: "absolute",
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
          position: "absolute",
          right: 30,
          bottom: -50,
          width: 110,
          height: 110,
          borderRadius: 55,
          backgroundColor: Overlay.subtle,
        }}
      />
      {children}
    </>
  );

  const baseStyle: ViewStyle = {
    backgroundColor: color,
    borderRadius: Radius.xl,
    padding,
    gap: 6,
    borderCurve: "continuous",
    boxShadow: Shadows.hero,
    overflow: "hidden",
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [
          baseStyle,
          { opacity: pressed ? 0.92 : 1 },
          style,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[baseStyle, style]}>{content}</View>;
}
