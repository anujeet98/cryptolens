const store = new Map<string, { at: number; v: unknown; p?: Promise<unknown> }>();

/** Tiny in-memory TTL cache with in-flight de-duplication, so many clients don't multiply exchange requests. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  if (hit?.p) return hit.p as Promise<T>;
  const p = fn().then((v) => { store.set(key, { at: Date.now(), v }); return v; }).catch((e) => {
    if (hit?.v !== undefined) return hit.v as T; // serve stale on upstream failure
    store.delete(key);
    throw e;
  });
  store.set(key, { at: hit?.at ?? 0, v: hit?.v, p });
  return p;
}
