import picomatch from "picomatch"
import type { AllowRule, AllowRuleObject } from "./config.js"

export function isAllowed(urlStr: string, rules: AllowRule[]): boolean {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    return false
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false
  }

  const hostname = url.hostname
  const pathname = url.pathname

  for (const rule of rules) {
    if (typeof rule === "string") {
      if (matchDomain(hostname, rule)) return true
    } else {
      if (matchDomainPaths(hostname, pathname, rule)) return true
    }
  }

  return false
}

function matchDomain(hostname: string, pattern: string): boolean {
  return picomatch.isMatch(hostname, pattern)
}

function matchDomainPaths(hostname: string, pathname: string, rule: AllowRuleObject): boolean {
  if (!matchDomain(hostname, rule.domain)) return false
  return rule.paths.some(p => picomatch.isMatch(pathname, p))
}

export function compactAllowlist(rules: AllowRule[]): string {
  return rules.map(r => typeof r === "string" ? r : r.domain).join(",")
}
