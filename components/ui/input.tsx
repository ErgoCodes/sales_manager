import { useState } from 'react';
import { TextInput, View, Text, type TextInputProps } from 'react-native';

import { Colors, Semantic } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, style, onFocus, onBlur, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? Semantic.danger : focused ? Colors.light.tint : Colors.light.border;
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: Semantic.textDark, letterSpacing: 0.1 }}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={Colors.light.tabIconDefault}
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
            color: Colors.light.text,
            backgroundColor: Colors.light.surface,
            borderCurve: 'continuous',
          },
          style as object,
        ]}
        {...props}
      />
      {error ? (
        <Text style={{ fontSize: 12, color: Semantic.danger }}>{error}</Text>
      ) : hint ? (
        <Text style={{ fontSize: 12, color: Colors.light.tabIconDefault }}>{hint}</Text>
      ) : null}
    </View>
  );
}
