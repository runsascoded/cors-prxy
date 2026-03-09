# `destroy`: clean up IAM roles when Lambda function already deleted

## Problem

`cors-prxy destroy` fails to clean up IAM roles when the Lambda function has already been deleted.

### Root cause

`findDestroyTargets()` in `src/deploy.ts` (line 35) uses `GetFunctionCommand` to detect Lambda resources. If the function is already gone (`ResourceNotFoundException`), no target is created, and `destroyLambdaByName()` is never called — even though its IAM role + inline policy still exist.

### Reproduction

1. Deploy a Lambda proxy: `cors-prxy deploy` (with `"runtime": "lambda"`)
2. Delete the Lambda function directly (e.g. via AWS console or `aws lambda delete-function`)
3. Run `cors-prxy destroy --name og-crd --runtime lambda --yes`
4. Output: "No resources found for 'og-crd'"
5. IAM role `cors-prxy-og-crd-role` (with inline policy `cors-prxy-logs`) remains orphaned

### Real-world trigger

This happened during the `og-crd` project's Lambda→Cloudflare migration. The Lambda function was destroyed, but the IAM role persisted. `cors-prxy destroy` reported nothing to clean up.

## Fix

`findDestroyTargets()` should also check for the IAM role `cors-prxy-{name}-role` independently of whether the Lambda function exists. If either resource exists, a Lambda target should be reported.

### Suggested approach

In `findDestroyTargets()`, after the `GetFunctionCommand` check (whether it succeeds or not), also probe for the IAM role:

```ts
const { IAMClient, GetRoleCommand } = await import("@aws-sdk/client-iam")
const iam = new IAMClient({ region })
const roleName = `cors-prxy-${name}-role`
try {
  await iam.send(new GetRoleCommand({ RoleName: roleName }))
  hasIamRole = true
} catch (err) {
  if ((err as { name?: string }).name !== "NoSuchEntityException") throw err
}
```

If either the Lambda function or the IAM role exists, add a target. Update the `detail` string to reflect which resources are present (e.g. "IAM role only" when the function is gone).

`destroyLambdaByName()` already handles both resources independently with proper not-found error handling, so no changes needed there.

## Scope

- `src/deploy.ts`: `findDestroyTargets()` — add IAM role check
- No changes needed in `src/deploy-lambda.ts` (cleanup logic already correct)
