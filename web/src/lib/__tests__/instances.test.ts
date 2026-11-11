import { describe, it, expect } from 'vitest';
import {
  buildInstances,
  findInstance,
  instanceForUrl,
  normalizeInstanceUrl,
  resolveTarget,
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

  it.each(['ftp://h/', '//evil.example', 'staging'])('returns null for %j', (target) => {
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
