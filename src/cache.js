function createCache(defaultTtlMs = 60000) {
  const store = new Map();

  function resolveTtlMs(ttlMs) {
    if (Number.isFinite(ttlMs) && ttlMs >= 0) {
      return ttlMs;
    }
    return defaultTtlMs;
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    const ttl = resolveTtlMs(ttlMs);
    const expiresAt = Date.now() + ttl;
    store.set(key, {
      value,
      expiresAt,
    });
    return value;
  }

  async function wrap(key, fn, ttlMs = defaultTtlMs) {
    const cached = get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fn();
    set(key, value, ttlMs);
    return value;
  }

  function deleteKey(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return {
    get,
    set,
    wrap,
    delete: deleteKey,
    clear,
  };
}

module.exports = {
  createCache,
};
