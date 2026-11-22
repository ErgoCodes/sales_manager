import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { AccountGate } from '@/components/account/account-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAppColors } from '@/hooks/use-app-colors';
import { session, type ChangePasswordResult } from '@/lib/session';

/** Same bounds as `Password` in packages/contracts (12..256, no composition rules). */
const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

const ERRORS: Record<Extract<ChangePasswordResult, { ok: false }>['reason'], string> = {
  invalidCurrentPassword: 'La contraseña actual no es correcta.',
  invalidNewPassword: `La nueva contraseña no es válida: debe tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres y ser distinta de la actual.`,
  rateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  unavailable: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
};

function validate(current: string, next: string, confirmation: string): string | null {
  if (!current) return 'Ingresa tu contraseña actual.';
  if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
    return `La nueva contraseña debe tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`;
  }
  if (next === current) return 'La nueva contraseña debe ser distinta de la actual.';
  if (next !== confirmation) return 'Las contraseñas no coinciden.';
  return null;
}

function ChangePasswordForm() {
  const c = useAppColors();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const invalid = validate(current, next, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await session.changePassword(current, next);
      if (!result.ok) setError(ERRORS[result.reason]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text variant="caption">
          Antes de continuar tienes que cambiar tu contraseña. Se cerrará la sesión en tus otros dispositivos.
        </Text>
        <Input
          label="Contraseña actual"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
        <Input
          label="Nueva contraseña"
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`Entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`}
        />
        <Input
          label="Repite la nueva contraseña"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={handleSubmit}
        />
        {error ? (
          <Text variant="label" style={{ color: c.danger }}>
            {error}
          </Text>
        ) : null}
        <Button label="Cambiar contraseña" onPress={handleSubmit} loading={submitting} />
        <Button label="Cerrar sesión" variant="ghost" onPress={() => void session.logout()} disabled={submitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function ChangePasswordScreen() {
  return (
    <AccountGate route="/account/change-password">
      <ChangePasswordForm />
    </AccountGate>
  );
}
