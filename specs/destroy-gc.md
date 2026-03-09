# Full resource cleanup / GC

## Problem

`cors-prxy destroy` only targets the current config's runtime. When migrating from Lambda to Cloudflare (or vice versa), the old resources are orphaned. There's no easy way to clean them up.

## Requirements

### `cors-prxy destroy` improvements

1. **Config-based destroy** (current behavior, improved):
   ```sh
   cors-prxy destroy          # destroy proxy defined by .cors-prxy.json
   ```
   Should destroy all resources for the named proxy across all runtimes, not just the config's current runtime. If `og-crd` has both a Lambda and a CF Worker, destroy both.

2. **Named destroy** (new):
   ```sh
   cors-prxy destroy --name og-crd                  # destroy all runtimes
   cors-prxy destroy --name og-crd --runtime lambda  # destroy only Lambda
   ```
   No config file needed — uses tags/API to find and destroy by name.

3. **Full cleanup per resource type**:
   - **Lambda**: delete Function URL, delete function, detach all role policies, delete IAM role
   - **Cloudflare**: delete Worker, delete KV namespaces (if any), remove routes/custom domains

### `cors-prxy gc` (optional, nice to have)

```sh
cors-prxy gc              # find and destroy orphaned resources
cors-prxy gc --dry-run    # list what would be destroyed
```

Discovers all `cors-prxy`-tagged resources (via `cors-prxy ls`) and cross-references with known configs. Resources not backed by a config are candidates for cleanup.

## Implementation notes

- Lambda cleanup: use tags (`cors-prxy:name`) to find IAM role name, detach all policies, delete role
- CF cleanup: Worker name is deterministic (`cors-prxy-{name}`), delete via API
- `destroy` should confirm before deleting (unless `--yes`), showing what will be removed
- `destroy` should be idempotent — silently skip resources that don't exist
