import { useState } from 'react';
import { TextInput, View, Text, type TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, style, onFocus, onBlur, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? '#DC2626' : focused ? '#0F766E' : '#E2E8F0';
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155', letterSpacing: 0.1 }}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor="#94A3B8"
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
            color: '#0F172A',
            backgroundColor: '#FFFFFF',
            borderCurve: 'continuous',
          },
          style as object,
        ]}
        {...props}
      />
      {error ? (
        <Text style={{ fontSize: 12, color: '#DC2626' }}>{error}</Text>
      ) : hint ? (
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>{hint}</Text>
      ) : null}
    </View>
  );
}
