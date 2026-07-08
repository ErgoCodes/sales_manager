import { useState } from 'react';
import { TextInput, View, Text, type TextInputProps } from 'react-native';

import { useAppColors } from '@/hooks/use-app-colors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, style, onFocus, onBlur, ...props }: InputProps) {
  const c = useAppColors();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? c.tint : c.border;
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, letterSpacing: 0.1 }}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.tabIconDefault}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            borderWidth: 1.5,
            borderColor,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            color: c.text,
            backgroundColor: c.surface,
            borderCurve: 'continuous',
          },
          style as object,
        ]}
        {...props}
      />
      {error ? (
        <Text style={{ fontSize: 12, color: c.danger }}>{error}</Text>
      ) : hint ? (
        <Text style={{ fontSize: 12, color: c.tabIconDefault }}>{hint}</Text>
      ) : null}
    </View>
  );
}
