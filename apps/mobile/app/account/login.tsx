import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { AccountGate } from '@/components/account/account-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Radius } from '@/constants/theme';
import { useAppColors } from '@/hooks/use-app-colors';
import { session, type LoginResult } from '@/lib/session';
import { useSession } from '@/lib/session/react';

const ERRORS: Record<Extract<LoginResult, { ok: false }>['reason'], string> = {
  invalidCredentials: 'Correo o contraseña incorrectos.',
  rateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  unavailable: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
};

function LoginForm() {
  const c = useAppColors();
  const state = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sessionEnded = state.status === 'signedOut' && state.notice === 'sessionEnded';

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError('Ingresa tu correo y tu contraseña.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await session.login(email.trim(), password);
      if (!result.ok) setError(ERRORS[result.reason]);
    } finally {
      setSubmitting(false);
      setPassword('');
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
          Inicia sesión con tu cuenta del negocio para ver los datos del servidor. La caja de este dispositivo sigue
          funcionando sin conexión.
        </Text>
        {sessionEnded && !error ? (
          <View style={{ borderRadius: Radius.md, backgroundColor: c.warningSoft, padding: 12 }}>
            <Text variant="label" style={{ color: c.warningDark }}>
              Tu sesión terminó. Vuelve a iniciar sesión.
            </Text>
          </View>
        ) : null}
        <Input
          label="Correo"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          placeholder="nombre@negocio.com"
        />
        <Input
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={handleSubmit}
        />
        {error ? (
          <Text variant="label" style={{ color: c.danger }}>
            {error}
          </Text>
        ) : null}
        <Button label="Iniciar sesión" onPress={handleSubmit} loading={submitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function LoginScreen() {
  return (
    <AccountGate route="/account/login">
      <LoginForm />
    </AccountGate>
  );
}
