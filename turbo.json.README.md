# Turbo Build Configuration

This document explains the `turbo.json` configuration for the RTC Agent web-components monorepo.

## Build Inputs Configuration

The `build` task includes a comprehensive list of input files that trigger rebuilds when changed:

```json
"inputs": [
  "src/**",
  "public/**",
  "config/**",
  "mock/**",
  "tsconfig.json",
  "package.json",
  "vite.config.ts",
  "tsup.config.ts",
  "tailwind.config.*",
  "tailwind.css",
  "lit-localize.json",
  "!src/**/*.test.ts",
  "!src/**/*.test.tsx",
  "!src/**/*.integration.test.ts",
  "!src/**/test-setup.ts",
  "!src/**/test-utils/**"
]
```

### Why Keep Global Configuration?

Some input patterns (e.g., `tsup.config.ts`, `tailwind.config.*`) are not used by all packages in the monorepo. However, they are kept in the global configuration for the following reasons:

1. **Simplicity**: A single global configuration is easier to maintain than per-package configurations. Most packages use a subset of these inputs, and the overhead of watching unused files is negligible.

2. **Consistency**: Ensures all packages follow the same build caching rules. If a package adds a new config file (e.g., a new Tailwind setup), it automatically benefits from correct cache invalidation without requiring turbo.json updates.

3. **Future-proofing**: As packages evolve, they may adopt new tooling (e.g., Tailwind CSS, tsup bundler). Having these patterns in the global config prevents cache staleness issues when new configs are introduced.

4. **Test Exclusion**: Test files are explicitly excluded (`!src/**/*.test.ts`) to prevent test changes from triggering production builds. This is a monorepo-wide convention.

### When to Add Per-Package Configuration

If a specific package has unique build requirements that differ significantly from the global config, you can add a `turbo.json` in that package's directory. For example:

```json
// packages/special-package/turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "extends": ["//"],
  "tasks": {
    "build": {
      "inputs": ["src/**", "special-config.json"]
    }
  }
}
```

However, this should be rare. Prefer the global configuration unless there's a compelling reason to deviate.

## Performance Considerations

- **Cache Hit Rate**: The global configuration optimizes for cache hits across packages. Changing any source file invalidates the cache for that package only.
- **Build Time**: Watching additional file patterns has minimal impact on build performance. The bottleneck is typically compilation, not file watching.
- **CI/CD**: In CI environments, the cache is shared across runs. A well-configured input list ensures correct builds while maximizing cache reuse.

## References

- [Turbo Repo Configuration](https://turbo.build/repo/docs/reference/configuration)
- [Task Inputs](https://turbo.build/repo/docs/reference/configuration#inputs)
- [Monorepo Best Practices](https://turbo.build/repo/docs/handbook)
