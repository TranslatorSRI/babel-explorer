import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InstanceSelector from '../InstanceSelector.vue';
import { sessionPrefs } from '../../../lib/instance-prefs';

// happy-dom doesn't implement localStorage — provide a minimal in-memory mock.
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
};
vi.stubGlobal('localStorage', localStorageMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const devInstance = { name: 'NodeNorm Dev', env: 'dev', url: 'https://dev.example.com/' };
const expInstance = { name: 'NodeNorm Exp', env: 'exp', url: 'https://exp.example.com/' };
const ciInstance = { name: 'NodeNorm CI', env: 'ci', url: 'https://ci.example.com/' };
const esCiInstance = { name: 'NameRes ES CI', env: 'es_ci', url: 'https://es-ci.example.com/' };
const testInstance = { name: 'NodeNorm Test', env: 'test', url: 'https://test.example.com/' };
const prodInstance = { name: 'NodeNorm Prod', env: 'prod', url: 'https://prod.example.com/' };

const ALL_INSTANCES = [expInstance, devInstance, ciInstance, esCiInstance, testInstance, prodInstance];

function mountSelector(overrides: Record<string, unknown> = {}) {
  return mount(InstanceSelector, {
    props: {
      instances: ALL_INSTANCES,
      modelValue: [],
      ...overrides,
    },
  });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  sessionPrefs.value = null;
  localStorage.clear();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('InstanceSelector — rendering', () => {
  it('renders primary instance labels', () => {
    const wrapper = mountSelector();
    const text = wrapper.text();
    expect(text).toContain('RENCI Dev');
    expect(text).toContain('ITRB CI');
    expect(text).toContain('ITRB Prod');
  });

  it('renders extended instance labels inside <details>', () => {
    const wrapper = mountSelector();
    const details = wrapper.find('details');
    expect(details.exists()).toBe(true);
    expect(details.text()).toContain('RENCI Experimental');
    expect(details.text()).toContain('ITRB Test');
  });

  it('renders es_ci label as primary with an <abbr> for ElasticSearch', () => {
    const wrapper = mountSelector();
    const label = wrapper.find('label[for="inst-es_ci"]');
    expect(label.exists()).toBe(true);
    const abbr = label.find('abbr');
    expect(abbr.exists()).toBe(true);
    expect(abbr.attributes('title')).toBe('ElasticSearch');
    expect(abbr.text()).toBe('ES');
    // es_ci must be in the primary section, not inside <details>
    expect(wrapper.find('details').html()).not.toContain('inst-es_ci');
  });

  it('does not open <details> by default', () => {
    const wrapper = mountSelector();
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
  });

  it('shows quick-select buttons', () => {
    const wrapper = mountSelector();
    const text = wrapper.text();
    expect(text).toContain('All');
    expect(text).toContain('Primary');
    expect(text).toContain('None');
  });

  it('shows "Save as default" button', () => {
    const wrapper = mountSelector();
    expect(wrapper.text()).toContain('Save as default');
  });

  it('shows the pipeline note in the details summary', () => {
    const wrapper = mountSelector();
    expect(wrapper.find('details summary').text()).toContain('Exp → Dev → CI → Test → Prod pipeline');
  });

  it('includes full URL as title attribute on primary checkbox labels', () => {
    const wrapper = mountSelector();
    const devLabel = wrapper.find(`label[for="inst-dev"]`);
    expect(devLabel.attributes('title')).toBe(devInstance.url);
  });

  it('includes full URL as title attribute on extended checkbox labels', () => {
    const wrapper = mountSelector();
    const expLabel = wrapper.find(`label[for="inst-exp"]`);
    expect(expLabel.attributes('title')).toBe(expInstance.url);
  });
});

// ─── Default selection ────────────────────────────────────────────────────────

describe('InstanceSelector — default selection', () => {
  it('selects first primary instance by default when no initialTargets and no prefs', () => {
    const wrapper = mountSelector();
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    // immediate watch fires once with initial value
    expect(emitted).toBeTruthy();
    const initial = emitted[0][0];
    // Default is first primary instance (dev), not exp
    expect(initial).toEqual([devInstance.url]);
  });

  it('pre-selects from initialTargets (env keys)', () => {
    const wrapper = mountSelector({ initialTargets: ['dev', 'prod'] });
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const initial = emitted[0][0];
    expect(initial).toContain(devInstance.url);
    expect(initial).toContain(prodInstance.url);
    expect(initial).not.toContain(ciInstance.url);
  });

  it('pre-selects from initialTargets (full URL)', () => {
    const wrapper = mountSelector({ initialTargets: [ciInstance.url] });
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    expect(emitted[0][0]).toContain(ciInstance.url);
  });

  it('auto-expands <details> when initialTargets includes an extended env', () => {
    const wrapper = mountSelector({ initialTargets: ['exp'] });
    expect(wrapper.find('details').attributes('open')).toBe('');
  });

  it('auto-expands <details> when initialTargets includes a custom URL', () => {
    const wrapper = mountSelector({ initialTargets: ['https://custom.example.com/'] });
    expect(wrapper.find('details').attributes('open')).toBe('');
  });

  it('URL params (initialTargets) take priority over sessionPrefs', () => {
    sessionPrefs.value = ['ci'];
    const wrapper = mountSelector({ initialTargets: ['prod'] });
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    expect(emitted[0][0]).toContain(prodInstance.url);
    expect(emitted[0][0]).not.toContain(ciInstance.url);
  });

  it('falls back to sessionPrefs when no initialTargets', () => {
    sessionPrefs.value = ['ci', 'prod'];
    const wrapper = mountSelector();
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const initial = emitted[0][0];
    expect(initial).toContain(ciInstance.url);
    expect(initial).toContain(prodInstance.url);
  });

  it('falls back to localStorage when no initialTargets and no sessionPrefs', () => {
    localStorage.setItem('babel-explorer:instance-prefs', JSON.stringify(['ci', 'prod']));
    const wrapper = mountSelector();
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const initial = emitted[0][0];
    expect(initial).toContain(ciInstance.url);
    expect(initial).toContain(prodInstance.url);
  });
});

// ─── Checkbox interactions ────────────────────────────────────────────────────

describe('InstanceSelector — checkbox interaction', () => {
  it('emits updated URLs when a primary checkbox is toggled', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    const ciCheckbox = wrapper.find('#inst-ci');
    await ciCheckbox.trigger('change');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    // Last emitted value should include both dev and ci
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain(devInstance.url);
    expect(last).toContain(ciInstance.url);
  });

  it('removes a URL when its checkbox is unchecked', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev', 'ci'] });
    const devCheckbox = wrapper.find('#inst-dev');
    await devCheckbox.trigger('change');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).not.toContain(devInstance.url);
    expect(last).toContain(ciInstance.url);
  });

  it('updates sessionPrefs on every change', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    // Clear sessionPrefs to isolate this check
    sessionPrefs.value = null;
    await wrapper.find('#inst-ci').trigger('change');
    expect(sessionPrefs.value).toContain('ci');
  });
});

// ─── Quick-select presets ─────────────────────────────────────────────────────

describe('InstanceSelector — quick-select presets', () => {
  it('"Primary" selects only dev, ci, es_ci, prod', async () => {
    const wrapper = mountSelector({ initialTargets: ['exp'] });
    await wrapper.findAll('button').find((b) => b.text() === 'Primary')!.trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain(devInstance.url);
    expect(last).toContain(ciInstance.url);
    expect(last).toContain(esCiInstance.url);
    expect(last).toContain(prodInstance.url);
    expect(last).not.toContain(expInstance.url);
    expect(last).not.toContain(testInstance.url);
  });

  it('"All" selects all instances and opens extended section', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await wrapper.findAll('button').find((b) => b.text() === 'All')!.trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain(expInstance.url);
    expect(last).toContain(devInstance.url);
    expect(last).toContain(ciInstance.url);
    expect(last).toContain(esCiInstance.url);
    expect(last).toContain(testInstance.url);
    expect(last).toContain(prodInstance.url);
    expect(wrapper.find('details').attributes('open')).toBe('');
  });

  it('"None" clears the selection', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev', 'ci', 'prod'] });
    await wrapper.findAll('button').find((b) => b.text() === 'None')!.trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toHaveLength(0);
  });
});

// ─── Custom URL ───────────────────────────────────────────────────────────────

describe('InstanceSelector — custom URL', () => {
  it('adds a custom URL to the selection', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    const input = wrapper.find('input[type="url"]');
    await input.setValue('https://custom.example.com/');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain('https://custom.example.com/');
  });

  it('auto-appends trailing slash to custom URL', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    const input = wrapper.find('input[type="url"]');
    await input.setValue('https://custom.example.com');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain('https://custom.example.com/');
  });

  it('trims whitespace from custom URL', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    const input = wrapper.find('input[type="url"]');
    await input.setValue('  https://custom.example.com/  ');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain('https://custom.example.com/');
  });

  it('clears the input field after adding', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    const input = wrapper.find('input[type="url"]');
    await input.setValue('https://custom.example.com/');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('removes custom URL from selection when × is clicked', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await wrapper.find('input[type="url"]').setValue('https://custom.example.com/');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    await wrapper.find('button.btn-close').trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).not.toContain('https://custom.example.com/');
  });

  it('shows custom URL checkbox after adding', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    expect(wrapper.find('#inst-custom').exists()).toBe(false);
    await wrapper.find('input[type="url"]').setValue('https://custom.example.com/');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    expect(wrapper.find('#inst-custom').exists()).toBe(true);
  });
});

// ─── Save as default ─────────────────────────────────────────────────────────

describe('InstanceSelector — save as default', () => {
  it('saves current selection to localStorage', async () => {
    const wrapper = mountSelector({ initialTargets: ['ci', 'prod'] });
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    const stored = localStorage.getItem('babel-explorer:instance-prefs');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed).toContain('ci');
    expect(parsed).toContain('prod');
  });

  it('updates sessionPrefs when saving', async () => {
    const wrapper = mountSelector({ initialTargets: ['ci', 'prod'] });
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    expect(sessionPrefs.value).toContain('ci');
    expect(sessionPrefs.value).toContain('prod');
  });

  it('shows "✓ Saved as default" flash after clicking', async () => {
    vi.useFakeTimers();
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    expect(wrapper.text()).toContain('✓ Saved as default');
    vi.runAllTimers();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Save as default');
    expect(wrapper.text()).not.toContain('✓ Saved as default');
    vi.useRealTimers();
  });
});
