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

import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, writeFileSync } from 'fs';
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

  // Detect Vite
  if (allDeps?.vite) {
    return 'vite';
  }

  // Detect SvelteKit (uses Vite internally)
  if (allDeps?.['@sveltejs/kit']) {
    return 'sveltekit';
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
    case 'vite':
    case 'sveltekit':
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

  // Find and copy shared-worker files
  const distFiles = readdirSync(sourceDir);
  const workerFiles = distFiles.filter(f => f.startsWith('shared-worker') && f.endsWith('.js'));

  if (workerFiles.length === 0) {
    console.warn('⚠️  Warning: No shared-worker files found in dist/assets');
    console.log('   Available files:', distFiles.join(', '));
    return 0;
  }

  let copiedCount = 0;
  let mainWorkerFile = null;

  for (const file of workerFiles) {
    const sourcePath = join(sourceDir, file);
    const targetPath = join(targetDir, file);
    copyFileSync(sourcePath, targetPath);
    console.log(`✅ Copied ${file} → ${targetDir}`);
    copiedCount++;

    // Track the main worker file (without .map or other extensions)
    if (file.endsWith('.js') && !file.includes('.map')) {
      mainWorkerFile = file;
    }
  }

  // Create a stable symlink or copy without hash for easy reference
  if (mainWorkerFile && mainWorkerFile !== 'shared-worker.js') {
    const stablePath = join(targetDir, 'shared-worker.js');
    copyFileSync(join(targetDir, mainWorkerFile), stablePath);
    console.log(`✅ Created stable link: shared-worker.js → ${mainWorkerFile}`);
  }

  // Create manifest.json with version info
  const packageJsonPath = join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  const manifest = {
    version: packageJson.version,
    workerFile: mainWorkerFile,
    stableWorkerUrl: '/rtc-agent/shared-worker.js',
    timestamp: new Date().toISOString(),
  };

  writeFileSync(
    join(targetDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`✅ Created manifest.json (version ${packageJson.version})`);

  return copiedCount;
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
