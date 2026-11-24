// Performance diagnostics (perf-diagnostics branch, not for release). The sidebar and the service worker each keep
// per-minute counters and timings and append them to IndexedDB (not chrome.storage: the sidebar re-renders on every
// storage change). Options → "Export diagnostics" downloads everything as JSON. Kept for 14 days.

const DB = "hop-diagnostics";
const STORE = "samples";
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

let opened;
function db() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

async function transaction(mode, work) {
  const tx = (await db()).transaction(STORE, mode);
  const result = work(tx.objectStore(STORE));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

export const append = (sample) => transaction("readwrite", (store) => store.add(sample)).catch(console.warn);

export async function allSamples() {
  let request;
  await transaction("readonly", (store) => (request = store.getAll()));
  return request.result;
}

/** Drop samples older than two weeks (they are stored oldest first). */
export function prune() {
  const cutoff = Date.now() - KEEP_MS;
  return transaction("readwrite", (store) => {
    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && cursor.value.at < cutoff) {
        cursor.delete();
        cursor.continue();
      }
    };
  }).catch(console.warn);
}

/**
 * Per-minute counters for one context ("sidebar" or "background"). `extra()` adds a snapshot (heap, DOM size, …) to
 * each saved minute. Minutes are saved by a timer and, in the service worker (whose timers die with it), on the first
 * event after a minute has passed.
 */
export function collector(source, extra = () => ({})) {
  let bucket = fresh();
  let lagTimer;

  function fresh() {
    return { at: Date.now(), source, counts: {}, totalMs: {}, maxMs: {}, lagMaxMs: 0, lagOver100: 0 };
  }

  function count(name, n = 1) {
    bucket.counts[name] = (bucket.counts[name] ?? 0) + n;
    if (Date.now() - bucket.at >= MINUTE) flush();
  }

  function time(name, ms) {
    bucket.totalMs[name] = Math.round(((bucket.totalMs[name] ?? 0) + ms) * 10) / 10;
    bucket.maxMs[name] = Math.round(Math.max(bucket.maxMs[name] ?? 0, ms) * 10) / 10;
    count(name);
  }

  async function timed(name, work) {
    const start = performance.now();
    try {
      return await work();
    } finally {
      time(name, performance.now() - start);
    }
  }

  async function flush() {
    const done = bucket;
    bucket = fresh();
    done.end = Date.now();
    try {
      Object.assign(done, await extra());
    } catch (error) {
      done.extraError = String(error);
    }
    await append(done);
  }

  // Main-thread stalls: how late a 500 ms timer fires.
  function watchLag() {
    let expected = performance.now() + 500;
    lagTimer = setInterval(() => {
      const late = performance.now() - expected;
      expected = performance.now() + 500;
      bucket.lagMaxMs = Math.max(bucket.lagMaxMs, Math.round(late));
      if (late > 100) bucket.lagOver100 += 1;
    }, 500);
  }

  setInterval(() => Date.now() - bucket.at >= MINUTE && flush(), 5000);
  watchLag();
  append({ at: Date.now(), source, event: "start", version: chrome.runtime.getManifest().version });
  prune();
  return { count, time, timed, flush, stop: () => clearInterval(lagTimer) };
}
