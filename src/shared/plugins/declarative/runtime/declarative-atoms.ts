/** Observable state for components panels: reads during a render subscribe that render. */

const ATOM = Symbol.for('orca.declarative.atom')

/** Where a keyed atom's value survives: `memory` (this panel run), `plugin`, `workspace`, or
 *  `storage`: the plugin's own storage under the atom's key, shared with its worker. */
export type TopoPersistScope = 'memory' | 'plugin' | 'workspace' | 'storage'
export type TopoAtomOptions<T> = {
  persist?: TopoPersistScope
  /** Bump when the stored shape changes; `migrate` then receives the older value. */
  version?: number
  migrate?: (stored: unknown, fromVersion: number) => T
}
export type TopoStoredValue = { version: number; value: unknown }

type AtomState<T> = {
  value: T
  initial: T
  listeners: Set<() => void>
  readonly: boolean
  /** Derived atoms compute on every read, so whatever they read subscribes the render. */
  compute?: () => T
  key?: string
  persist: TopoPersistScope
  version: number
  migrate?: (stored: unknown, fromVersion: number) => T
}

export type TopoAtom<T> = { readonly [ATOM]: AtomState<T> }

type Tracker = (atom: TopoAtom<unknown>) => void
let activeTracker: Tracker | null = null

const ATOM_KEY = /^[A-Za-z0-9_.:-]{1,128}$/
const keyed = new Map<string, TopoAtom<unknown>>()
/** Values from the host, by scope; atoms created later hydrate from it too. `memory` holds the
 *  keyed memory atoms of the guest a dev hot reload replaced. */
type SnapshotScope = Exclude<TopoPersistScope, 'storage'>
const snapshot: Record<SnapshotScope, Map<string, TopoStoredValue>> = {
  memory: new Map(),
  plugin: new Map(),
  workspace: new Map()
}
let onPersistedChange: ((atom: TopoAtom<unknown>) => void) | null = null
let onMemoryChange: ((atom: TopoAtom<unknown>) => void) | null = null
let onStorageAtom: ((key: string) => void) | null = null

/** Plugin-written atoms, so a new runtime starts them from their initial values. */
const writableAtoms = new Set<AtomState<unknown>>()

function create<T>(initial: T, fields: Partial<AtomState<T>> = {}): TopoAtom<T> {
  const created = Object.freeze({
    [ATOM]: {
      value: initial,
      initial,
      listeners: new Set<() => void>(),
      readonly: false,
      persist: 'memory' as const,
      version: 1,
      ...fields
    }
  })
  if (!created[ATOM].readonly) {
    writableAtoms.add(created[ATOM])
  }
  return created
}

/**
 * Puts every atom back to its initial value and forgets persisted snapshots. A guest installs one
 * runtime before the plugin loads, so this matters only to `orca/testing`, which mounts a module
 * many times in one process.
 */
export function resetAtoms(): void {
  snapshot.plugin = new Map()
  snapshot.workspace = new Map()
  for (const inner of writableAtoms) {
    inner.value = inner.initial
  }
}

type Stored<T> = { found: true; value: T } | { found: false }

function stored<T>(inner: AtomState<T>): Stored<T> {
  if (!inner.key || inner.persist === 'storage') {
    return { found: false }
  }
  const entry = snapshot[inner.persist].get(inner.key)
  if (!entry) {
    return { found: false }
  }
  if (entry.version === inner.version) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: written by this atom's own version, which stores values of its type.
    return { found: true, value: entry.value as T }
  }
  // A shape the plugin no longer understands falls back to the initial value; a hot reload's
  // hand-over never migrates, since a version bump there means "start this atom over".
  return inner.migrate && inner.persist !== 'memory'
    ? { found: true, value: inner.migrate(entry.value, entry.version) }
    : { found: false }
}

/**
 * `atom(initial)` is anonymous and lives for this panel run. `atom(key, initial, options)` is
 * named (unique per plugin) and may persist across runs for the plugin or the workspace.
 */
export function atom<T>(initial: T): TopoAtom<T>
export function atom<T>(key: string, initial: T, options?: TopoAtomOptions<T>): TopoAtom<T>
export function atom<T>(...args: [T] | [string, T, TopoAtomOptions<T>?]): TopoAtom<T> {
  if (args.length === 1) {
    return create(args[0])
  }
  const [key, initial, options = {}] = args
  if (typeof key !== 'string' || !ATOM_KEY.test(key)) {
    throw new TypeError('an atom key is 1-128 letters, digits, or . _ : -')
  }
  if (keyed.has(key)) {
    throw new Error(`atom key "${key}" is already used`)
  }
  const persist = options.persist ?? 'memory'
  if (!['memory', 'plugin', 'workspace', 'storage'].includes(persist)) {
    throw new TypeError('persist is "memory", "plugin", "workspace" or "storage"')
  }
  const result = create(initial, {
    key,
    persist,
    version: options.version ?? 1,
    migrate: options.migrate
  })
  const inner = result[ATOM]
  const hydrated = stored(inner)
  if (hydrated.found) {
    inner.value = hydrated.value
  }
  keyed.set(key, result)
  if (persist === 'storage') {
    onStorageAtom?.(key)
  }
  return result
}

/** A read-only atom computed from others; reading it in render subscribes to what it reads. */
export function derived<T>(compute: () => T): TopoAtom<T> {
  if (typeof compute !== 'function') {
    throw new TypeError('derived() takes a function')
  }
  return create(compute(), { readonly: true, compute })
}

/** A read-only atom only Topo updates (for example `ctx.visible`). */
export function hostAtom<T>(initial: T): { atom: TopoAtom<T>; set: (value: T) => void } {
  const result = create(initial, { readonly: true })
  return { atom: result, set: (value) => assign(result[ATOM], value, false) }
}

function state<T>(target: TopoAtom<T>): AtomState<T> {
  const inner = typeof target === 'object' && target !== null ? target[ATOM] : undefined
  if (!inner) {
    throw new TypeError('expected an atom created by atom()')
  }
  return inner
}

export function read<T>(target: TopoAtom<T>): T {
  const inner = state(target)
  if (inner.compute) {
    return inner.compute()
  }
  activeTracker?.(target)
  return inner.value
}

function assign<T>(inner: AtomState<T>, value: T, persist: boolean): void {
  if (Object.is(value, inner.value)) {
    return
  }
  inner.value = value
  for (const listener of inner.listeners) {
    listener()
  }
  const target = persist && inner.key ? keyed.get(inner.key) : undefined
  const notify = inner.persist === 'memory' ? onMemoryChange : onPersistedChange
  if (target) {
    notify?.(target)
  }
}

function writable<T>(target: TopoAtom<T>, verb: string): AtomState<T> {
  if (activeTracker) {
    // Why: a write while rendering would schedule another render, forever.
    throw new Error(`${verb}() was called while rendering; call it from an event handler instead`)
  }
  const inner = state(target)
  if (inner.readonly) {
    throw new TypeError(`${verb}() cannot change a read-only atom`)
  }
  return inner
}

/** Stores `value` as is, functions included. */
export function set<T>(target: TopoAtom<T>, value: T): void {
  assign(writable(target, 'set'), value, true)
}

/** Replaces the value with `updater(previous)`. */
export function update<T>(target: TopoAtom<T>, updater: (previous: T) => T): void {
  const inner = writable(target, 'update')
  if (typeof updater !== 'function') {
    throw new TypeError('update() takes an updater function; use set() to store a value')
  }
  assign(inner, updater(inner.value), true)
}

export function subscribeAtom(target: TopoAtom<unknown>, listener: () => void): () => void {
  const inner = state(target)
  inner.listeners.add(listener)
  return () => inner.listeners.delete(listener)
}

/** Runs `render`, adding every atom it reads to `reads` (even when it throws). */
export function trackAtomReads<R>(reads: Set<TopoAtom<unknown>>, render: () => R): R {
  const previous = activeTracker
  activeTracker = (target) => reads.add(target)
  try {
    return render()
  } finally {
    activeTracker = previous
  }
}

export type TopoPersistedEntry = {
  scope: 'plugin' | 'workspace' | 'storage'
  key: string
  version: number
  value: unknown
}

export function persistedEntry(target: TopoAtom<unknown>): TopoPersistedEntry | null {
  const inner = state(target)
  return inner.key && inner.persist !== 'memory'
    ? { scope: inner.persist, key: inner.key, version: inner.version, value: inner.value }
    : null
}

/** Called with each persisted atom that changes from plugin code (not from hydration). */
export function watchPersistedAtoms(listener: ((atom: TopoAtom<unknown>) => void) | null): void {
  onPersistedChange = listener
}

/** A keyed memory atom's value, for handing over to the next guest of a dev hot reload. */
export function memoryEntry(
  target: TopoAtom<unknown>
): { key: string; version: number; value: unknown } | null {
  const inner = state(target)
  return inner.key && inner.persist === 'memory'
    ? { key: inner.key, version: inner.version, value: inner.value }
    : null
}

/** Called with each keyed memory atom that changes from plugin code. */
export function watchMemoryAtoms(listener: ((atom: TopoAtom<unknown>) => void) | null): void {
  onMemoryChange = listener
}

/** `storage` atoms: `listener` hears every key, those created before it was set included. */
export function watchStorageAtoms(listener: ((key: string) => void) | null): void {
  onStorageAtom = listener
  for (const [key, target] of keyed) {
    if (listener && target[ATOM].persist === 'storage') {
      listener(key)
    }
  }
}

/** The plugin's stored value for a `storage` atom; absent (`undefined`) restores the initial one. */
export function applyStorageValue(key: string, value: unknown): void {
  const inner = keyed.get(key)?.[ATOM]
  if (inner?.persist === 'storage') {
    assign(inner, value === undefined ? inner.initial : value, false)
  }
}

/**
 * `topo plugin shot --act`: remembers every plugin-written atom's value; the returned function
 * sets them back as plugin code would, so persisted atoms store their old values again.
 */
export function captureAtomValues(): () => void {
  const values = new Map<AtomState<unknown>, unknown>()
  for (const inner of writableAtoms) {
    values.set(inner, inner.value)
  }
  return () => {
    for (const [inner, value] of values) {
      assign(inner, value, true)
    }
  }
}

/** Applies stored values for a scope (on boot, or the workspace's after a workspace switch). */
export function hydrateAtoms(
  scope: SnapshotScope,
  values: ReadonlyMap<string, TopoStoredValue>
): void {
  snapshot[scope] = new Map(values)
  for (const target of keyed.values()) {
    const inner = target[ATOM]
    if (inner.persist !== scope) {
      continue
    }
    const hydrated = stored(inner)
    // A key the new snapshot lacks (another workspace, say) goes back to its initial value; a
    // hand-over only ever adds values.
    if (hydrated.found || scope !== 'memory') {
      assign(inner, hydrated.found ? hydrated.value : inner.initial, false)
    }
  }
}
