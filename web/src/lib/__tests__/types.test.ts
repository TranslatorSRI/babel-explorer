import { describe, it, expect } from 'vitest';
import { DEFAULT_API_OPTIONS } from '../types';

describe('DEFAULT_API_OPTIONS', () => {
  it('has all five boolean fields set to true', () => {
    expect(DEFAULT_API_OPTIONS).toEqual({
      conflate: true,
      drug_chemical_conflate: true,
      description: true,
      individual_types: true,
      include_taxa: true,
    });
  });
});
