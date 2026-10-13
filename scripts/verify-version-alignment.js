#!/usr/bin/env node

/**
 * Version Verification Script
 *
 * This script verifies that all @rtc-agent/* packages have the same version.
 * It's designed for CI/CD pipelines to ensure version consistency before publishing.
 *
 * Usage:
 *   node scripts/verify-version-alignment.js [expected-version]
 *
 * Arguments:
 *   expected-version - Optional. If provided, verifies all packages match this version.
 *
 * Exit codes:
 *   0 - All versions are aligned (and match expected-version if provided)
 *   1 - Versions are not aligned or error occurred
 */

const fs = require('fs');
const path = require('path');

const expectedVersion = process.argv[2];
const root = path.resolve(__dirname, '..');
const pkgsDir = path.join(root, 'packages');

console.log('🔍 Verifying version alignment across all @rtc-agent/* packages...\n');

const versions = new Map();
const packages = [];

for (const dir of fs.readdirSync(pkgsDir)) {
  const pkgPath = path.join(pkgsDir, dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.name || !pkg.name.startsWith('@rtc-agent/')) continue;

  packages.push(pkg.name);
  versions.set(pkg.name, pkg.version);
}

if (packages.length === 0) {
  console.error('❌ Error: No @rtc-agent/* packages found');
  process.exit(1);
}

// Group packages by version
const versionGroups = new Map();
for (const [pkgName, version] of versions) {
  if (!versionGroups.has(version)) {
    versionGroups.set(version, []);
  }
  versionGroups.get(version).push(pkgName);
}

console.log('Package versions:');
for (const [pkgName, version] of versions) {
  console.log(`  ${pkgName}: ${version}`);
}
console.log('');

if (versionGroups.size !== 1) {
  console.error('❌ Error: Versions are not aligned!');
  console.error('\nVersion groups:');
  for (const [version, pkgs] of versionGroups) {
    console.error(`\n  Version ${version}:`);
    for (const pkg of pkgs) {
      console.error(`    - ${pkg}`);
    }
  }
  console.error('\n💡 To fix this, run locally:');
  console.error('   node scripts/sync-version.js <target-version>');
  console.error('   git commit -am "chore: sync version to <target-version>"');
  console.error('   git push');
  process.exit(1);
}

const actualVersion = Array.from(versionGroups.keys())[0];
console.log(`✅ All ${packages.length} packages are aligned at version ${actualVersion}`);

if (expectedVersion) {
  if (actualVersion !== expectedVersion) {
    console.error(`\n❌ Error: Version mismatch!`);
    console.error(`   Expected: ${expectedVersion}`);
    console.error(`   Actual:   ${actualVersion}`);
    console.error('\n💡 To fix this, run locally:');
    console.error(`   node scripts/sync-version.js ${expectedVersion}`);
    console.error(`   git commit -am "chore: sync version to ${expectedVersion}"`);
    console.error('   git push');
    process.exit(1);
  }
  console.log(`✅ Version matches expected: ${expectedVersion}`);
}

process.exit(0);
