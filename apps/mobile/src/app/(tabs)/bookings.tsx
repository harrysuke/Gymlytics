import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, space } from '../../lib/theme';

interface Booking {
  id: string;
  status: string;
  classId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  programName: string;
  capacity: number;
  bookedCount: number;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function BookingsScreen() {
  const session = useAuthedSession();
  const router = useRouter();

  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [future, history] = await Promise.all([
        apiFetch<Booking[]>('/v1/me/bookings', { token: session.accessToken }),
        apiFetch<Booking[]>('/v1/me/bookings', {
          token: session.accessToken,
          query: { includePast: true },
        }),
      ]);
      const futureIds = new Set(future.map((booking) => booking.id));
      setUpcoming(future);
      setPast(history.filter((booking) => !futureIds.has(booking.id)));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmCancel(booking: Booking): void {
    Alert.alert('Cancel booking?', `${booking.title} · ${when(booking.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusyId(booking.id);
            try {
              await apiFetch(`/v1/bookings/${booking.id}`, { method: 'DELETE', token: session.accessToken });
              await load();
            } catch (caught) {
              Alert.alert('Could not cancel', describeError(caught));
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }

  if (loading) return <Loading label="Loading your classes…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <Screen>
      <SectionTitle hint="Cancel up to the start time without penalty.">Upcoming</SectionTitle>

      {!upcoming.length ? (
        <EmptyState title="Nothing booked" body="Head to the schedule tab to reserve your next class." />
      ) : (
        upcoming.map((booking) => (
          <Card key={booking.id} style={{ marginBottom: space.sm }}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{booking.title}</Text>
              <Badge value={booking.status} />
            </View>
            <Text style={styles.meta}>{booking.programName}</Text>
            <Text style={styles.when}>{when(booking.startsAt)}</Text>
            <View style={styles.actions}>
              <Text style={styles.link} onPress={() => router.push(`/class/${booking.classId}`)}>
                View class
              </Text>
              <View style={{ minWidth: 130 }}>
                <Button
                  label="Cancel"
                  variant="danger"
                  loading={busyId === booking.id}
                  onPress={() => confirmCancel(booking)}
                />
              </View>
            </View>
          </Card>
        ))
      )}

      {past.length ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle hint="Your training history.">Past</SectionTitle>
          {past.slice(0, 20).map((booking) => (
            <Card key={booking.id} style={{ marginBottom: space.sm }}>
              <View style={styles.rowBetween}>
                <Text style={styles.title}>{booking.title}</Text>
                <Badge value={booking.status} />
              </View>
              <Text style={styles.meta}>
                {booking.programName} · {when(booking.startsAt)}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink900, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.ink500, marginTop: 3 },
  when: { fontSize: 14, fontWeight: '600', color: colors.mat700, marginTop: 6 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
  },
  link: { fontSize: 13, fontWeight: '700', color: colors.mat700 },
});
