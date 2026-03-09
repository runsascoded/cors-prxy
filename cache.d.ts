export declare class LRUCache<T> {
    private map;
    private maxSize;
    private ttlMs;
    constructor(maxSize: number, ttlSeconds: number);
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    has(key: string): boolean;
    get size(): number;
}
