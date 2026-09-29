import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Force bundle dexie + microdiff to prevent version conflicts with host applications.
  // tsup externalizes package.json `dependencies` by default; noExternal overrides that.
  noExternal: ['dexie', 'microdiff'],
  // Workspace siblings (they have their own dist) and @babel/* (too heavy, unlikely browser conflict)
  external: [
    '@rtc-agent/client',
    '@rtc-agent/protocol',
    '@babel/core',
    '@babel/preset-typescript',
  ],
  shims: false,
  target: 'es2022',
});
