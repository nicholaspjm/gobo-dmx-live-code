/**
 * localStorage key migration — old `lumen-*` keys → current `gobo-*` keys.
 *
 * The project was renamed, and the storage keys were renamed with it. But
 * the data behind those keys is the user's, not ours: scenes written over
 * months of rehearsals, plus their settings. A key rename on its own
 * strands all of it — the app would come up looking factory-fresh and the
 * user's work would appear to be gone, even though it is still sitting in
 * the browser under the old name.
 *
 * So every renamed key is adopted here on first read: if the current key
 * is absent and the legacy one is present, the legacy value is copied
 * across under the new name. The legacy entry is deliberately left in
 * place — copying is cheap, and it means rolling back to an older build
 * still finds its data instead of a blank slate.
 *
 * NOT dead code. This is the only bridge from the old name to the new,
 * and it stays useful for as long as any browser out there still holds a
 * `lumen-*` key. Deleting it silently destroys saved work.
 */

/**
 * Copy `legacyKey` to `newKey` if — and only if — the new key has no
 * value yet and the legacy key does. Idempotent and safe to call on every
 * module load; after the first adoption the new key exists and this is a
 * single localStorage read.
 */
export function migrateLegacyKey(newKey: string, legacyKey: string): void {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(newKey, legacy);
  } catch {
    // Private mode / quota — the app still works, it just reads the
    // defaults for this session. Nothing is lost: the legacy entry is
    // untouched, so a later load in a writable context still adopts it.
  }
}
