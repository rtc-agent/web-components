#!/usr/bin/env tsx
/**
 * XLIFF Translation Quality Checker
 *
 * Validates XLIFF translation files for completeness and quality:
 * 1. All <trans-unit> elements have <target> tags
 * 2. No empty <target> elements
 * 3. Placeholder consistency between source and target (e.g., {0}, {1}, ${var})
 *
 * Usage:
 *   pnpm run i18n:validate-xliff
 *   npx tsx scripts/check-xliff-quality.ts
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const XLIFF_DIR = path.join(__dirname, '../xliff');

interface ValidationResult {
  file: string;
  errors: string[];
  warnings: string[];
}

/**
 * Extract placeholders from text.
 * Matches patterns like: {0}, {1}, ${varName}, <x id="..."/>
 */
function extractPlaceholders(text: string): string[] {
  const placeholders: string[] = [];

  // Match {0}, {1}, {variableName}
  const bracePattern = /\{[^}]+\}/g;
  let match;
  while ((match = bracePattern.exec(text)) !== null) {
    placeholders.push(match[0]);
  }

  // Match ${variableName} (template literal placeholders)
  const templatePattern = /\$\{[^}]+\}/g;
  while ((match = templatePattern.exec(text)) !== null) {
    placeholders.push(match[0]);
  }

  // Match <x id="..."/> (lit-localize interpolation markers)
  const xPattern = /<x id="([^"]+)"/g;
  while ((match = xPattern.exec(text)) !== null) {
    placeholders.push(`<x id="${match[1]}"/>`);
  }

  return placeholders;
}

/**
 * Validate a single XLIFF file
 */
function validateXliffFile(filePath: string): ValidationResult {
  const result: ValidationResult = {
    file: path.basename(filePath),
    errors: [],
    warnings: [],
  };

  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse trans-units
  const transUnitPattern =
    /<trans-unit id="([^"]+)">\s*<source>([\s\S]*?)<\/source>\s*(?:<target>([\s\S]*?)<\/target>)?/g;

  let match;
  let unitCount = 0;

  while ((match = transUnitPattern.exec(content)) !== null) {
    unitCount++;
    const [, id, source, target] = match;

    // Check 1: Missing target tag
    if (target === undefined) {
      result.errors.push(
        `Trans-unit "${id}": Missing <target> tag`,
      );
      continue;
    }

    // Check 2: Empty target
    const trimmedTarget = target.trim();
    if (trimmedTarget === '') {
      result.errors.push(
        `Trans-unit "${id}": Empty <target> content`,
      );
      continue;
    }

    // Check 3: Placeholder consistency
    const sourcePlaceholders = extractPlaceholders(source);
    const targetPlaceholders = extractPlaceholders(target);

    if (sourcePlaceholders.length !== targetPlaceholders.length) {
      result.warnings.push(
        `Trans-unit "${id}": Placeholder count mismatch ` +
          `(source: ${sourcePlaceholders.length}, target: ${targetPlaceholders.length})`,
      );
    } else {
      // Check if placeholders match (order matters)
      const mismatchedPlaceholders = sourcePlaceholders.filter(
        (ph, idx) => ph !== targetPlaceholders[idx],
      );
      if (mismatchedPlaceholders.length > 0) {
        result.warnings.push(
          `Trans-unit "${id}": Placeholder mismatch - ` +
            `source: [${sourcePlaceholders.join(', ')}], ` +
            `target: [${targetPlaceholders.join(', ')}]`,
        );
      }
    }
  }

  result.warnings.unshift(`Total trans-units: ${unitCount}`);

  return result;
}

async function main(): Promise<void> {
  console.log('XLIFF Translation Quality Checker\n');
  console.log(`Scanning directory: ${XLIFF_DIR}\n`);

  if (!fs.existsSync(XLIFF_DIR)) {
    console.error(`Error: XLIFF directory not found: ${XLIFF_DIR}`);
    process.exit(1);
  }

  const xliffFiles = fs
    .readdirSync(XLIFF_DIR)
    .filter((f) => f.endsWith('.xlf'))
    .map((f) => path.join(XLIFF_DIR, f));

  if (xliffFiles.length === 0) {
    console.log('No XLIFF files found.');
    return;
  }

  console.log(`Found ${xliffFiles.length} XLIFF file(s)\n`);

  let hasErrors = false;
  const results: ValidationResult[] = [];

  for (const filePath of xliffFiles) {
    const result = validateXliffFile(filePath);
    results.push(result);

    if (result.errors.length > 0) {
      hasErrors = true;
    }
  }

  // Print results
  for (const result of results) {
    console.log(`\n=== ${result.file} ===`);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings (${result.warnings.length}):`);
      for (const warning of result.warnings) {
        console.log(`  ${warning}`);
      }
    }

    if (result.errors.length > 0) {
      console.error(`\nErrors (${result.errors.length}):`);
      for (const error of result.errors) {
        console.error(`  ${error}`);
      }
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('  OK - All validations passed');
    }
  }

  // Summary
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  console.log(`\n--- Summary ---`);
  console.log(`Files checked: ${xliffFiles.length}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);

  if (hasErrors) {
    console.error(
      '\nXLIFF validation failed. Please fix the errors above.',
    );
    process.exit(1);
  }

  console.log('\nXLIFF validation passed!');
}

main().catch((err) => {
  console.error('Failed to validate XLIFF files:', err);
  process.exit(1);
});
