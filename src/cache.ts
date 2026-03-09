interface CacheEntry<T> {
  value: T
  expiry: number
}

export class LRUCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private ttlMs: number

  constructor(maxSize: number, ttlSeconds: number) {
    this.maxSize = maxSize
    this.ttlMs = ttlSeconds * 1000
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiry) {
      this.map.delete(key)
      return undefined
    }
    // Move to end (most recently used)
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    this.map.delete(key)
    if (this.map.size >= this.maxSize) {
      // Evict oldest (first key)
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { value, expiry: Date.now() + this.ttlMs })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  get size(): number {
    return this.map.size
  }
}
