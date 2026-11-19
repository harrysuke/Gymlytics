/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time. The React Native
 * tsconfig deliberately omits `@types/node` (it clashes with RN's globals), so
 * we declare just the slice of `process` we actually use.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    [key: string]: string | undefined;
  };
};
