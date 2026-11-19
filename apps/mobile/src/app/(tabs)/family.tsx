import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, radius, space } from '../../lib/theme';

interface Dependent {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  canBookClasses: boolean;
  canSignWaivers: boolean;
  membershipStatus: string | null;
}

interface ChildClass {
  bookingId: string;
  classId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  bookingStatus: string;
  spotsLeft: number;
}

interface Progression {
  history: {
    id: string;
    rankName: string;
    rankColor: string | null;
    toStripes: number;
    promotedAt: string;
  }[];
  eligibility: {
    programName: string;
    rankName: string;
    eligible: boolean;
    missing?: string[];
  }[];
}

export default function FamilyScreen() {
  const session = useAuthedSession();
  const [children, setChildren] = useState<Dependent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ChildClass[]>([]);
  const [progression, setProgression] = useState<Progression | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<Dependent[]>('/v1/family/dependents', { token: session.accessToken });
      const first = selected && rows.some((row) => row.id === selected) ? selected : rows[0]?.id ?? null;
      setChildren(rows);
      setSelected(first);
      if (first) {
        const [classes, progress] = await Promise.all([
          apiFetch<ChildClass[]>(`/v1/family/dependents/${first}/schedule`, { token: session.accessToken }),
          apiFetch<Progression>(`/v1/family/dependents/${first}/progression`, { token: session.accessToken }),
        ]);
        setSchedule(classes);
        setProgression(progress);
      } else {
        setSchedule([]);
        setProgression(null);
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken, selected]);

  useEffect(() => {
    void load();
    // Child selection is handled by select(), so re-running on `selected`
    // would create a redundant request loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.accessToken]);

  async function select(id: string): Promise<void> {
    setSelected(id);
    setLoading(true);
    try {
      const [classes, progress] = await Promise.all([
        apiFetch<ChildClass[]>(`/v1/family/dependents/${id}/schedule`, { token: session.accessToken }),
        apiFetch<Progression>(`/v1/family/dependents/${id}/progression`, { token: session.accessToken }),
      ]);
      setSchedule(classes);
      setProgression(progress);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  if (loading && !children.length) return <Loading label="Loading your family…" />;

  const child = children.find((row) => row.id === selected) ?? null;

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <SectionTitle hint="Schedules and progress, one child at a time.">Your family</SectionTitle>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {children.length ? (
        <>
          <View style={styles.chips}>
            {children.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                onPress={() => void select(row.id)}
                style={[styles.chip, row.id === selected && styles.chipActive]}
              >
                <Text style={[styles.chipText, row.id === selected && styles.chipTextActive]}>
                  {row.firstName} {row.lastName}
                </Text>
              </Pressable>
            ))}
          </View>

          {child ? (
            <Card style={styles.summary}>
              <Text style={styles.title}>{child.firstName} {child.lastName}</Text>
              <Text style={styles.muted}>{child.relationship} · {child.membershipStatus ?? 'No membership'}</Text>
              <View style={styles.row}>
                <Badge value={child.canBookClasses ? 'booking enabled' : 'booking paused'} />
                <Badge value={child.canSignWaivers ? 'waiver on file' : 'waiver needed'} />
              </View>
            </Card>
          ) : null}

          <View style={styles.section}>
            <SectionTitle>Upcoming classes</SectionTitle>
            {schedule.length ? (
              schedule.map((row) => (
                <Card key={row.bookingId} style={styles.card}>
                  <Text style={styles.title}>{row.title}</Text>
                  <Text style={styles.muted}>
                    {new Date(row.startsAt).toLocaleString()} · {row.spotsLeft} spots left
                  </Text>
                  <Badge value={row.bookingStatus} />
                </Card>
              ))
            ) : (
              <EmptyState title="Nothing booked" body="Book a class from the schedule tab." />
            )}
          </View>

          <View style={styles.section}>
            <SectionTitle>Progression</SectionTitle>
            {progression?.history.length ? (
              progression.history.map((row) => (
                <Card key={row.id} style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.title}>{row.rankName}</Text>
                    <Text style={styles.muted}>{row.toStripes} stripes</Text>
                  </View>
                  <Text style={styles.muted}>{new Date(row.promotedAt).toLocaleDateString()}</Text>
                </Card>
              ))
            ) : (
              <EmptyState title="No promotions yet" body="Promotions appear here once awarded." />
            )}

            {progression?.eligibility.filter((row) => row.eligible).map((row) => (
              <Card key={`${row.programName}-${row.rankName}`} style={styles.card}>
                <Text style={styles.title}>Ready for {row.rankName}</Text>
                <Text style={styles.muted}>{row.programName} · eligible now</Text>
              </Card>
            ))}
          </View>
        </>
      ) : (
        !error ? <EmptyState title="No dependents linked" body="Ask the front desk to link your children." /> : null
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space.md },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.ink200,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.mat700, borderColor: colors.mat700 },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.ink600 },
  chipTextActive: { color: colors.white },
  summary: { gap: 6, borderRadius: radius.lg },
  card: { marginBottom: space.sm, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.ink900 },
  muted: { fontSize: 12, color: colors.ink500 },
  section: { marginTop: space.xl },
});
