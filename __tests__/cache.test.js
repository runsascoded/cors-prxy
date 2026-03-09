import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LRUCache } from "../cache.js";
describe("LRUCache", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    it("stores and retrieves values", () => {
        const cache = new LRUCache(10, 60);
        cache.set("a", "hello");
        expect(cache.get("a")).toBe("hello");
    });
    it("returns undefined for missing keys", () => {
        const cache = new LRUCache(10, 60);
        expect(cache.get("missing")).toBeUndefined();
    });
    it("evicts oldest entry when maxSize exceeded", () => {
        const cache = new LRUCache(2, 60);
        cache.set("a", "1");
        cache.set("b", "2");
        cache.set("c", "3"); // should evict "a"
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe("2");
        expect(cache.get("c")).toBe("3");
    });
    it("evicts least recently used (not just oldest inserted)", () => {
        const cache = new LRUCache(2, 60);
        cache.set("a", "1");
        cache.set("b", "2");
        cache.get("a"); // access "a" to make it recent
        cache.set("c", "3"); // should evict "b" (least recently used)
        expect(cache.get("a")).toBe("1");
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("c")).toBe("3");
    });
    it("expires entries after TTL", () => {
        const cache = new LRUCache(10, 5); // 5 second TTL
        cache.set("a", "hello");
        expect(cache.get("a")).toBe("hello");
        vi.advanceTimersByTime(6000); // 6 seconds
        expect(cache.get("a")).toBeUndefined();
    });
    it("has() returns false for expired entries", () => {
        const cache = new LRUCache(10, 1);
        cache.set("a", "val");
        expect(cache.has("a")).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(cache.has("a")).toBe(false);
    });
    it("tracks size correctly", () => {
        const cache = new LRUCache(10, 60);
        expect(cache.size).toBe(0);
        cache.set("a", "1");
        cache.set("b", "2");
        expect(cache.size).toBe(2);
    });
});
//# sourceMappingURL=cache.test.js.map