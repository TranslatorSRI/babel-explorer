import { describe, it, expect } from 'vitest';
import {
  buildInstances,
  findInstance,
  instanceForUrl,
  normalizeInstanceUrl,
  resolveTarget,
  sortInstances,
  urlToTarget,
} from '../instances';

const instances = buildInstances('NodeNorm', {
  dev: 'https://dev.example.com/',
  prod: 'https://prod.example.com/nodenorm',
});

describe('normalizeInstanceUrl', () => {
  it('adds a trailing slash and drops the fragment', () => {
    expect(normalizeInstanceUrl(' https://Host.example/nn#x ')).toBe('https://host.example/nn/');
  });

  it.each(['ftp://h/', '//evil.example', 'javascript:alert(1)', 'not a url', 'foo:bar', ''])(
    'rejects %j, which is not an absolute http(s) URL',
    (raw) => expect(normalizeInstanceUrl(raw)).toBeNull(),
  );
});

describe('buildInstances', () => {
  it('names instances by env and normalizes their URLs', () => {
    expect(instances).toEqual([
      { name: 'NodeNorm Dev', env: 'dev', url: 'https://dev.example.com/' },
      { name: 'NodeNorm Production', env: 'prod', url: 'https://prod.example.com/nodenorm/' },
    ]);
  });
});

describe('resolveTarget', () => {
  it('resolves env keys to instance URLs', () => {
    expect(resolveTarget(instances, 'prod')).toBe('https://prod.example.com/nodenorm/');
  });

  it('matches a known instance whatever its trailing slash', () => {
    expect(findInstance(instances, 'https://dev.example.com')?.env).toBe('dev');
    expect(resolveTarget(instances, 'https://prod.example.com/nodenorm')).toBe(
      'https://prod.example.com/nodenorm/',
    );
  });

  it('normalizes custom http(s) URLs', () => {
    expect(resolveTarget(instances, 'https://custom.example')).toBe('https://custom.example/');
  });

  // Share links and saved selections are shared between tools, and NodeNorm and
  // NameRes do not have the same keys, so another service's key must not be fetched.
  it.each(['ftp://h/', '//evil.example', 'staging', 'redis_ci'])('returns null for %j', (target) => {
    expect(resolveTarget(instances, target)).toBeNull();
  });
});

describe('instanceForUrl and urlToTarget', () => {
  it('use the env key for known instances and the URL for custom ones', () => {
    expect(urlToTarget(instances, 'https://dev.example.com/')).toBe('dev');
    expect(urlToTarget(instances, 'https://custom.example/')).toBe('https://custom.example/');
    expect(instanceForUrl(instances, 'https://custom.example/')).toEqual({
      name: 'https://custom.example/',
      env: 'https://custom.example/',
      url: 'https://custom.example/',
    });
  });
});

describe('sortInstances', () => {
  it('sorts known environments into pipeline order and custom URLs last', () => {
    const custom = { name: 'https://a.example.com/', env: 'https://a.example.com/', url: 'https://a.example.com/' };
    const all = buildInstances('NameRes', {
      prod: 'https://prod.example/',
      es_ci: 'https://es-ci.example/',
      exp: 'https://exp.example/',
      ci: 'https://ci.example/',
    });
    expect(sortInstances([custom, ...all]).map((i) => i.env)).toEqual([
      'exp', 'ci', 'es_ci', 'prod', 'https://a.example.com/',
    ]);
  });
});
