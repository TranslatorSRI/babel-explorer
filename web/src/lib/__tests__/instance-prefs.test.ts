import { describe, it, expect } from 'vitest';
import {
  initialSelection,
  loadPrefs,
  loadSessionPrefs,
  rememberSelection,
  savePrefs,
} from '../instance-prefs';
import type { Instance } from '../instances';

// tests/setup.ts provides localStorage and sessionStorage and clears both before each test.
const STORAGE_KEY = 'babel-explorer:instance-prefs';

const nodenorm: Instance[] = [
  { name: 'NodeNorm Dev', env: 'dev', url: 'https://nn-dev.example/' },
  { name: 'NodeNorm Prod', env: 'prod', url: 'https://nn-prod.example/' },
];
const nameres: Instance[] = [
  { name: 'NameRes Dev', env: 'dev', url: 'https://nr-dev.example/' },
  { name: 'NameRes Prod', env: 'prod', url: 'https://nr-prod.example/' },
];

describe('instance-prefs — custom URLs stay with their service', () => {
  it('never offers a custom URL saved in one service to another', () => {
    savePrefs('nodenorm', ['http://localhost:8080/']);
    expect(initialSelection('nameres', nameres)).toEqual([nameres[0].url]);
    expect(initialSelection('nodenorm', nodenorm)).toEqual(['http://localhost:8080/']);
  });

  it('shares env keys between services', () => {
    savePrefs('nodenorm', ['prod', 'http://localhost:8080/']);
    expect(initialSelection('nameres', nameres)).toEqual([nameres[1].url]);
  });

  it("keeps one service's custom URLs when another saves", () => {
    savePrefs('nameres', ['dev', 'http://localhost:2433/']);
    savePrefs('nodenorm', ['prod', 'http://localhost:8080/']);
    expect(loadPrefs('nameres')).toEqual(['prod', 'http://localhost:2433/']);
    expect(loadPrefs('nodenorm')).toEqual(['prod', 'http://localhost:8080/']);
  });

  it("keeps the shared envs when another service selects only a custom URL", () => {
    rememberSelection('nodenorm', ['dev', 'http://localhost:8080/']);
    rememberSelection('nameres', ['http://localhost:2433/']);
    expect(loadSessionPrefs('nodenorm')).toEqual(['dev', 'http://localhost:8080/']);
    expect(loadSessionPrefs('nameres')).toEqual(['http://localhost:2433/']);
  });

  it('keeps the shared envs when another service selects nothing', () => {
    rememberSelection('nodenorm', ['dev']);
    rememberSelection('nameres', []);
    expect(loadSessionPrefs('nodenorm')).toEqual(['dev']);
    expect(loadSessionPrefs('nameres')).toEqual([]);
  });

  it('gives a service the shared envs again once its own selection names one', () => {
    rememberSelection('nameres', ['http://localhost:2433/']);
    rememberSelection('nameres', ['prod', 'http://localhost:2433/']);
    rememberSelection('nodenorm', ['ci']);
    expect(loadSessionPrefs('nameres')).toEqual(['ci', 'http://localhost:2433/']);
  });

  it('ignores a selection stored as a bare array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['prod', 'http://localhost:8080/']));
    expect(loadPrefs('nameres')).toEqual([]);
  });

  it('ignores unreadable storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadPrefs('nodenorm')).toEqual([]);
    expect(initialSelection('nodenorm', nodenorm)).toEqual([nodenorm[0].url]);
  });
});

describe('instance-prefs — session selection', () => {
  it('is kept in sessionStorage, so it survives the page load between tools', () => {
    rememberSelection('nodenorm', ['prod']);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).envs).toEqual(['prod']);
    expect(loadSessionPrefs('nameres')).toEqual(['prod']);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('comes before the saved default', () => {
    savePrefs('nodenorm', ['dev']);
    rememberSelection('nodenorm', ['prod']);
    expect(initialSelection('nameres', nameres)).toEqual([nameres[1].url]);
  });

  it('still works when storage is unavailable', () => {
    const real = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    try {
      expect(() => rememberSelection('nodenorm', ['prod'])).not.toThrow();
      expect(loadSessionPrefs('nodenorm')).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { value: real, configurable: true, writable: true });
    }
  });
});
