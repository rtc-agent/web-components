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

## Sourcemap Strategies

Packages use different sourcemap hiding strategies based on their build tools. Both achieve the same security goal: **generating `.map` files for error tracking tools (Sentry, etc.) while preventing browser DevTools from discovering them**.

### Strategy 1: Vite `hidden` Mode

**Used by**: `@rtc-agent/component`

```typescript
// vite.config.ts
sourcemap: mode === 'development' ? true : 'hidden',
```

**How it works**:

- Vite/Rollup generates `.map` files but does NOT append `//# sourceMappingURL=` comments to JS files
- The `.map` files exist on disk but are invisible to browsers
- No post-build processing needed

**When to use**:

- Build tool supports `hidden` sourcemap mode natively (Vite, Rollup, esbuild)
- Simpler build pipeline with fewer moving parts

### Strategy 2: Post-build Script Removal

**Used by**: `@rtc-agent/persistence`, `@rtc-agent/client`, `@rtc-agent/worker`

```json
{
  "scripts": {
    "build": "... && node ../../scripts/remove-sourcemap-refs.js"
  }
}
```

**How it works**:

- Build tool generates `.map` files AND appends `//# sourceMappingURL=` comments
- Post-build script (`scripts/remove-sourcemap-refs.js`) strips those comments from JS files
- Result: `.map` files exist but browsers can't discover them

**When to use**:

- Build tool only supports `boolean` sourcemap option (tsup, tsc)
- tsup only supports `true | false | 'inline'`, so post-processing is needed for hidden sourcemaps

### Why Two Strategies?

The inconsistency stems from tool limitations:

- **Vite** (component): Native `hidden` support -> use it directly
- **tsup** (persistence): Only `boolean` option -> must use script
- **tsc** (client, worker): Always generates sourcemap comments -> must use script

**Security benefit (both strategies)**:

- Error tracking tools (Sentry) can upload `.map` files server-side
- Browser DevTools cannot discover sourcemaps (users can't reverse-engineer code)
- Internal API paths, business logic, and code structure remain hidden

### Future Consolidation

If all packages migrate to tsup (see "Future Considerations"), the script-based approach becomes standard. Alternatively, if Vite becomes the standard, the native `hidden` mode is cleaner.

**Current recommendation**: Keep both strategies as-is. They achieve the same result with minimal overhead.

---

## Monorepo Build Order & Dependencies

### First-Time Installation

**Important**: The `@rtc-agent/component` package exposes a CLI tool (`rtc-agent-setup`) via its `bin` field, which is used by `admin-ui`'s `prepare` script. This creates a build order dependency:

```bash
# Correct first-time setup
pnpm install          # Install all dependencies
pnpm --filter @rtc-agent/component build   # Build component first (generates dist/)
pnpm --filter @rtc-agent/admin-ui prepare  # Now rtc-agent-setup will work
pnpm build            # Build everything else
```

### Why This Order Matters

The `rtc-agent-setup` script copies SharedWorker files from `@rtc-agent/component/dist/assets/` to the host application's public directory. If the component package hasn't been built yet:

- The script runs but finds no `dist/assets/` directory
- It exits gracefully with a warning (not an error)
- SharedWorker files won't be available until the component is built and setup is re-run

### Normal Development Workflow

After the initial build, the order doesn't matter:

```bash
pnpm install          # Dependencies already installed
pnpm dev              # Start development server (component built on-demand)
pnpm build            # Build all packages (turbo handles order)
```

### CI/CD Pipeline

CI should follow the first-time setup order:

```yaml
- run: pnpm install
- run: pnpm --filter @rtc-agent/component build
- run: pnpm --filter @rtc-agent/admin-ui prepare
- run: pnpm build
- run: pnpm test
```

---

## Development Workflow

This section explains how hot updates work during development across workspace packages.

### Starting Development Mode

The typical development workflow:

```bash
# Terminal 1: Start the component dev server (Vite)
pnpm dev  # or: pnpm --filter @rtc-agent/component dev

# Terminal 2: Start admin-ui dev server (Umi Max)
cd packages/admin-ui && pnpm start

# Terminal 3 (optional): Watch other packages
pnpm --filter @rtc-agent/persistence dev  # If persistence has dev mode
pnpm --filter @rtc-agent/protocol dev      # If protocol has dev mode
```

### Package Dependencies & Hot Update Behavior

Understanding the dependency graph is crucial for efficient development:

```text
@rtc-agent/component (Web Component library)
  ├── depends on: @rtc-agent/protocol, @rtc-agent/persistence, @rtc-agent/worker, @rtc-agent/client
  └── consumed by: admin-ui (via script tag or npm package)

@rtc-agent/admin-ui (React/Umi application)
  └── depends on: @rtc-agent/component (built output)

@rtc-agent/persistence (IndexedDB layer)
  └── depends on: @rtc-agent/protocol

@rtc-agent/worker (SharedWorker logic)
  └── depends on: @rtc-agent/protocol, @rtc-agent/client

@rtc-agent/client (API client)
  └── depends on: @rtc-agent/protocol
```

### Hot Update Scenarios

#### Scenario 1: Modifying Component Package

**What happens**:
- Vite dev server automatically rebuilds the component
- HMR (Hot Module Replacement) updates the browser if possible
- admin-ui dev server does **NOT** automatically reload (it uses built output)

**What you need to do**:

```bash
# Option A: Restart admin-ui dev server (recommended for major changes)
cd packages/admin-ui
# Stop the server (Ctrl+C)
pnpm start

# Option B: Hard refresh the browser (for minor changes)
# In browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
```

**Why**: admin-ui imports the component package's **built output** (`dist/`), not the source code. The component's dev server rebuilds `dist/` on changes, but admin-ui's dev server doesn't watch `node_modules/@rtc-agent/component/dist/` for changes.

#### Scenario 2: Modifying Protocol/Persistence/Worker/Client Packages

**What happens**:
- These packages use `tsc` (or `tsup`) for building
- No hot reload - you must rebuild manually

**What you need to do**:

```bash
# Rebuild the specific package
pnpm --filter @rtc-agent/protocol build
pnpm --filter @rtc-agent/persistence build
# etc.

# Then rebuild component (if it depends on the changed package)
pnpm --filter @rtc-agent/component build

# Then restart admin-ui dev server
cd packages/admin-ui
pnpm start
```

**Why**: These packages export TypeScript source that is consumed by the component package. The component's build process (Vite + tsc) transpiles them, but changes don't propagate automatically.

#### Scenario 3: Modifying admin-ui Only

**What happens**:
- Umi Max dev server has HMR enabled
- Changes to admin-ui source files trigger automatic reload
- No need to rebuild other packages

**What you need to do**:

```bash
# Just start admin-ui dev server
cd packages/admin-ui
pnpm start

# Edit files - browser updates automatically
```

### Turbo Dev Mode (Future Enhancement)

Currently, packages don't have individual `dev` scripts with watch mode. Consider adding:

```json
// packages/protocol/package.json
{
  "scripts": {
    "dev": "tsc --watch",
    "build": "rm -rf dist && tsc"
  }
}
```

Then use:

```bash
# Terminal: Watch all packages for changes
pnpm -r dev
```

This would provide automatic rebuilds when source files change, improving the development experience.

### Common Development Patterns

#### Pattern 1: Full Stack Development

When working on features that span multiple packages:

```bash
# 1. Start all dev servers in separate terminals
# Terminal 1
pnpm --filter @rtc-agent/protocol build -- --watch

# Terminal 2
pnpm --filter @rtc-agent/component dev

# Terminal 3
cd packages/admin-ui && pnpm start
```

#### Pattern 2: Quick Iteration on Component

When iterating on component UI/UX:

```bash
# Use component's debug page
pnpm dev
# Open http://localhost:5173/debug/ in browser
# Changes to component source update automatically
```

#### Pattern 3: Testing Changes in admin-ui

When you need to test component changes in the full admin-ui environment:

```bash
# 1. Build component
pnpm --filter @rtc-agent/component build

# 2. Restart admin-ui dev server
cd packages/admin-ui
# Stop if running, then:
pnpm start

# 3. Hard refresh browser
# Cmd+Shift+R / Ctrl+Shift+R
```

### Troubleshooting Hot Updates

**Problem**: Changes to component not reflected in admin-ui

**Solutions**:

1. Check if component dev server is running and rebuilt successfully
2. Verify `dist/` directory was updated: `ls -lh packages/component/dist/`
3. Restart admin-ui dev server
4. Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
5. Clear browser cache if necessary

**Problem**: Build errors after modifying protocol/persistence

**Solutions**:

1. Rebuild the modified package: `pnpm --filter <package> build`
2. Rebuild component: `pnpm --filter @rtc-agent/component build`
3. Check for TypeScript errors: `pnpm typecheck`

---

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
