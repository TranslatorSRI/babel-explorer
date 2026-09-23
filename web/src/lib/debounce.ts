/**
 * Debounce a function so rapid calls coalesce into one delayed invocation.
 *
 * When `ms === 0`, the returned function invokes `fn` synchronously — this
 * lets the Autocomplete tool's "No debounce" setting feel truly instantaneous
 * without any setTimeout round-trip.
 */
export interface DebouncedFn<F extends (...args: unknown[]) => void> {
  (...args: Parameters<F>): void;
  cancel: () => void;
}

export function debounce<F extends (...args: unknown[]) => void>(
  fn: F,
  ms: number,
): DebouncedFn<F> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wrapped = ((...args: Parameters<F>) => {
    if (ms <= 0) {
      fn(...args);
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as DebouncedFn<F>;

  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return wrapped;
}
