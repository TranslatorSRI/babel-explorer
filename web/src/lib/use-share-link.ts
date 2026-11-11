import { ref, onBeforeUnmount } from 'vue';

/** How long the "✓ Copied!" or "Copy failed" label stays on the Share button. */
const STATUS_MS = 2000;

/**
 * The Share button's behaviour, shared by every tool: copy the page URL (which each app
 * keeps describing the results on screen) and say whether that worked.
 *
 * Returns the label to show in place of "Share" while there is one, and the click
 * handler. A failed copy is reported, never shown as "Copied!".
 */
export function useShareLink() {
  const shareStatus = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function share() {
    try {
      // navigator.clipboard is undefined outside a secure context, which lands here too.
      await navigator.clipboard.writeText(window.location.href);
      shareStatus.value = '✓ Copied!';
    } catch {
      shareStatus.value = 'Copy failed';
    }
    // A second click restarts the delay rather than letting the first one clear it early.
    clearTimeout(timer);
    timer = setTimeout(() => { shareStatus.value = null; }, STATUS_MS);
  }

  onBeforeUnmount(() => clearTimeout(timer));

  return { shareStatus, share };
}
