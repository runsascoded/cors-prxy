# Infer Cloudflare account ID from API token

## Problem

`cors-prxy ls` requires `CLOUDFLARE_ACCOUNT_ID` env var to list CF Workers. If it's not set, CF workers are silently skipped (`listCfProxies` returns `[]`). This is surprising — the user has `CLOUDFLARE_API_TOKEN` set and expects `ls` to work.

Similarly, `deploy` requires `cloudflare.accountId` in config or `CLOUDFLARE_ACCOUNT_ID` env var.

## Fix

The Cloudflare API supports listing accounts a token has access to:

```
GET https://api.cloudflare.com/client/v4/accounts
Authorization: Bearer <token>
```

If `CLOUDFLARE_ACCOUNT_ID` is not set:
1. Call `GET /accounts` with the token
2. If exactly one account is returned, use it
3. If multiple accounts, error with a message listing them and asking the user to set `CLOUDFLARE_ACCOUNT_ID` or `cloudflare.accountId`
4. If zero accounts (or the call fails), skip CF as today

### Where to apply

- `listCfProxies()` in `tags.ts` — currently bails if no `accountId`
- `getCfAccountId()` in `deploy-cf.ts` — currently throws if no `accountId`

Extract a shared `resolveAccountId(apiToken: string): Promise<string>` helper in `deploy-cf.ts` that both can use.

## Context

Came up using `cors-prxy ls` in [aws-static-sso] — `CLOUDFLARE_API_TOKEN` was set but `ls` showed no CF workers until `CLOUDFLARE_ACCOUNT_ID` was also set.

[aws-static-sso]: https://github.com/runsascoded/aws-static-sso
