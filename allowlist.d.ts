import type { AllowRule } from "./config.js";
export declare function isAllowed(urlStr: string, rules: AllowRule[]): boolean;
export declare function compactAllowlist(rules: AllowRule[]): string;
