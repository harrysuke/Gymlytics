import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuth, useAuthedSession } from '../../lib/auth-context';
import { colors, radius, space } from '../../lib/theme';

interface Me {
  user: { id: string; firstName: string; lastName: string; email: string | null; role: string; status: string };
  academy: { id: string; name: string; slug: string; currency: string; timezone: string } | null;
  dependents: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    canBookClasses: boolean;
    canSignWaivers: boolean;
  }[];
}

export default function ProfileScreen() {
  const session = useAuthedSession();
  const { signOut } = useAuth();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>('/v1/auth/me', { token: session.accessToken }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;

  const user = me?.user ?? session.user;
  const academy = me?.academy ?? session.academy;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user.firstName.charAt(0)}
            {user.lastName.charAt(0)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>
            {user.firstName} {user.lastName}
          </Text>
          <Text style={styles.meta}>{user.email ?? 'No email on file'}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            <Badge value={user.status} />
            <Badge value={user.role} />
          </View>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={{ marginTop: space.xl }}>
        <SectionTitle>Academy</SectionTitle>
        <Card>
          <Text style={styles.cardTitle}>{academy.name}</Text>
          <Text style={styles.meta}>
            {academy.slug} · {academy.currency} · {academy.timezone}
          </Text>
        </Card>
      </View>

      {me?.dependents.length ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle hint="Book and sign on their behalf.">Family</SectionTitle>
          {me.dependents.map((child) => (
            <Card key={child.id} style={{ marginBottom: space.sm }}>
              <Text style={styles.cardTitle}>
                {child.firstName} {child.lastName}
              </Text>
              <Text style={styles.meta}>
                {child.dateOfBirth
                  ? `${Math.floor((Date.now() - new Date(child.dateOfBirth).getTime()) / (365.25 * 86_400_000))} years old`
                  : 'Age not recorded'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Badge value={child.canBookClasses ? 'active' : 'frozen'} />
                <Text style={styles.meta}>{child.canSignWaivers ? 'You can sign waivers' : 'Waiver by guardian only'}</Text>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: space.xxl }}>
        <Button
          label="Sign out"
          variant="danger"
          onPress={() =>
            Alert.alert('Sign out?', 'You will need your password to sign back in.', [
              { text: 'Stay', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: space.lg, alignItems: 'center', marginTop: space.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.mat100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '800', color: colors.mat700 },
  name: { fontSize: 22, fontWeight: '800', color: colors.ink900 },
  meta: { fontSize: 12, color: colors.ink500, marginTop: 3 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink900 },
  error: {
    marginTop: space.lg,
    color: colors.rose700,
    backgroundColor: colors.rose50,
    borderRadius: radius.sm,
    padding: 10,
    fontSize: 13,
  },
});
