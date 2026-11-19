import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Screen } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, radius, space } from '../../lib/theme';

interface ClassRow {
  id: string;
  programId: string;
  programName: string;
  discipline: string;
  coachName: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  spotsLeft: number;
  location: string | null;
  status: string;
}

interface Booking {
  id: string;
  status: string;
  classId: string;
}

function dayKey(iso: string): string {
  const value = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (value.toDateString() === today.toDateString()) return 'Today';
  if (value.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return value.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ScheduleScreen() {
  const session = useAuthedSession();
  const router = useRouter();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [bookedIds, setBookedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [upcoming, mine] = await Promise.all([
        apiFetch<ClassRow[]>('/v1/classes', {
          token: session.accessToken,
          query: { limit: 100 },
        }),
        apiFetch<Booking[]>('/v1/me/bookings', { token: session.accessToken }),
      ]);
      setClasses(upcoming);
      setBookedIds(new Set(mine.map((booking) => booking.classId)));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, ClassRow[]>();
    for (const item of classes) {
      const key = dayKey(item.startsAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [classes]);

  async function book(target: ClassRow): Promise<void> {
    setBusyId(target.id);
    setNotice(null);
    try {
      const result = await apiFetch<{ status: string; waitlisted: boolean }>(
        `/v1/classes/${target.id}/bookings`,
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            academyId: session.academy.id,
            classId: target.id,
            userId: session.user.id,
            source: 'mobile',
          },
        },
      );
      setNotice(
        result.waitlisted
          ? `${target.title} is full — you're on the waitlist.`
          : `Booked ${target.title}. See you on the mat.`,
      );
      await load();
    } catch (caught) {
      setNotice(describeError(caught));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading label="Loading the timetable…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }}>
      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {!grouped.length ? (
        <EmptyState title="No upcoming classes" body="Your academy hasn't scheduled anything yet." />
      ) : (
        grouped.map(([day, entries]) => (
          <View key={day} style={{ marginBottom: space.xl }}>
            <Text style={styles.day}>{day}</Text>
            {entries.map((item) => {
              const booked = bookedIds.has(item.id);
              const full = item.spotsLeft === 0;
              const started = new Date(item.startsAt) < new Date();
              return (
                <Card key={item.id} style={{ marginBottom: space.sm }}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.time}>
                        {time(item.startsAt)}–{time(item.endsAt)}
                      </Text>
                      <Text style={styles.title}>{item.title}</Text>
                      <Text style={styles.meta}>
                        {item.programName}
                        {item.coachName ? ` · ${item.coachName}` : ''}
                      </Text>
                      <Text style={styles.meta}>
                        {item.location ?? 'Main mat'} · {item.bookedCount}/{item.capacity} booked
                      </Text>
                    </View>
                    {booked ? <Badge value="booked" /> : full ? <Badge value="waitlisted" /> : null}
                  </View>

                  <View style={styles.actions}>
                    <Pressable onPress={() => router.push(`/class/${item.id}`)}>
                      <Text style={styles.link}>Details</Text>
                    </Pressable>
                    {started ? (
                      <Text style={styles.closed}>Started</Text>
                    ) : booked ? (
                      <Text style={styles.closed}>You're in</Text>
                    ) : (
                      <View style={{ minWidth: 120 }}>
                        <Button
                          label={full ? 'Join waitlist' : 'Book'}
                          variant={full ? 'ghost' : 'primary'}
                          loading={busyId === item.id}
                          onPress={() => void book(item)}
                        />
                      </View>
                    )}
                  </View>
                </Card>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.ink500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: space.sm,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  time: { fontSize: 12, fontWeight: '700', color: colors.mat700 },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink900, marginTop: 2 },
  meta: { fontSize: 12, color: colors.ink500, marginTop: 2 },
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
  closed: { fontSize: 13, color: colors.ink400, fontWeight: '600' },
  notice: {
    backgroundColor: colors.mat50,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: space.lg,
  },
  noticeText: { fontSize: 13, color: colors.mat900 },
});
