import { describe, it, expect } from "vitest";
import { isAllowed, compactAllowlist } from "../allowlist.js";
describe("isAllowed", () => {
    const rules = [
        "github.com",
        "*.github.com",
        { domain: "api.example.com", paths: ["/v1/*", "/v2/og/*"] },
    ];
    it("allows exact domain match", () => {
        expect(isAllowed("https://github.com/user/repo", rules)).toBe(true);
    });
    it("allows wildcard subdomain match", () => {
        expect(isAllowed("https://raw.github.com/file.txt", rules)).toBe(true);
        expect(isAllowed("https://api.github.com/repos", rules)).toBe(true);
    });
    it("rejects non-matching domain", () => {
        expect(isAllowed("https://evil.com/steal", rules)).toBe(false);
    });
    it("rejects domain that contains allowed domain as substring", () => {
        expect(isAllowed("https://notgithub.com/path", rules)).toBe(false);
    });
    it("allows domain+path match", () => {
        expect(isAllowed("https://api.example.com/v1/users", rules)).toBe(true);
        expect(isAllowed("https://api.example.com/v2/og/123", rules)).toBe(true);
    });
    it("rejects domain match with wrong path", () => {
        expect(isAllowed("https://api.example.com/v3/other", rules)).toBe(false);
    });
    it("rejects non-http schemes", () => {
        expect(isAllowed("ftp://github.com/file", rules)).toBe(false);
        expect(isAllowed("file:///etc/passwd", rules)).toBe(false);
    });
    it("rejects invalid URLs", () => {
        expect(isAllowed("not-a-url", rules)).toBe(false);
        expect(isAllowed("", rules)).toBe(false);
    });
    it("handles http:// (not just https)", () => {
        expect(isAllowed("http://github.com/readme", rules)).toBe(true);
    });
});
describe("compactAllowlist", () => {
    it("joins domains", () => {
        const rules = [
            "github.com",
            { domain: "api.example.com", paths: ["/v1/*"] },
        ];
        expect(compactAllowlist(rules)).toBe("github.com,api.example.com");
    });
});
//# sourceMappingURL=allowlist.test.js.map