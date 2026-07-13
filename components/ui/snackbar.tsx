import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";

import { Radius, Shadows } from "@/drizzle/constants/theme";
import { useAppColors } from "@/hooks/use-app-colors";

interface SnackbarProps {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 5000. */
  duration?: number;
}

/**
 * Lightweight toast anchored to the bottom of the screen. Fades in on `visible`,
 * auto-dismisses after `duration`, and exposes an optional action (e.g. DESHACER).
 */
export function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 5000,
}: SnackbarProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const c = useAppColors();

  useEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, message, duration]);

  useEffect(() => {
    if (visible) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        opacity,
        position: "absolute",
        bottom: 32,
        left: 16,
        right: 16,
        zIndex: 50,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderRadius: Radius.lg,
          backgroundColor: c.scheme === "dark" ? "#334155" : "#1E293B",
          paddingHorizontal: 16,
          paddingVertical: 12,
          boxShadow: Shadows.lg,
        }}
      >
        <Text style={{ flex: 1, color: "#FFFFFF", fontSize: 14 }}>
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              onAction();
              onDismiss();
            }}
          >
            <Text
              style={{
                color: c.scheme === "dark" ? "#5EEAD4" : "#5EEAD4",
                fontSize: 14,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
