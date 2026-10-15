/**
 * Commitlint configuration for admin-ui package.
 *
 * Extends the workspace root configuration to ensure consistency.
 * admin-ui uses Umi Max (Ant Design Pro) but follows the same commit
 * conventions as other packages in the monorepo.
 *
 * Note: Husky is configured at the workspace root (.husky/), so this
 * config is primarily for documentation. The root commitlint config
 * applies to all packages.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
