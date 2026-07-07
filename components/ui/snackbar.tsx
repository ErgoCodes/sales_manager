import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

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
      style={{ opacity }}
      className="absolute inset-x-4 bottom-8">
      <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-slate-800 dark:bg-slate-700 px-4 py-3 shadow-lg">
        <Text className="flex-1 text-white text-sm">{message}</Text>
        {actionLabel && onAction ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              onAction();
              onDismiss();
            }}>
            <Text className="text-teal-300 text-sm font-bold uppercase tracking-wide">
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
