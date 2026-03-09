# GHA OIDC setup + reusable deploy workflow

## Summary

Add a `cors-prxy setup-oidc` CLI command and a reusable GHA workflow so that projects can manage their Lambda proxy entirely through CI, with no local AWS credentials needed after initial setup.

## Motivation

Currently the workflow is:
1. Run `cors-prxy deploy` locally (requires AWS credentials)
2. Copy the Lambda URL into source or env vars
3. Lambda URL is stable, rarely needs redeployment

This works fine. The question is whether a fully CI-managed approach adds enough value to justify the complexity.

## Proposed design

### `cors-prxy setup-oidc`

Run locally with admin credentials, once per repo:

```sh
cors-prxy setup-oidc --repo runsascoded/og-crd
```

This would:
1. Create/ensure the GitHub OIDC provider in the AWS account (`token.actions.githubusercontent.com`)
2. Create an IAM role (`cors-prxy-gha-runsascoded-og-crd`) with:
   - Trust policy scoped to the specific repo
   - Permissions limited to Lambda + IAM operations needed by `cors-prxy deploy`
3. Set the role ARN as a GitHub repo variable or secret (`AWS_ROLE_ARN`)
4. Print instructions / confirm setup

### Reusable GHA workflow

```yaml
# In consuming project:
jobs:
  cors-proxy:
    uses: runsascoded/cors-prxy/.github/workflows/deploy.yml@v1
    with:
      config: .cors-prxy.json
    secrets:
      aws-role-arn: ${{ secrets.AWS_ROLE_ARN }}
```

Triggered on changes to `.cors-prxy.json`, runs `cors-prxy deploy` with OIDC auth.

### Output

The workflow would output the Lambda URL, which could be:
- Set as a GH repo variable automatically (`VITE_CORS_PROXY_URL` or configurable name)
- Printed in the job summary

## Open question: does this add value?

The current "deploy locally, set env var" approach has these properties:
- Lambda URL is **stable** — doesn't change unless you destroy/recreate
- Redeployment is rare (only when changing allowlist)
- One `cors-prxy deploy` command, done

The GHA approach would add:
- **Audit trail**: all deploys happen via GHA logs (public, reviewable)
- **No local credentials needed** after initial OIDC setup (but OIDC setup itself needs admin)
- **Config drift protection**: push to `.cors-prxy.json` auto-redeploys
- **Multi-contributor**: anyone with repo push access can update the proxy config

But it also adds:
- **OIDC setup complexity**: IAM provider, role, trust policy, GH secrets
- **More moving parts**: GHA workflow, OIDC token exchange, IAM role assumption
- **Initial setup still requires local admin credentials** (for `setup-oidc`)
- **Marginal benefit for single-maintainer projects** where "I ran deploy" is sufficient

For projects like og-crd (single maintainer, stable config), the local approach is simpler and equivalent. The GHA approach becomes more valuable for team projects where deploy access should be controlled via code review rather than individual AWS credentials.

## Recommendation

Implement this as a v2 feature if there's demand, but don't prioritize it over core functionality. The current local-deploy workflow is adequate for most use cases. Document both approaches in the README and let users choose.

If implemented, `setup-oidc` should be as turnkey as possible — a single command that handles everything including setting the GH secret, so the user just has to add the workflow file.
