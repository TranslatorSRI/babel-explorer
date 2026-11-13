import { normalizeInstanceUrl, resolveTargets, type Instance } from './instances';

/**
 * Where the selection is remembered: localStorage for "Save as default", sessionStorage
 * for the selection this tab last used. The site is a multi-page Astro site, so moving
 * from one tool to another is a full page load; anything held only in memory would be
 * gone by the time the next tool reads it.
 */
const STORAGE_KEY = 'babel-explorer:instance-prefs';

/**
 * Environments the instance selector shows without expanding "Extended environments".
 * Each service has only one of es_ci and redis_ci (see translator-endpoints.json).
 */
export const PRIMARY_ENVS = new Set(['dev', 'ci', 'es_ci', 'redis_ci', 'prod']);

/**
 * A remembered selection. Env keys ('dev', 'ci', …) name the same environment in every
 * service, so they are shared: ticking CI and Prod in NodeNorm carries over to NameRes.
 * A custom URL is one service's server, so each service keeps its own: a local NodeNorm
 * saved as the default must never become a NameRes target.
 *
 * A selection that names no environment (only custom URLs, or nothing) says nothing
 * about which environments the user wants, so it leaves `envs` alone and instead puts
 * its service in `withoutEnvs`. Writing its empty env list over `envs` would silently
 * drop the environments every other service had ticked: choose only a local NameRes,
 * and NodeNorm would lose Dev.
 */
interface StoredSelection {
  envs: string[];
  custom: Record<string, string[]>;
  /** Services whose own last selection named no environment. */
  withoutEnvs: string[];
}

function isUrl(target: string): boolean {
  return normalizeInstanceUrl(target) !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Read a stored selection, or null if there is none or it is unreadable. Storage can be
 * unavailable (a private window, blocked site data), which reads as nothing stored.
 */
function read(storage: () => Storage): StoredSelection | null {
  try {
    const raw = storage().getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { envs, custom, withoutEnvs } = parsed as Record<string, unknown>;
    const customByService: Record<string, string[]> = {};
    if (typeof custom === 'object' && custom !== null) {
      for (const [service, urls] of Object.entries(custom)) customByService[service] = strings(urls);
    }
    return { envs: strings(envs), custom: customByService, withoutEnvs: strings(withoutEnvs) };
  } catch {
    return null;
  }
}

/**
 * Record one service's selection, keeping the other services' custom URLs, and the
 * shared envs when this selection names none (see StoredSelection).
 */
function write(storage: () => Storage, service: string, targets: string[]): void {
  try {
    const stored = read(storage) ?? { envs: [], custom: {}, withoutEnvs: [] };
    const envs = targets.filter((t) => !isUrl(t));
    if (envs.length > 0) stored.envs = envs;
    stored.withoutEnvs = stored.withoutEnvs.filter((s) => s !== service);
    if (envs.length === 0) stored.withoutEnvs.push(service);
    stored.custom[service] = targets.filter(isUrl);
    storage().setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Not remembered; nothing else to do.
  }
}

/**
 * The targets a stored selection gives one service: the shared envs, unless its own
 * last selection named none, and its own URLs.
 */
function targetsFor(stored: StoredSelection | null, service: string): string[] {
  if (!stored) return [];
  const envs = stored.withoutEnvs.includes(service) ? [] : stored.envs;
  return [...envs, ...(stored.custom[service] ?? [])];
}

/**
 * Remember a service's current selection for the rest of this tab's session, so the
 * next tool opened in the tab starts with the same environments. Each item is an env
 * key or a custom URL.
 */
export function rememberSelection(service: string, targets: string[]): void {
  write(() => sessionStorage, service, targets);
}

/** Save a service's selection as the default for new sessions, and for this one. */
export function savePrefs(service: string, targets: string[]): void {
  rememberSelection(service, targets);
  write(() => localStorage, service, targets);
}

/** This session's selection for a service, or an empty list. */
export function loadSessionPrefs(service: string): string[] {
  return targetsFor(read(() => sessionStorage), service);
}

/** The saved default selection for a service, or an empty list. */
export function loadPrefs(service: string): string[] {
  return targetsFor(read(() => localStorage), service);
}

/**
 * The instance URLs a tool starts with, from the first of these that names any usable
 * instance: the page URL's targets, this session's selection, the saved default, and
 * finally the first primary instance.
 *
 * Every source goes through resolveTargets, so a target that is neither a known
 * instance nor an http(s) URL is dropped wherever it came from: a share link, or a
 * value an older version of this site left in storage. Env keys a service lacks are
 * dropped too, and custom URLs never cross from one service to another (see
 * StoredSelection), which is what lets one saved default serve every tool.
 *
 * The app and its form both call this, so the instances a link-driven query runs
 * against are the ones the form shows as ticked.
 */
export function initialSelection(
  service: string,
  instances: Instance[],
  targets: string[] = [],
): string[] {
  for (const source of [targets, loadSessionPrefs(service), loadPrefs(service)]) {
    const urls = resolveTargets(instances, source);
    if (urls.length > 0) return urls;
  }
  const first = instances.find((i) => PRIMARY_ENVS.has(i.env)) ?? instances[0];
  return first ? [first.url] : [];
}
