# Build Tools Documentation

This document explains the build tool choices across the RTC Agent workspace.

## Overview

| Package | Build Tool | Output Format | Rationale |
| --- | --- | --- | --- |
| `component` | Vite + tsc | ESM | Web Component library with Lit framework, requires code splitting and asset optimization |
| `persistence` | tsup | ESM | IndexedDB + Dexie.js library, needs to bundle dependencies to prevent version conflicts |
| `worker` | tsc (via component) | ESM | SharedWorker scripts, built as part of component package |
| `client` | tsc | ESM | WebSocket client library, simple TypeScript compilation |
| `protocol` | tsc | ESM | Protocol definitions and utilities, simple TypeScript compilation |
| `admin-ui` | Umi Max | Application | React application with Ant Design Pro, uses Umi's built-in build system |

## Package-Specific Choices

### component (Vite)

**Why Vite?**

1. **Web Component Optimization**: Vite's `build.lib` mode is optimized for component libraries
2. **Code Splitting**: Supports `manualChunks` for better caching (vendor-lit, core-controllers, components-ui)
3. **Asset Handling**: Built-in support for CSS, assets, and worker scripts
4. **Development Experience**: Fast HMR and dev server for component development
5. **Lit Compatibility**: Works well with Lit's decorators and build requirements

**Configuration Highlights:**

- `vite.config.ts`: Main build configuration
- Code splitting via `manualChunks` for optimal loading
- Sourcemap strategy: `true` in dev, `'hidden'` in production
- Worker scripts built as ESM to support code splitting

### persistence (tsup)

**Why tsup?**

1. **Dependency Bundling**: Must bundle `dexie` and `microdiff` to prevent version conflicts with host applications
   - tsup's `noExternal` option forces bundling of specific dependencies
   - This is critical for IndexedDB libraries where version mismatches cause runtime errors
2. **Simplicity**: Single entry point, single output format (ESM)
3. **TypeScript Native**: Built-in TypeScript support with declaration generation
4. **Fast**: Uses esbuild under the hood for rapid builds

**Configuration Highlights:**

- `tsup.config.ts`: Build configuration
- `noExternal: ['dexie', 'microdiff']`: Force bundle critical dependencies
- `external: ['@rtc-agent/*']`: Keep workspace packages external
- Sourcemap: Always generated, references removed in production via script

### worker (tsc via component)

**Why tsc?**

1. **SharedWorker Scripts**: Workers are built as part of the component package
2. **Type Checking**: `tsc --noEmit` for type checking without separate build
3. **Simplicity**: No separate build process needed, integrated into component build

**Build Process:**

- Workers are built via Vite's `?sharedworker` import in component package
- Vite handles worker compilation and asset generation
- Type checking via `tsc --noEmit` in CI/CD

### client (tsc)

**Why tsc?**

1. **Simple Library**: WebSocket client with minimal dependencies
2. **No Bundling Needed**: Published as ESM, consumers handle bundling
3. **Type Declarations**: `tsc --emitDeclarationOnly` generates `.d.ts` files
4. **Fast**: No bundling overhead, just TypeScript compilation

**Configuration:**

- `tsconfig.json`: TypeScript configuration
- Output: ESM format with separate declaration files
- Sourcemaps: Generated for debugging

### protocol (tsc)

**Why tsc?**

1. **Utility Package**: Protocol definitions, types, and utilities
2. **No Runtime Dependencies**: Pure TypeScript code
3. **Type Safety**: Strong typing for protocol contracts
4. **Fast**: Simple compilation, no bundling

**Configuration:**

- Similar to client package
- Exports types and utilities for other packages
- No build step needed beyond TypeScript compilation

### admin-ui (Umi Max)

**Why Umi Max?**

1. **React Framework**: Enterprise React application with Ant Design Pro
2. **Built-in Features**: Routing, state management, i18n, request, mock
3. **Convention-Based**: File-based routing, conventional configuration
4. **Ecosystem**: Integrates with Umi plugins and tools

**Configuration:**

- `config/config.ts`: Umi configuration
- Routes defined in `config/routes.ts`
- Mock data in `mock/` directory
- Build via `max build` command

## Tool Comparison

| Feature | Vite | tsup | tsc | Umi Max |
| --- | --- | --- | --- | --- |
| **Use Case** | Libraries, apps | Libraries | Type checking, simple libs | React apps |
| **Bundling** | Yes (Rollup) | Yes (esbuild) | No | Yes (Webpack) |
| **Code Splitting** | Yes | No | No | Yes |
| **HMR** | Fast | N/A | N/A | Fast |
| **Type Declarations** | Via plugin | Built-in | Native | Built-in |
| **Dependency Bundling** | Optional | Configurable | N/A | Yes |
| **Build Speed** | Fast | Very fast | Fast | Moderate |

## Decision Criteria

When choosing a build tool for a new package:

1. **Is it a Web Component library?** → Use **Vite**
   - Code splitting, asset handling, Lit compatibility

2. **Is it a library that needs to bundle dependencies?** → Use **tsup**
   - Prevents version conflicts, simple configuration

3. **Is it a simple TypeScript library?** → Use **tsc**
   - Fast, no bundling overhead, type declarations

4. **Is it a React application?** → Use **Umi Max**
   - Enterprise features, Ant Design integration

## Migration Considerations

**When to migrate from tsc to tsup/Vite:**

- Need to bundle specific dependencies
- Require code splitting for better performance
- Building a component library

**When to migrate from tsup to Vite:**

- Need code splitting
- Building Web Components
- Require asset handling (CSS, images, etc.)

**When NOT to migrate:**

- Simple libraries work fine with tsc
- Migration cost outweighs benefits
- Current tool meets all requirements

## Best Practices

1. **Consistency Within Package Type**: All similar packages should use the same tool
2. **Document Rationale**: Explain why a specific tool was chosen
3. **Minimize Tool Churn**: Don't switch tools without strong justification
4. **Consider Build Performance**: tsup and Vite are faster than tsc for large projects
5. **Type Declarations**: Ensure all packages generate `.d.ts` files for TypeScript consumers

## Troubleshooting

### Common Issues

**tsup: Dependency version conflicts**

- Solution: Use `noExternal` to force bundle problematic dependencies
- Example: `noExternal: ['dexie', 'microdiff']`

**Vite: Worker scripts not loading**

- Solution: Use `?sharedworker` import suffix
- Ensure worker scripts are in the build output

**tsc: Missing type declarations**

- Solution: Use `tsc --emitDeclarationOnly --declaration`
- Check `tsconfig.json` has `"declaration": true`

**Umi Max: Build fails after dependency update**

- Solution: Delete `node_modules/.cache` and rebuild
- Check for breaking changes in Umi plugins

## Related Documentation

- [Workspace Structure](./WORKSPACE.md)
- [Workspace Strategy](./BUILD_STRATEGY.md)
- [Sourcemap Strategy](./docs/sourcemap-strategy.md)
- [Worker Architecture](./docs/worker-task-offloading.md)
