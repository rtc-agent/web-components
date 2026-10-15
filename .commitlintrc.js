/**
 * Unified commitlint configuration for RTC Agent workspace.
 *
 * Enforces Conventional Commits specification across all packages.
 * See: https://www.conventionalcommits.org/
 *
 * Note: admin-ui package inherits from this config. Individual packages
 * should NOT override these rules unless there's a specific, documented reason.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce consistent scope usage (optional but recommended)
    'scope-case': [2, 'always', 'kebab-case'],
    'scope-empty': [1, 'never'], // Warn if scope is empty (encourage scoping)

    // Subject formatting
    'subject-case': [2, 'always', 'sentence-case'],
    'subject-full-stop': [2, 'never', '.'],

    // Type enforcement
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation only
        'style',    // Code style (formatting, no logic change)
        'refactor', // Refactoring (no feature/bug fix)
        'perf',     // Performance improvement
        'test',     // Adding/fixing tests
        'build',    // Build system or dependencies
        'ci',       // CI/CD configuration
        'chore',    // Other changes (no production code change)
        'revert',   // Reverting commits
      ],
    ],
  },
};
