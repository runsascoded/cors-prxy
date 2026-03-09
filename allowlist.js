import picomatch from "picomatch";
export function isAllowed(urlStr, rules) {
    let url;
    try {
        url = new URL(urlStr);
    }
    catch {
        return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
    }
    const hostname = url.hostname;
    const pathname = url.pathname;
    for (const rule of rules) {
        if (typeof rule === "string") {
            if (matchDomain(hostname, rule))
                return true;
        }
        else {
            if (matchDomainPaths(hostname, pathname, rule))
                return true;
        }
    }
    return false;
}
function matchDomain(hostname, pattern) {
    return picomatch.isMatch(hostname, pattern);
}
function matchDomainPaths(hostname, pathname, rule) {
    if (!matchDomain(hostname, rule.domain))
        return false;
    return rule.paths.some(p => picomatch.isMatch(pathname, p));
}
export function compactAllowlist(rules) {
    // AWS tag values only allow [\p{L}\p{Z}\p{N}_.:/=+\-@]
    // Use space as separator (instead of comma), `@` for `*`
    return rules.map(r => typeof r === "string" ? r : r.domain).join(" ").replaceAll("*", "@");
}
//# sourceMappingURL=allowlist.js.map