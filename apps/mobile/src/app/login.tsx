import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, Screen } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { describeError } from '../lib/api';
import { ACADEMY_SLUG } from '../lib/config';
import { colors, radius, space } from '../lib/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('daniel@student.test');
  const [password, setPassword] = useState('Password123!');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>G</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to book classes and track your progress.</Text>
        </View>

        <Card>
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" value={password} onChangeText={setPassword} secure />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Sign in" onPress={submit} loading={busy} />
        </Card>

        <Text style={styles.hint}>
          Academy: <Text style={styles.mono}>{ACADEMY_SLUG}</Text>
          {'\n'}Demo: daniel@student.test · Password123!
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: space.xxl, marginBottom: space.xl },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.mat600,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  logoText: { color: colors.white, fontSize: 26, fontWeight: '800' },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink900 },
  subtitle: { fontSize: 14, color: colors.ink500, marginTop: 6, textAlign: 'center' },
  error: {
    color: colors.rose700,
    backgroundColor: colors.rose50,
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: space.md,
    fontSize: 13,
  },
  hint: { marginTop: space.xl, textAlign: 'center', fontSize: 12, color: colors.ink400, lineHeight: 18 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), color: colors.ink500 },
});
