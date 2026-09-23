import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid calls into the last one', () => {
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d('a');
    d('b');
    d('c');
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('c');
  });

  it('fires again after the window elapses', () => {
    const spy = vi.fn();
    const d = debounce(spy, 50);
    d(1);
    vi.advanceTimersByTime(50);
    d(2);
    vi.advanceTimersByTime(50);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('cancel() drops a pending invocation', () => {
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('invokes synchronously when ms is 0', () => {
    const spy = vi.fn();
    const d = debounce(spy, 0);
    d('immediate');
    // No timer advance needed — should already have run.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('immediate');
  });

  it('invokes synchronously when ms is negative (treated as 0)', () => {
    const spy = vi.fn();
    const d = debounce(spy, -10);
    d('x');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
