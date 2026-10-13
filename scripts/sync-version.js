#!/usr/bin/env node

/**
 * Version Alignment Script
 *
 * This script ensures all @rtc-agent/* packages have the same version.
 * It should be run locally before publishing to ensure consistency.
 *
 * Usage:
 *   node scripts/sync-version.js <version>
 *
 * Example:
 *   node scripts/sync-version.js 0.1.0-rc.2
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version) {
  console.error('❌ Error: Version argument required');
  console.error('Usage: node scripts/sync-version.js <version>');
  console.error('Example: node scripts/sync-version.js 0.1.0-rc.2');
  process.exit(1);
}

// Validate version format
const versionRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;
if (!versionRegex.test(version)) {
  console.error(`❌ Error: Invalid version format: ${version}`);
  console.error('Expected format: X.Y.Z or X.Y.Z-tag');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const pkgsDir = path.join(root, 'packages');

console.log(`🔄 Syncing version to ${version} across all @rtc-agent/* packages...\n`);

const updatedPackages = [];
let hasChanges = false;

for (const dir of fs.readdirSync(pkgsDir)) {
  const pkgPath = path.join(pkgsDir, dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.name || !pkg.name.startsWith('@rtc-agent/')) continue;

  const prev = pkg.version;
  if (prev === version) {
    console.log(`  ✓ ${pkg.name}: already at ${version}`);
    continue;
  }

  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  ✓ ${pkg.name}: ${prev} → ${version}`);
  updatedPackages.push(pkg.name);
  hasChanges = true;
}

console.log('');

if (hasChanges) {
  console.log(`✅ Successfully updated ${updatedPackages.length} package(s)`);
  console.log('\n📝 Next steps:');
  console.log('  1. Review the changes: git diff');
  console.log('  2. Commit: git commit -am "chore: sync version to ' + version + '"');
  console.log('  3. Create tag: git tag v' + version);
  console.log('  4. Push: git push && git push --tags');
} else {
  console.log('✅ All packages are already at the target version');
}
