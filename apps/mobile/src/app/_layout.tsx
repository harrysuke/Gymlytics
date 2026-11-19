import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { colors } from '../lib/theme';

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const onLogin = segments[0] === 'login';

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink50 }}>
        <ActivityIndicator color={colors.mat600} size="large" />
      </View>
    );
  }

  if (!session && !onLogin) return <Redirect href="/login" />;
  if (session && onLogin) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.mat900,
        headerStyle: { backgroundColor: colors.white },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.ink50 },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="class/[id]" options={{ title: 'Class' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}
