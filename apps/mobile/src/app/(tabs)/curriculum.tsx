import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Screen, SectionTitle } from '../../components/ui';
import { apiFetch, describeError } from '../../lib/api';
import { useAuthedSession } from '../../lib/auth-context';
import { colors, space } from '../../lib/theme';

interface Video {
  id: string;
  title: string;
  description: string | null;
  url: string;
  beltSlug: string | null;
  durationSeconds: number;
  sortOrder: number;
}

interface Recap {
  id: string;
  classTitle: string;
  startsAt: string;
  summary: string;
  techniques: string[];
}

export default function CurriculumScreen() {
  const session = useAuthedSession();
  const [videos, setVideos] = useState<Video[]>([]);
  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [belt, setBelt] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [videoRows, recapRows] = await Promise.all([
        apiFetch<Video[]>('/v1/curriculum/videos', { token: session.accessToken }),
        apiFetch<Recap[]>('/v1/me/recaps', { token: session.accessToken }),
      ]);
      setVideos(videoRows);
      setRecaps(recapRows);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const belts = useMemo(
    () => ['all', ...new Set(videos.map((video) => video.beltSlug ?? 'unassigned'))],
    [videos],
  );
  const filtered = belt === 'all' ? videos : videos.filter((video) => (video.beltSlug ?? 'unassigned') === belt);

  if (loading) return <Loading label="Loading the library…" />;
  if (error) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;

  return (
    <Screen refreshing={loading} onRefresh={() => void load()}>
      <SectionTitle hint="Technique videos mapped to your belt.">Curriculum</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
        {belts.map((slug) => (
          <Pressable
            key={slug}
            accessibilityRole="button"
            onPress={() => setBelt(slug)}
            style={[styles.chip, belt === slug && styles.chipActive]}
          >
            <Text style={[styles.chipText, belt === slug && styles.chipTextActive]}>{slug}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length ? (
        filtered.map((video) => (
          <Card key={video.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.title}>{video.title}</Text>
              <Badge value={video.beltSlug ?? 'unassigned'} />
            </View>
            {video.description ? <Text style={styles.muted}>{video.description}</Text> : null}
            <View style={styles.row}>
              <Text style={styles.muted}>
                {video.durationSeconds ? `${Math.round(video.durationSeconds / 60)} min` : 'Self-paced'}
              </Text>
              <Button label="Watch" variant="ghost" onPress={() => void Linking.openURL(video.url)} />
            </View>
          </Card>
        ))
      ) : (
        <EmptyState title="No videos in this belt yet" body="Your coaches will publish them here." />
      )}

      <View style={styles.section}>
        <SectionTitle hint="Notes from sessions you attended.">Class recaps</SectionTitle>
        {recaps.length ? (
          recaps.map((recap) => (
            <Card key={recap.id} style={styles.card}>
              <Text style={styles.title}>{recap.classTitle}</Text>
              <Text style={styles.muted}>{new Date(recap.startsAt).toLocaleDateString()}</Text>
              <Text style={styles.summary}>{recap.summary}</Text>
              {recap.techniques.length ? (
                <Text style={styles.muted}>Focus: {recap.techniques.join(' · ')}</Text>
              ) : null}
            </Card>
          ))
        ) : (
          <EmptyState title="No recaps yet" body="Recaps appear after class." />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', marginBottom: space.md },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.ink200,
    backgroundColor: colors.white,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.mat700, borderColor: colors.mat700 },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.ink600, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  card: { marginBottom: space.sm, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.ink900 },
  muted: { fontSize: 12, color: colors.ink500 },
  summary: { fontSize: 14, color: colors.ink700, lineHeight: 20 },
  section: { marginTop: space.xl },
});
