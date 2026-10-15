#!/usr/bin/env tsx
/**
 * Check i18n translation completeness and quality across all supported locales.
 *
 * Performs three levels of validation:
 * 1. Key existence: Compare every locale against en-US (the reference)
 * 2. Empty values: Detect translations that exist but are empty strings
 * 3. Placeholder consistency: Ensure {0}, {1}, etc. match between source and target
 *
 * Exits with code 1 if any inconsistency is detected, making it suitable for CI pipelines.
 *
 * Usage:
 *   pnpm run i18n:check
 *   npx tsx scripts/check-i18n-coverage.ts
 */

const LOCALES = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'fa-IR',
  'id-ID',
  'bn-BD',
] as const;

const BASE_LOCALE = 'en-US';

/**
 * Recursively collect all dot-separated key paths from an object.
 * Nested objects are flattened: { a: { b: 'x' } } → ['a.b']
 * Only string-valued leaves are counted as keys.
 */
function getKeys(obj: unknown, prefix = ''): string[] {
  const keys: string[] = [];
  if (!obj || typeof obj !== 'object') return keys;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Recursively collect all key-value pairs from an object.
 */
function getEntries(
  obj: unknown,
  prefix = '',
): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  if (!obj || typeof obj !== 'object') return entries;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      entries.push(...getEntries(value, fullKey));
    } else if (typeof value === 'string') {
      entries.push({ key: fullKey, value });
    }
  }
  return entries;
}

/**
 * Extract placeholders from text.
 * Matches patterns like: {0}, {1}, {variableName}
 */
function extractPlaceholders(text: string): string[] {
  const placeholders: string[] = [];
  const pattern = /\{[^}]+\}/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    placeholders.push(match[0]);
  }
  return placeholders;
}

async function main() {
  // Store full locale data (not just keys) for quality checks
  const localeData = new Map<string, Map<string, string>>();
  const localeKeys = new Map<string, Set<string>>();

  // Load all locales
  for (const locale of LOCALES) {
    const mod = await import(`../src/locales/${locale}`);
    const entries = getEntries(mod.default);
    const dataMap = new Map<string, string>();
    const keySet = new Set<string>();
    for (const { key, value } of entries) {
      dataMap.set(key, value);
      keySet.add(key);
    }
    localeData.set(locale, dataMap);
    localeKeys.set(locale, keySet);
  }

  const baseKeys = localeKeys.get(BASE_LOCALE);
  if (!baseKeys) {
    console.error(`Base locale ${BASE_LOCALE} not found`);
    process.exit(1);
  }

  let hasErrors = false;

  // Check 1: Key existence (missing/extra keys)
  for (const locale of LOCALES) {
    if (locale === BASE_LOCALE) continue;
    const keys = localeKeys.get(locale);
    if (!keys) continue;

    const missing = [...baseKeys].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !baseKeys.has(k)).sort();

    if (missing.length > 0) {
      hasErrors = true;
      console.error(
        `\n[${locale}] Missing ${missing.length} key(s) vs ${BASE_LOCALE}:`,
      );
      for (const k of missing) {
        console.error(`  - ${k}`);
      }
    }

    if (extra.length > 0) {
      hasErrors = true;
      console.error(
        `\n[${locale}] Has ${extra.length} extra key(s) not in ${BASE_LOCALE}:`,
      );
      for (const k of extra) {
        console.error(`  + ${k}`);
      }
    }
  }

  // Check 2: Empty values
  console.log('\n--- Empty value check ---');
  let emptyCount = 0;
  for (const locale of LOCALES) {
    const data = localeData.get(locale);
    if (!data) continue;

    const emptyKeys: string[] = [];
    for (const [key, value] of data.entries()) {
      if (value.trim() === '') {
        emptyKeys.push(key);
      }
    }

    if (emptyKeys.length > 0) {
      hasErrors = true;
      emptyCount += emptyKeys.length;
      console.error(
        `\n[${locale}] Empty translation(s) found (${emptyKeys.length}):`,
      );
      for (const k of emptyKeys.sort()) {
        console.error(`  - ${k}`);
      }
    }
  }
  if (emptyCount === 0) {
    console.log('No empty translations found');
  }

  // Check 3: Placeholder consistency (compare against base locale)
  console.log('\n--- Placeholder consistency check ---');
  let placeholderMismatchCount = 0;
  const baseData = localeData.get(BASE_LOCALE);
  if (!baseData) {
    console.error(`Base locale data not found`);
    process.exit(1);
  }

  for (const locale of LOCALES) {
    if (locale === BASE_LOCALE) continue;
    const data = localeData.get(locale);
    if (!data) continue;

    const mismatches: Array<{
      key: string;
      sourcePlaceholders: string[];
      targetPlaceholders: string[];
    }> = [];

    for (const [key, baseValue] of baseData.entries()) {
      const targetValue = data.get(key);
      if (!targetValue) continue; // Already caught by missing key check

      const sourcePlaceholders = extractPlaceholders(baseValue);
      const targetPlaceholders = extractPlaceholders(targetValue);

      // Check if placeholder sets match (order-independent)
      const sourceSet = new Set(sourcePlaceholders);
      const targetSet = new Set(targetPlaceholders);

      if (sourceSet.size !== targetSet.size) {
        mismatches.push({ key, sourcePlaceholders, targetPlaceholders });
      } else {
        // Check if all source placeholders exist in target
        for (const ph of sourceSet) {
          if (!targetSet.has(ph)) {
            mismatches.push({ key, sourcePlaceholders, targetPlaceholders });
            break;
          }
        }
      }
    }

    if (mismatches.length > 0) {
      hasErrors = true;
      placeholderMismatchCount += mismatches.length;
      console.error(
        `\n[${locale}] Placeholder mismatch(es) found (${mismatches.length}):`,
      );
      for (const m of mismatches.slice(0, 10)) {
        // Limit output
        console.error(
          `  - ${m.key}: source=[${m.sourcePlaceholders.join(', ')}] target=[${m.targetPlaceholders.join(', ')}]`,
        );
      }
      if (mismatches.length > 10) {
        console.error(`  ... and ${mismatches.length - 10} more`);
      }
    }
  }
  if (placeholderMismatchCount === 0) {
    console.log('No placeholder mismatches found');
  }

  // Summary
  console.log(`\n--- i18n coverage summary ---`);
  console.log(`Base locale (${BASE_LOCALE}): ${baseKeys.size} keys`);
  for (const locale of LOCALES) {
    if (locale === BASE_LOCALE) continue;
    const keys = localeKeys.get(locale);
    if (!keys) continue;
    const coverage = (
      ([...baseKeys].filter((k) => keys.has(k)).length / baseKeys.size) *
      100
    ).toFixed(1);
    console.log(`${locale}: ${keys.size} keys (${coverage}% coverage)`);
  }

  if (hasErrors) {
    console.error(
      '\n❌ i18n quality check failed. Please fix the errors above.',
    );
    process.exit(1);
  }

  console.log('\n✅ All locales are complete and consistent!');
}

main().catch((err) => {
  console.error('Failed to check i18n coverage:', err);
  process.exit(1);
});
