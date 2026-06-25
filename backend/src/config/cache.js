const { LRUCache } = require("lru-cache");
const { env } = require("./env");
const { childLogger } = require("./logger");

const logger = childLogger("cache");

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function createCache({ name, max = env.cache.maxItems, ttl = env.cache.ttlMs }) {
  const cache = new LRUCache({
    max,
    ttl,
    updateAgeOnGet: false,
    allowStale: false,
  });

  function key(parts) {
    return `${name}:${stableStringify(parts)}`;
  }

  async function remember(parts, loader, options = {}) {
    if (!env.cache.enabled || options.skip) {
      return loader();
    }

    const cacheKey = key(parts);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const value = await loader();
    if (value !== undefined && options.cache !== false) {
      cache.set(cacheKey, value);
    }
    return value;
  }

  function get(parts) {
    if (!env.cache.enabled) return undefined;
    return cache.get(key(parts));
  }

  function set(parts, value, options = {}) {
    if (!env.cache.enabled || value === undefined) return;
    cache.set(key(parts), value, options);
  }

  function del(parts) {
    cache.delete(key(parts));
  }

  function clear() {
    cache.clear();
    logger.debug({ name }, "Cache cleared");
  }

  return {
    key,
    get,
    set,
    remember,
    del,
    clear,
    size: () => cache.size,
  };
}

const caches = {
  listings: createCache({
    name: "listings",
    ttl: env.cache.listingsTtlMs,
  }),
  cms: createCache({
    name: "cms",
    ttl: env.cache.cmsTtlMs,
  }),
  acceptedPartners: createCache({
    name: "accepted-partners",
    ttl: env.cache.acceptedPartnersTtlMs,
  }),
};

function clearListingCaches(listingId) {
  caches.listings.clear();
  if (listingId) {
    caches.listings.del(["detail", listingId]);
  }
}

function clearCmsCaches(pageId) {
  caches.cms.clear();
  if (pageId) {
    caches.cms.del(["page", pageId]);
  }
}

function clearAcceptedPartnersCache() {
  caches.acceptedPartners.clear();
}

module.exports = {
  createCache,
  stableStringify,
  caches,
  clearListingCaches,
  clearCmsCaches,
  clearAcceptedPartnersCache,
};
