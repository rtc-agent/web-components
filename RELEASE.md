# Release Guide

This document describes the release process for `@rtc-agent/*` packages.

## Version Alignment

All `@rtc-agent/*` packages in this monorepo **must have the same version number**. This is enforced by CI/CD and is critical for consistency.

### Why Version Alignment Matters

1. **Consistency**: Users can easily identify compatible package versions
2. **Simplified Dependencies**: Workspace packages can use `workspace:*` without version conflicts
3. **Predictable Releases**: All packages are released together with the same version
4. **Easier Troubleshooting**: When all packages have the same version, it's easier to identify issues

### Checking Version Alignment

Before releasing, verify that all packages have the same version:

```bash
pnpm verify-version
```

This will output the current version of each package and fail if they are not aligned.

### Aligning Versions

If versions are not aligned, use the sync-version script:

```bash
# Sync all packages to a specific version
pnpm sync-version 0.1.0-rc.2
```

This will:
1. Update all `@rtc-agent/*` package.json files to the specified version
2. Output a summary of changes
3. Provide next steps for committing and tagging

## Release Workflow

### 1. Prepare the Release

```bash
# Ensure you're on the dev branch
git checkout dev

# Pull latest changes
git pull origin dev

# Install dependencies
pnpm install

# Run all checks
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Verify version alignment
pnpm verify-version
```

### 2. Set the Release Version

If the current version is not correct, sync all packages:

```bash
# For a release candidate
pnpm sync-version 0.1.0-rc.2

# For a stable release
pnpm sync-version 0.1.0
```

### 3. Commit and Tag

```bash
# Commit the version changes
git add packages/*/package.json package.json pnpm-lock.yaml
git commit -m "chore: release v0.1.0-rc.2"

# Create a tag
git tag v0.1.0-rc.2

# Push changes and tag
git push origin dev
git push origin v0.1.0-rc.2
```

### 4. Create a GitHub Release

1. Go to https://github.com/rtc-agent/rtc-agent/releases
2. Click "Draft a new release"
3. Select the tag you just pushed (e.g., `v0.1.0-rc.2`)
4. Set the release title (e.g., "RTC Agent v0.1.0-rc.2")
5. Add release notes describing the changes
6. Click "Publish release"

### 5. Automated Publishing

The GitHub release triggers the `publish-npm.yml` workflow, which:

1. Checks out the code at the tagged version
2. Installs dependencies
3. Builds all packages
4. **Verifies version alignment** (fails if versions don't match the tag)
5. Publishes packages to npm in the correct order:
   - `@rtc-agent/protocol`
   - `@rtc-agent/client`
   - `@rtc-agent/persistence`
   - `@rtc-agent/worker`
   - `@rtc-agent/component`

### 6. Verify the Release

After the workflow completes:

```bash
# Check npm
npm view @rtc-agent/component version

# Test installation in a new project
npm install @rtc-agent/component@0.1.0-rc.2
```

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **Major** (X.0.0): Breaking changes
- **Minor** (0.X.0): New features, backwards compatible
- **Patch** (0.0.X): Bug fixes, backwards compatible
- **Pre-release** (0.1.0-rc.2): Release candidates, beta versions

### Pre-release Versions

Pre-release versions use the format `X.Y.Z-tag.N`:

- `0.1.0-rc.1` - First release candidate for 0.1.0
- `0.1.0-rc.2` - Second release candidate (if needed)
- `0.1.0-beta.1` - Beta release

### Stable Releases

When releasing a stable version:

1. Ensure all pre-release versions have been tested
2. Update changelog with all changes since last stable release
3. Follow the release workflow above with version `X.Y.Z` (no tag)

## Troubleshooting

### Version Mismatch in CI

If the CI workflow fails with "Version mismatch":

```bash
# Check current versions
pnpm verify-version

# Sync to the expected version (from the git tag)
pnpm sync-version <expected-version>

# Commit and push
git add packages/*/package.json package.json
git commit -m "chore: fix version alignment"
git push origin dev
```

### Publishing Failures

If a package fails to publish:

1. Check the npm token is valid
2. Verify the package name is not already taken
3. Ensure the version is not already published
4. Check the workflow logs for specific errors

### Inconsistent Versions

If you accidentally publish with inconsistent versions:

1. Do **not** try to unpublish (npm doesn't allow this after 72 hours)
2. Immediately release a new version with all packages aligned
3. Add a note to the release documentation about the issue

## Best Practices

1. **Always verify before releasing**: Run `pnpm verify-version` before creating a tag
2. **Test pre-releases thoroughly**: Use release candidates to catch issues before stable releases
3. **Keep changelogs updated**: Document all changes between versions
4. **Use automation**: Let the CI/CD workflow handle publishing to avoid manual errors
5. **Communicate changes**: Inform users of breaking changes in release notes

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm sync-version <version>` | Sync all packages to the specified version |
| `pnpm verify-version` | Verify all packages have the same version |
| `pnpm verify-version <version>` | Verify all packages match the expected version |

## Further Reading

- [Workspace Guide](./WORKSPACE.md) - Monorepo structure and toolchain
- [Build Strategy](./BUILD_STRATEGY.md) - Build tools and strategies
- [Contributing Guide](./README.md#contributing) - Code style and commit conventions
