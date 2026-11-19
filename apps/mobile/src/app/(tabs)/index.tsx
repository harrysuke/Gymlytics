import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, ErrorState, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, radius, space } from '../../lib/theme';

interface Progression {
  programId: string;
  programName: string;
  rankName: string | null;
  stripes: number;
  nextRankName: string | null;
  monthsInRank: number;
  classesSincePromotion: number;
  matHoursSincePromotion: number;
  techniquesRequired: number;
  techniquesCompleted: number;
  eligible: boolean;
  beltEligible: boolean;
  stripeEligible: boolean;
  suggestedAction: 'stripe' | 'belt' | null;
  missing: string[];
}

interface Booking {
  id: string;
  status: string;
  classId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  programName: string;
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const target = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (target.toDateString() === today.toDateString()) return 'Today';
  if (target.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return target.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function HomeScreen() {
  const session = useAuthedSession();
  const router = useRouter();

  const [progression, setProgression] = useState<Progression[]>([]);
  const [nextClass, setNextClass] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [progress, bookings] = await Promise.all([
        apiFetch<Progression[]>('/v1/me/progression', { token: session.accessToken }),
        apiFetch<Booking[]>('/v1/me/bookings', { token: session.accessToken }),
      ]);
      setProgression(progress);
      setNextClass(bookings[0] ?? null);
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

  if (loading) return <Loading label="Loading your training…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const primary = progression[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <Screen refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }}>

      <Text style={styles.greeting}>{greeting},</Text>
      <Text style={styles.name}>{session.user.firstName}</Text>
      <Text style={styles.academy}>{session.academy.name}</Text>

      {/* Next class */}
      <View style={{ marginTop: space.xl }}>
        <SectionTitle>Next class</SectionTitle>
        {nextClass ? (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{nextClass.title}</Text>
              <Badge value={nextClass.status} />
            </View>
            <Text style={styles.muted}>{nextClass.programName}</Text>
            <Text style={styles.when}>
              {dayLabel(nextClass.startsAt)} · {time(nextClass.startsAt)}–{time(nextClass.endsAt)}
            </Text>
            <View style={{ marginTop: space.md }}>
              <Button label="View class" variant="ghost" onPress={() => router.push(`/class/${nextClass.classId}`)} />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={styles.cardTitle}>No classes booked</Text>
            <Text style={styles.muted}>Reserve a spot from the schedule tab.</Text>
            <View style={{ marginTop: space.md }}>
              <Button label="Browse schedule" onPress={() => router.push('/schedule')} />
            </View>
          </Card>
        )}
      </View>

      {/* Progression */}
      <View style={{ marginTop: space.xl }}>
        <SectionTitle hint={primary ? primary.programName : 'No rank recorded yet'}>Your progress</SectionTitle>

        {!primary ? (
          <Card>
            <Text style={styles.muted}>
              Once you attend a class your belt and stripe progress appears here.
            </Text>
          </Card>
        ) : (
          <Card>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.rank}>{primary.rankName ?? 'Unranked'}</Text>
                <Text style={styles.muted}>{primary.monthsInRank} months in rank</Text>
              </View>
              <View style={styles.stripeRow}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <View
                    key={index}
                    style={[styles.stripe, index < primary.stripes ? styles.stripeOn : styles.stripeOff]}
                  />
                ))}
              </View>
            </View>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{primary.classesSincePromotion}</Text>
                <Text style={styles.statLabel}>classes</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{primary.matHoursSincePromotion}</Text>
                <Text style={styles.statLabel}>mat hours</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {primary.techniquesCompleted}/{primary.techniquesRequired}
                </Text>
                <Text style={styles.statLabel}>curriculum</Text>
              </View>
            </View>

            <View
              style={[
                styles.callout,
                primary.beltEligible
                  ? styles.calloutGood
                  : primary.stripeEligible
                    ? styles.calloutMat
                    : styles.calloutNeutral,
              ]}
            >
              <Text style={styles.calloutText}>
                {primary.beltEligible
                  ? `Ready for your ${primary.nextRankName ?? 'next'} belt — talk to your coach.`
                  : primary.stripeEligible
                    ? 'You have earned your next stripe.'
                    : primary.missing.length
                      ? primary.missing.join(' · ')
                      : 'Keep showing up — progress is tracked automatically.'}
              </Text>
            </View>
          </Card>
        )}
      </View>

      <View style={{ marginTop: space.xl }}>
        <Button label="Book another class" variant="ghost" onPress={() => router.push('/schedule')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 15, color: colors.ink500 },
  name: { fontSize: 28, fontWeight: '800', color: colors.ink900 },
  academy: { fontSize: 13, color: colors.ink400, marginTop: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink900, flexShrink: 1 },
  muted: { fontSize: 13, color: colors.ink500, marginTop: 4 },
  when: { fontSize: 14, fontWeight: '600', color: colors.mat700, marginTop: 8 },
  rank: { fontSize: 20, fontWeight: '800', color: colors.ink900 },
  stripeRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  stripe: { width: 22, height: 6, borderRadius: 3 },
  stripeOn: { backgroundColor: colors.ink800 },
  stripeOff: { backgroundColor: colors.ink200 },
  statRow: {
    flexDirection: 'row',
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.ink900 },
  statLabel: { fontSize: 11, color: colors.ink500, marginTop: 2 },
  callout: { marginTop: space.lg, borderRadius: radius.md, padding: 12 },
  calloutGood: { backgroundColor: colors.green50 },
  calloutMat: { backgroundColor: colors.mat50 },
  calloutNeutral: { backgroundColor: colors.ink50 },
  calloutText: { fontSize: 13, color: colors.ink700, lineHeight: 19 },
});
