import { useRouter } from 'expo-router';

/**
 * Leave the current screen. `router.back()` is a no-op when the screen was
 * opened directly by URL or deep link (nothing to go back to), so fall back to
 * replacing with the overview.
 */
export function useDismiss(): () => void {
  const router = useRouter();
  return () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
}
