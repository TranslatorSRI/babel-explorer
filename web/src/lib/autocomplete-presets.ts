/**
 * Presets mirror the three query shapes Translator UI uses today:
 *
 *   /lookup?...&biolink_type=DiseaseOrPhenotypicFeature&only_prefixes=MONDO|HP
 *   /lookup?...&biolink_type=Gene
 *   /lookup?...&biolink_type=SmallMolecule
 *
 * A preset only sets `biolink_type` (and for Disease, `only_prefixes`) —
 * every other field is independent and persists across preset changes.
 */
export type AutocompletePresetId = 'disease' | 'gene' | 'small_molecule' | 'custom';

export interface AutocompletePreset {
  id: AutocompletePresetId;
  label: string;
  biolink_type: string;
  only_prefixes: string;
}

export const AUTOCOMPLETE_PRESETS: AutocompletePreset[] = [
  {
    id: 'disease',
    label: 'Disease / Phenotype',
    biolink_type: 'DiseaseOrPhenotypicFeature',
    only_prefixes: 'MONDO|HP',
  },
  {
    id: 'gene',
    label: 'Gene',
    biolink_type: 'Gene',
    only_prefixes: '',
  },
  {
    id: 'small_molecule',
    label: 'Small Molecule',
    biolink_type: 'SmallMolecule',
    only_prefixes: '',
  },
  {
    id: 'custom',
    label: 'Custom',
    biolink_type: '',
    only_prefixes: '',
  },
];

export const DEFAULT_PRESET_ID: AutocompletePresetId = 'disease';

export function getPreset(id: AutocompletePresetId): AutocompletePreset {
  return AUTOCOMPLETE_PRESETS.find((p) => p.id === id) ?? AUTOCOMPLETE_PRESETS[0];
}

/**
 * Detect which preset (if any) matches the current biolink_type + only_prefixes.
 * If nothing matches cleanly, returns `custom`.
 */
export function detectPreset(biolink_type: string, only_prefixes: string): AutocompletePresetId {
  for (const preset of AUTOCOMPLETE_PRESETS) {
    if (preset.id === 'custom') continue;
    if (preset.biolink_type === biolink_type && preset.only_prefixes === only_prefixes) {
      return preset.id;
    }
  }
  return 'custom';
}
