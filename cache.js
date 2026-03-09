export class LRUCache {
    map = new Map();
    maxSize;
    ttlMs;
    constructor(maxSize, ttlSeconds) {
        this.maxSize = maxSize;
        this.ttlMs = ttlSeconds * 1000;
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiry) {
            this.map.delete(key);
            return undefined;
        }
        // Move to end (most recently used)
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    set(key, value) {
        this.map.delete(key);
        if (this.map.size >= this.maxSize) {
            // Evict oldest (first key)
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined)
                this.map.delete(oldest);
        }
        this.map.set(key, { value, expiry: Date.now() + this.ttlMs });
    }
    has(key) {
        return this.get(key) !== undefined;
    }
    get size() {
        return this.map.size;
    }
}
//# sourceMappingURL=cache.js.map