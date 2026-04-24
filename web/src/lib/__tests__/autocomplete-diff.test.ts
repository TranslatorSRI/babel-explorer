import { describe, it, expect } from 'vitest';
import type { NameResResult } from '../nameres-types';
import { computeInstanceDiffs, classifyExpectedCurie } from '../autocomplete-diff';

function r(curie: string, label: string, types: string[] = ['Disease']): NameResResult {
  return { curie, label, types, taxa: [], synonyms: [], score: 1, clique_identifier_count: 1 };
}

describe('computeInstanceDiffs', () => {
  it('computes union sorted by best rank across instances', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'Alpha'), r('X:2', 'Beta')]],
      ['B', [r('X:3', 'Gamma'), r('X:1', 'Alpha')]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    // X:1 best rank 0 in A; X:3 best rank 0 in B; X:2 best rank 1 in A.
    expect(d.unionCuries[0] === 'X:1' || d.unionCuries[0] === 'X:3').toBe(true);
    expect(d.unionCuries).toContain('X:2');
    expect(d.unionCuries.length).toBe(3);
  });

  it('tracks presence per instance', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'Alpha')]],
      ['B', [r('X:2', 'Beta')]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    expect(d.presenceByInstance.get('A')?.has('X:1')).toBe(true);
    expect(d.presenceByInstance.get('A')?.has('X:2')).toBe(false);
    expect(d.presenceByInstance.get('B')?.has('X:2')).toBe(true);
  });

  it('detects label mismatch', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'Alpha')]],
      ['B', [r('X:1', 'Alpha (v2)')]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    expect(d.labelMismatch.has('X:1')).toBe(true);
  });

  it('detects types mismatch independent of ordering', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'A', ['Disease', 'PhenotypicFeature'])]],
      ['B', [r('X:1', 'A', ['PhenotypicFeature', 'Disease'])]], // same set, different order
      ['C', [r('X:1', 'A', ['Disease'])]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    // A and B agree (set equality), but C differs.
    expect(d.typesMismatch.has('X:1')).toBe(true);
  });

  it('agreeing types across instances do not produce a mismatch', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'A', ['Disease', 'PhenotypicFeature'])]],
      ['B', [r('X:1', 'A', ['PhenotypicFeature', 'Disease'])]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    expect(d.typesMismatch.has('X:1')).toBe(false);
  });

  it('computes uniqueToInstance', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'x'), r('X:2', 'y')]],
      ['B', [r('X:1', 'x'), r('X:3', 'z')]],
    ]);
    const d = computeInstanceDiffs(perInstance);
    expect([...(d.uniqueToInstance.get('A') ?? [])]).toEqual(['X:2']);
    expect([...(d.uniqueToInstance.get('B') ?? [])]).toEqual(['X:3']);
  });

  it('rankByCurie has Infinity-equivalent semantics via absence', () => {
    const perInstance = new Map<string, NameResResult[]>([
      ['A', [r('X:1', 'x')]],
      ['B', []],
    ]);
    const d = computeInstanceDiffs(perInstance);
    expect(d.rankByCurie.get('X:1')?.get('A')).toBe(0);
    expect(d.rankByCurie.get('X:1')?.get('B')).toBeUndefined();
  });

  it('handles empty input', () => {
    const d = computeInstanceDiffs(new Map());
    expect(d.unionCuries).toEqual([]);
    expect(d.labelMismatch.size).toBe(0);
  });
});

describe('classifyExpectedCurie', () => {
  const top5 = [r('A:1', 'a'), r('A:2', 'a')];
  const deep = [r('A:1', 'a'), r('A:2', 'a'), r('A:3', 'a'), r('A:4', 'a')];

  it('hit when present in top-N', () => {
    const c = classifyExpectedCurie('A:1', top5, deep);
    expect(c).toEqual({ curie: 'A:1', status: 'hit', rank: 0, of: 2 });
  });

  it('deep when present in top-100 but not top-N', () => {
    const c = classifyExpectedCurie('A:3', top5, deep);
    expect(c).toEqual({ curie: 'A:3', status: 'deep', rank: 2, of: 4 });
  });

  it('miss when not in deep either', () => {
    const c = classifyExpectedCurie('NO:1', top5, deep);
    expect(c.status).toBe('miss');
    expect(c.rank).toBe(-1);
  });

  it('unknown when no deep lookup has been performed', () => {
    const c = classifyExpectedCurie('NO:1', top5, undefined);
    expect(c.status).toBe('unknown');
  });
});
