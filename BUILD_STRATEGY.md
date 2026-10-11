# Build Strategy Guide

This document explains the build strategies used across packages in this monorepo.

## Overview

Packages use different build strategies based on their specific requirements. While consolidation to a single tool (e.g., tsup) would reduce complexity, the current strategies reflect practical trade-offs.

## Strategies

### 1. Vite Build + tsc (Declaration Only)

**Used by**: `@rtc-agent/component`

```json
{
  "scripts": {
    "build": "rm -rf dist && vite build && tsc --emitDeclarationOnly --declaration --declarationMap"
  }
}
```

**Rationale**:
- Vite provides optimized bundling for browser-targeted code (Web Components, Lit)
- Handles CSS, assets, and complex module resolution
- `tsc` runs separately to generate type declarations (`.d.ts` files)
- Vite's rollup-based output is better suited for library distribution than raw `tsc`

**When to use**:
- Package contains Web Components or browser-specific code
- Requires asset bundling or complex transforms
- Needs optimized output for direct browser consumption

### 2. tsup + tsc (Declaration Only)

**Used by**: `@rtc-agent/persistence`

```json
{
  "scripts": {
    "build": "rm -rf dist && tsup && tsc --emitDeclarationOnly --declaration --declarationMap --outDir dist && node scripts/remove-sourcemap-refs.js"
  }
}
```

**Rationale**:
- tsup (powered by esbuild) provides fast bundling with sensible defaults
- Handles both ESM and CJS output formats easily
- Separate `tsc` step ensures accurate type declarations
- Post-build script removes sourcemap references for cleaner output

**When to use**:
- Package needs bundling but doesn't require Vite's browser-specific features
- Wants fast build times with esbuild
- Needs flexible output format configuration

### 3. Pure tsc

**Used by**: `@rtc-agent/protocol`, `@rtc-agent/client`, `@rtc-agent/worker`

```json
{
  "scripts": {
    "build": "rm -rf dist && tsc"
  }
}
```

**Rationale**:
- No bundling required - packages are consumed as-is
- Simpler build pipeline, faster for pure TypeScript packages
- Preserves original module structure (no tree-shaking needed)
- Type declarations generated automatically

**When to use**:
- Package contains only TypeScript source code
- No complex transforms or bundling needed
- Consumers will bundle the package themselves
- Library code that should remain modular

## Future Considerations

### Consolidation to tsup

If maintenance complexity becomes problematic, consider migrating all packages to tsup:

**Benefits**:
- Single tool for all build operations
- Consistent configuration across packages
- Built-in support for multiple output formats
- Fast build times

**Migration path**:
1. Start with pure `tsc` packages (protocol, client, worker)
2. Migrate persistence (already uses tsup)
3. Evaluate component package separately (Vite may still be needed for dev server)

**Trade-offs**:
- Loss of Vite's dev server features for component development
- Need to configure tsup for each package's specific requirements
- May require additional tooling for asset handling

## Recommendation

**Keep current strategy** for now, as each tool serves a specific purpose:
- Vite for browser-optimized components
- tsup for fast, flexible bundling
- tsc for simple, modular packages

Document this decision and revisit if:
- Build times become problematic
- New packages require consistent configuration
- Maintenance overhead increases significantly
