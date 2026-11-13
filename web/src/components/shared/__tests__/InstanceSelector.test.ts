import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InstanceSelector from '../InstanceSelector.vue';
import { loadSessionPrefs, rememberSelection } from '../../../lib/instance-prefs';

// tests/setup.ts provides localStorage and sessionStorage and clears both before each test.
const STORAGE_KEY = 'babel-explorer:instance-prefs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const devInstance = { name: 'NodeNorm Dev', env: 'dev', url: 'https://dev.example.com/' };
const expInstance = { name: 'NodeNorm Exp', env: 'exp', url: 'https://exp.example.com/' };
const ciInstance = { name: 'NodeNorm CI', env: 'ci', url: 'https://ci.example.com/' };
const testInstance = { name: 'NodeNorm Test', env: 'test', url: 'https://test.example.com/' };
const prodInstance = { name: 'NodeNorm Prod', env: 'prod', url: 'https://prod.example.com/' };

const ALL_INSTANCES = [expInstance, devInstance, ciInstance, testInstance, prodInstance];

function mountSelector(overrides: Record<string, unknown> = {}) {
  return mount(InstanceSelector, {
    props: {
      service: 'nodenorm',
      instances: ALL_INSTANCES,
      modelValue: [],
      ...overrides,
    },
  });
}

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

  it('URL params (initialTargets) take priority over the session selection', () => {
    rememberSelection('nodenorm', ['ci']);
    const wrapper = mountSelector({ initialTargets: ['prod'] });
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    expect(emitted[0][0]).toContain(prodInstance.url);
    expect(emitted[0][0]).not.toContain(ciInstance.url);
  });

  it('falls back to the session selection when no initialTargets', () => {
    rememberSelection('nodenorm', ['ci', 'prod']);
    const wrapper = mountSelector();
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const initial = emitted[0][0];
    expect(initial).toContain(ciInstance.url);
    expect(initial).toContain(prodInstance.url);
  });

  it('falls back to localStorage when no initialTargets and no session selection', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ envs: ['ci', 'prod'], custom: {} }));
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

  it('remembers the selection for the session on every change', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    // Clear the session selection to isolate this check
    sessionStorage.clear();
    await wrapper.find('#inst-ci').trigger('change');
    expect(loadSessionPrefs('nodenorm')).toContain('ci');
  });
});

// ─── Quick-select presets ─────────────────────────────────────────────────────

describe('InstanceSelector — quick-select presets', () => {
  it('"Primary" selects only dev, ci, prod', async () => {
    const wrapper = mountSelector({ initialTargets: ['exp'] });
    await wrapper.findAll('button').find((b) => b.text() === 'Primary')!.trigger('click');
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    const last = emitted[emitted.length - 1][0];
    expect(last).toContain(devInstance.url);
    expect(last).toContain(ciInstance.url);
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
    expect(wrapper.find('#inst-custom-0').exists()).toBe(false);
    await wrapper.find('input[type="url"]').setValue('https://custom.example.com/');
    await wrapper.find('button.btn-outline-secondary').trigger('click');
    expect(wrapper.find('#inst-custom-0').exists()).toBe(true);
  });
});

// ─── Save as default ─────────────────────────────────────────────────────────

describe('InstanceSelector — save as default', () => {
  it('saves current selection to localStorage', async () => {
    const wrapper = mountSelector({ initialTargets: ['ci', 'prod'] });
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).envs).toEqual(['ci', 'prod']);
  });

  it('updates the session selection when saving', async () => {
    const wrapper = mountSelector({ initialTargets: ['ci', 'prod'] });
    sessionStorage.clear();
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    expect(loadSessionPrefs('nodenorm')).toEqual(['ci', 'prod']);
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

// ─── Unusable targets ─────────────────────────────────────────────────────────

function initialSelectionOf(wrapper: ReturnType<typeof mountSelector>): string[] {
  return (wrapper.emitted('update:modelValue') as string[][])[0][0] as unknown as string[];
}

describe('InstanceSelector — unusable targets', () => {
  it('gives no checkbox to a link target that is not an http(s) URL', () => {
    const wrapper = mountSelector({ initialTargets: ['dev', 'ftp://h/', '//evil.example'] });
    expect(initialSelectionOf(wrapper)).toEqual([devInstance.url]);
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(0);
  });

  it('falls back to the session selection when no link target is usable', () => {
    rememberSelection('nodenorm', ['prod']);
    const wrapper = mountSelector({ initialTargets: ['ftp://h/'] });
    expect(initialSelectionOf(wrapper)).toEqual([prodInstance.url]);
  });

  it('drops saved preferences that are neither known keys nor http(s) URLs', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ envs: ['es_ci', 'ci'], custom: { nodenorm: ['ftp://h/'] } }));
    const wrapper = mountSelector();
    expect(initialSelectionOf(wrapper)).toEqual([ciInstance.url]);
  });

  it('falls back to the first primary instance when nothing saved is usable', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ envs: ['ftp://h/'], custom: {} }));
    const wrapper = mountSelector();
    expect(initialSelectionOf(wrapper)).toEqual([devInstance.url]);
  });

  it.each(['ftp://h/', 'not a url', 'foo:bar'])('disables Add for %s', async (url) => {
    const wrapper = mountSelector();
    await wrapper.find('input[type="url"]').setValue(url);
    expect(wrapper.find('input[type="url"] + button').attributes('disabled')).toBeDefined();
  });
});

// ─── Several custom URLs ──────────────────────────────────────────────────────

describe('InstanceSelector — several custom URLs', () => {
  async function add(wrapper: ReturnType<typeof mountSelector>, url: string) {
    await wrapper.find('input[type="url"]').setValue(url);
    await wrapper.find('input[type="url"] + button').trigger('click');
  }

  function lastSelection(wrapper: ReturnType<typeof mountSelector>): string[] {
    const emitted = wrapper.emitted('update:modelValue') as string[][];
    return emitted[emitted.length - 1][0] as unknown as string[];
  }

  it('keeps a checkbox for each, so none is queried invisibly', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await add(wrapper, 'https://a.example/');
    await add(wrapper, 'https://b.example/');
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(2);

    await wrapper.find('#inst-custom-0').trigger('change'); // untick A
    expect(lastSelection(wrapper)).toEqual([devInstance.url, 'https://b.example/']);
  });

  it('restores every custom URL in the link', () => {
    const wrapper = mountSelector({ initialTargets: ['https://a.example/', 'https://b.example'] });
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(2);
    expect(initialSelectionOf(wrapper)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('ticks a known instance typed as a URL instead of adding a custom row', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await add(wrapper, 'https://prod.example.com');
    expect(wrapper.findAll('[id^="inst-custom-"]')).toHaveLength(0);
    expect(lastSelection(wrapper)).toContain(prodInstance.url);
  });

  it('adds the URL on Enter', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev'] });
    await wrapper.find('input[type="url"]').setValue('https://a.example/');
    await wrapper.find('input[type="url"]').trigger('keydown', { key: 'Enter' });
    expect(lastSelection(wrapper)).toContain('https://a.example/');
  });

  it('saves custom URLs as URLs and known instances as keys', async () => {
    const wrapper = mountSelector({ initialTargets: ['dev', 'https://a.example/'] });
    await wrapper.find('button.btn-link.text-muted').trigger('click');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      envs: ['dev'],
      custom: { nodenorm: ['https://a.example/'] },
      withoutEnvs: [],
    });
  });
});
