import { describe, it, expect } from 'vitest';
import { resolveTarget, sortInstances } from '../instance-prefs';

const instances = [
  { env: 'dev', url: 'https://dev.example.com/' },
  { env: 'prod', url: 'https://prod.example.com/' },
];

describe('resolveTarget', () => {
  it('resolves env keys and known URLs', () => {
    expect(resolveTarget(instances, 'dev')).toBe('https://dev.example.com/');
    expect(resolveTarget(instances, 'https://prod.example.com/')).toBe('https://prod.example.com/');
  });

  it('keeps custom URLs and drops unknown env keys', () => {
    expect(resolveTarget(instances, 'http://localhost:8080/')).toBe('http://localhost:8080/');
    expect(resolveTarget(instances, 'redis_ci')).toBeNull();
  });
});

describe('sortInstances', () => {
  it('sorts custom URLs after prod', () => {
    const sorted = sortInstances([
      { env: 'https://a.example.com/', url: 'https://a.example.com/' },
      ...instances,
    ]);
    expect(sorted.map((i) => i.env)).toEqual(['dev', 'prod', 'https://a.example.com/']);
  });
});
