/**
 * localStorage key migration: old `lumen-*` keys → current `gobo-*` keys.
 *
 * The project was renamed and the storage keys were renamed with it. The
 * data behind those keys is the user's: scenes written over months of
 * rehearsals, plus their settings. A key rename on its own strands all of
 * it, and the app comes up looking factory-fresh while the work sits in
 * the browser under the old name.
 *
 * So every renamed key is adopted here on first read. If the current key
 * is absent and the legacy one is present, the legacy value is copied
 * across under the new name. The legacy entry is left in place: copying is
 * cheap, and rolling back to an older build then still finds its data.
 *
 * NOT dead code. This is the only bridge from the old name to the new, and
 * it stays useful for as long as any browser still holds a `lumen-*` key.
 * Deleting it silently destroys saved work.
 */

/**
 * Copy `legacyKey` to `newKey` only if the new key has no value yet and
 * the legacy key does. Idempotent and safe to call on every module load;
 * after the first adoption the new key exists and this is a single
 * localStorage read.
 */
export function migrateLegacyKey(newKey: string, legacyKey: string): void {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(newKey, legacy);
  } catch {
    // Private mode or quota. The app still works, reading the defaults for
    // this session. The legacy entry is untouched, so a later load in a
    // writable context still adopts it.
  }
}
