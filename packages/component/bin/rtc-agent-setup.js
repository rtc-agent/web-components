#!/usr/bin/env node

/**
 * RTC Agent SharedWorker Setup Tool
 *
 * Automatically copies the SharedWorker file to the host application's public directory.
 * This solves the NPM distribution problem where the worker file inside node_modules
 * cannot be accessed by the browser.
 *
 * Usage:
 *   npx rtc-agent-setup
 *
 * Or in package.json:
 *   "scripts": {
 *     "postinstall": "rtc-agent-setup"
 *   }
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect project type based on dependencies
 */
function detectProjectType(cwd) {
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Detect SvelteKit first (more specific, also uses Vite)
  if (allDeps?.['@sveltejs/kit']) {
    return 'sveltekit';
  }

  // Detect Vite (generic)
  if (allDeps?.vite) {
    return 'vite';
  }

  // Detect Webpack
  if (allDeps?.webpack) {
    return 'webpack';
  }

  return 'generic';
}

/**
 * Get target directory based on project type
 */
function getTargetDir(projectType, cwd) {
  switch (projectType) {
    case 'sveltekit':
      // SvelteKit uses 'static' directory for static assets
      return join(cwd, 'static', 'rtc-agent');
    case 'vite':
      // Plain Vite projects typically use 'public' directory
      return join(cwd, 'public', 'rtc-agent');
    case 'webpack':
      return join(cwd, 'static', 'rtc-agent');
    default:
      return join(cwd, 'public', 'rtc-agent');
  }
}

/**
 * Copy SharedWorker files to target directory
 */
function copyWorkerFiles(targetDir) {
  const sourceDir = join(__dirname, '..', 'dist', 'assets');

  if (!existsSync(sourceDir)) {
    console.error('❌ Error: Cannot find @rtc-agent/component dist files');
    console.error('   Please ensure the package is built correctly');
    process.exit(1);
  }

  // Create target directory
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
    console.log(`📁 Created directory: ${targetDir}`);
  }

  // Clean up old hashed worker files
  const existingFiles = existsSync(targetDir) ? readdirSync(targetDir) : [];
  const oldWorkerFiles = existingFiles.filter(
    f => f.startsWith('shared-worker-') && f.endsWith('.js') && f !== 'shared-worker.js'
  );

  for (const oldFile of oldWorkerFiles) {
    const oldPath = join(targetDir, oldFile);
    try {
      unlinkSync(oldPath);
      console.log(`🗑️  Removed old: ${oldFile}`);
    } catch (err) {
      console.warn(`⚠️  Could not remove ${oldFile}: ${err.message}`);
    }
  }

  // Find the main worker file in dist
  const distFiles = readdirSync(sourceDir);
  const workerFiles = distFiles.filter(f => f.startsWith('shared-worker') && f.endsWith('.js'));

  if (workerFiles.length === 0) {
    console.warn('⚠️  Warning: No shared-worker files found in dist/assets');
    console.log('   Available files:', distFiles.join(', '));
    return 0;
  }

  // Find the hashed worker file
  const hashedWorkerFile = workerFiles.find(f => f !== 'shared-worker.js' && f.match(/shared-worker-[A-Za-z0-9]+\.js/));

  if (!hashedWorkerFile) {
    console.warn('⚠️  Warning: No hashed worker file found');
    return 0;
  }

  // Copy as shared-worker.js (stable name, no hash)
  const sourcePath = join(sourceDir, hashedWorkerFile);
  const targetPath = join(targetDir, 'shared-worker.js');
  copyFileSync(sourcePath, targetPath);
  console.log(`✅ Copied ${hashedWorkerFile} → shared-worker.js`);

  // Create manifest.json with version info
  const packageJsonPath = join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  const manifest = {
    version: packageJson.version,
    workerFile: 'shared-worker.js',
    stableWorkerUrl: '/rtc-agent/shared-worker.js',
    timestamp: new Date().toISOString(),
  };

  writeFileSync(
    join(targetDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`✅ Created manifest.json (version ${packageJson.version})`);

  return 1;
}

/**
 * Main entry point
 */
async function main() {
  console.log('🔧 RTC Agent SharedWorker Setup\n');

  const cwd = process.cwd();
  const projectType = detectProjectType(cwd);

  if (!projectType) {
    console.error('❌ Error: No package.json found in current directory');
    process.exit(1);
  }

  console.log(`📦 Detected project type: ${projectType}`);

  const targetDir = getTargetDir(projectType, cwd);
  console.log(`📂 Target directory: ${targetDir}\n`);

  const copiedFiles = copyWorkerFiles(targetDir);

  if (copiedFiles > 0) {
    console.log('\n✅ Setup complete!');
    console.log('\nNext steps:');
    console.log('  1. SharedWorker files are now available in your public directory');
    console.log('  2. Configure createRtcAgent() to use the worker:');
    console.log('     createRtcAgent({');
    console.log('       workerUrl: \'/rtc-agent/shared-worker.js\'');
    console.log('     })');
    console.log('  3. When upgrading @rtc-agent/component, run:');
    console.log('     npx rtc-agent-setup');
    console.log('     This will update the worker files and manifest.json');
  } else {
    console.log('\n⚠️  Setup completed with warnings');
    console.log('   Please check if @rtc-agent/component is installed correctly');
  }
}

main().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
