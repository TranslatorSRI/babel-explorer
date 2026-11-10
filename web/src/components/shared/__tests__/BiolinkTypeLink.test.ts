import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BiolinkTypeLink from '../BiolinkTypeLink.vue';

describe('BiolinkTypeLink', () => {
  it('links the type without its biolink: prefix', () => {
    const link = mount(BiolinkTypeLink, { props: { type: 'biolink:Gene' } }).find('a');
    expect(link.text()).toBe('Gene');
    expect(link.attributes('href')).toBe('https://biolink.github.io/biolink-model/Gene');
  });

  it('follows a change to the type prop on the same instance', async () => {
    const wrapper = mount(BiolinkTypeLink, { props: { type: 'biolink:Gene' } });
    await wrapper.setProps({ type: 'biolink:Protein' });
    expect(wrapper.find('a').text()).toBe('Protein');
    expect(wrapper.find('a').attributes('href')).toBe(
      'https://biolink.github.io/biolink-model/Protein',
    );
  });
});
