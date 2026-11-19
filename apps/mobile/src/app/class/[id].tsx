import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Button, Card, ErrorState, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, radius, space } from '../../lib/theme';

interface ClassDetail {
  id: string;
  title: string;
  programName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  checkedInCount: number;
  location: string | null;
  status: string;
  spotsLeft: number;
  techniques: { id: string; name: string; category: string | null }[];
  roster: { userId: string; firstName: string; lastName: string; bookingStatus: string }[];
}

interface Booking {
  id: string;
  classId: string;
  status: string;
}

export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useAuthedSession();
  const router = useRouter();

  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [myBooking, setMyBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [classDetail, mine] = await Promise.all([
        apiFetch<ClassDetail>(`/v1/classes/${id}`, { token: session.accessToken }),
        apiFetch<Booking[]>('/v1/me/bookings', {
          token: session.accessToken,
          query: { includePast: true },
        }),
      ]);
      setDetail(classDetail);
      setMyBooking(mine.find((booking) => booking.classId === id) ?? null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [id, session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function book(): Promise<void> {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ waitlisted: boolean }>(`/v1/classes/${detail.id}/bookings`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          academyId: session.academy.id,
          classId: detail.id,
          userId: session.user.id,
          source: 'mobile',
        },
      });
      Alert.alert(result.waitlisted ? 'Added to waitlist' : 'Booked', 'See you on the mat.');
      await load();
    } catch (caught) {
      Alert.alert('Could not book', describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!myBooking) return;
    setBusy(true);
    try {
      await apiFetch(`/v1/bookings/${myBooking.id}`, { method: 'DELETE', token: session.accessToken });
      await load();
    } catch (caught) {
      Alert.alert('Could not cancel', describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return <ErrorState message="Class not found" onRetry={() => void load()} />;

  const started = new Date(detail.startsAt) < new Date();
  const full = detail.spotsLeft === 0;

  return (
    <Screen>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>{detail.title}</Text>
          <Badge value={detail.status} />
        </View>
        <Text style={styles.program}>{detail.programName}</Text>

        <Text style={styles.when}>
          {new Date(detail.startsAt).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>
        <Text style={styles.time}>
          {new Date(detail.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
          {new Date(detail.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {detail.bookedCount}/{detail.capacity}
            </Text>
            <Text style={styles.statLabel}>booked</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{detail.checkedInCount}</Text>
            <Text style={styles.statLabel}>checked in</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{detail.spotsLeft}</Text>
            <Text style={styles.statLabel}>spots left</Text>
          </View>
        </View>

        <Text style={styles.location}>{detail.location ?? 'Main mat'}</Text>

        {started ? (
          <Text style={styles.closed}>This class has already started.</Text>
        ) : myBooking ? (
          <Button label="Cancel booking" variant="danger" loading={busy} onPress={() => void cancel()} />
        ) : (
          <Button
            label={full ? 'Join waitlist' : 'Book this class'}
            loading={busy}
            onPress={() => void book()}
          />
        )}
      </Card>

      {detail.techniques.length ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle hint="What the coach is teaching.">Curriculum</SectionTitle>
          <Card>
            {detail.techniques.map((technique) => (
              <View key={technique.id} style={styles.technique}>
                <Text style={styles.techniqueName}>{technique.name}</Text>
                <Text style={styles.techniqueCategory}>{technique.category ?? 'general'}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {detail.roster.length ? (
        <View style={{ marginTop: space.xl }}>
          <SectionTitle hint={`${detail.roster.length} on the mat`}>Who's coming</SectionTitle>
          <Card>
            {detail.roster.slice(0, 12).map((entry) => (
              <View key={`${entry.userId}-${entry.bookingStatus}`} style={styles.rosterRow}>
                <Text style={styles.rosterName}>
                  {entry.firstName} {entry.lastName}
                </Text>
                <Badge value={entry.bookingStatus} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <Button label="Back to schedule" variant="ghost" onPress={() => router.push('/schedule')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink900, flexShrink: 1 },
  program: { fontSize: 13, color: colors.ink500, marginTop: 4 },
  when: { fontSize: 15, fontWeight: '700', color: colors.ink800, marginTop: space.lg },
  time: { fontSize: 14, color: colors.mat700, fontWeight: '600', marginTop: 2 },
  statRow: {
    flexDirection: 'row',
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink900 },
  statLabel: { fontSize: 11, color: colors.ink500, marginTop: 2 },
  location: { fontSize: 12, color: colors.ink500, marginTop: space.lg, marginBottom: space.md },
  closed: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.ink500,
    backgroundColor: colors.ink50,
    borderRadius: radius.sm,
    padding: 12,
  },
  technique: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ink100,
  },
  techniqueName: { fontSize: 14, color: colors.ink800, flexShrink: 1 },
  techniqueCategory: { fontSize: 11, color: colors.ink400, textTransform: 'capitalize' },
  rosterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ink100,
  },
  rosterName: { fontSize: 14, color: colors.ink800 },
});
