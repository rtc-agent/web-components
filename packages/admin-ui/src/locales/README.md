# Translation Key Naming Convention

## Standard Format

Use **dot-separated + camelCase** naming convention:

```typescript
// Correct
'pages.module.section.keyName': 'Translation text'
'pages.rtcUsers.detail.viewDetail': 'View Detail'
'pages.config.system.editTitle': 'Edit Config: '

// Incorrect - avoid these styles
'pages.module_section_key-name': 'Translation text'  // snake_case + kebab-case
'pages.Module.Section.KeyName': 'Translation text'    // PascalCase
'pages.module-section.key-name': 'Translation text'   // kebab-case
```

## Structure Guidelines

### Hierarchical Organization

Keys should follow a logical hierarchy:

1. **Top-level category**: `pages`, `error`, `common`, `dashboard`
2. **Module/feature name**: `rtcUsers`, `config.system`, `roles`
3. **Sub-section** (optional): `detail`, `conflict`, `form`
4. **Specific key**: camelCase identifier

### Examples by Category

#### Page-specific Keys

```typescript
// Format: pages.<module>.<section>.<keyName>
'pages.rtcUsers.title': 'RTC User List'
'pages.rtcUsers.detail.devices': 'Devices'
'pages.config.system.editTitle': 'Edit Config: '
'pages.config.user.drawerTitle': 'User Configs: '
```

#### Error Messages

```typescript
// Format: error.<descriptiveName>
'error.userNotFound': 'User not found'
'error.configKeyNotFound': 'Config key not found'
```

#### Common/Shared Keys

```typescript
// Format: common.<keyName>
'common.loading': 'Loading...'
'common.confirm': 'Confirm'
'common.cancel': 'Cancel'
```

## Best Practices

1. **Be descriptive**: Key names should clearly indicate their purpose
2. **Use camelCase**: For the final segment of the key
3. **Group related keys**: Keep similar translations together in the hierarchy
4. **Avoid abbreviations**: Use full words unless universally understood (e.g., `userId` not `usrId`)
5. **Consistent naming**: Use the same term across the application (e.g., always `createdAt` not sometimes `created_at`)

## File Organization

Each locale directory (`zh-CN`, `en-US`, etc.) contains:

- `pages.ts` - Page-specific translations
- `menu.ts` - Navigation menu items
- `component.ts` - Shared component translations
- `settings.ts` - Settings-related translations
- `network.ts` - Network/API error messages
- `globalHeader.ts` - Header component translations
- `settingDrawer.ts` - Settings drawer translations

## Adding New Translations

When adding new translation keys:

1. **Check existing keys**: Avoid duplicates
2. **Follow the hierarchy**: Place in the appropriate category
3. **Update all locales**: Add translations for all supported languages
4. **Use defaultMessage**: Always provide a fallback in the code

```typescript
// In component
intl.formatMessage({
  id: 'pages.myModule.newKey',
  defaultMessage: 'Default English text',
})

// In en-US/pages.ts
'pages.myModule.newKey': 'Default English text',

// In zh-CN/pages.ts
'pages.myModule.newKey': '中文翻译文本',
```

## Common Mistakes to Avoid

```typescript
// ❌ Inconsistent naming
'pages.user-config.title'        // kebab-case
'pages.userConfig.title'         // camelCase (preferred)
'pages.user_config.title'        // snake_case

// ❌ Missing hierarchy
'pages.title'                    // too generic
'pages.rtcUsers.title'           // better

// ❌ Abbreviations
'pages.cfg.sys.title'           // unclear
'pages.config.system.title'     // clear
```

## Key Organization Strategy

### Feature-Based Organization

Group translation keys by feature/module to improve discoverability and maintainability:

```typescript
// ✅ Good: Feature-based hierarchy
'pages.rtcUsers.list.title': 'RTC Users'
'pages.rtcUsers.list.searchPlaceholder': 'Search users...'
'pages.rtcUsers.detail.title': 'User Detail'
'pages.rtcUsers.detail.devices': 'Devices'

// ❌ Avoid: Scattered keys without clear grouping
'pages.users.title': '...'
'pages.rtcUsersList.search': '...'
'pages.userDetail.devices': '...'
```

### Shared vs Page-Specific Keys

- **Shared keys** (`common.*`, `menu.*`, `component.*`): Used across multiple pages
- **Page-specific keys** (`pages.<module>.*`): Only used within a specific page/module

```typescript
// Shared: reusable across the app
'common.confirm': 'Confirm'
'common.cancel': 'Cancel'

// Page-specific: only used in RTC Users module
'pages.rtcUsers.list.title': 'RTC Users'
```

### When to Create New Keys

1. **New UI element**: Button, label, placeholder, error message
2. **User-facing text**: Anything the user sees (except icons/brand names)
3. **Error messages**: Validation errors, API errors, system errors

### When NOT to Create New Keys

1. **Developer-only text**: Debug messages, console logs
2. **Dynamic content**: User-generated content, data from API
3. **Brand names**: Product names, company names (unless localized)

## Usage Best Practices

### When to Use `defaultMessage`

Always provide a `defaultMessage` in the code when using `useIntl().formatMessage()`. This serves as:

1. **Fallback**: Displayed if the key is missing from locale files
2. **Documentation**: Makes the purpose of the translation clear
3. **Development aid**: Allows the app to work even before translations are added

```typescript
// Good - has descriptive fallback
intl.formatMessage({
  id: 'pages.rtcUsers.ban.confirm',
  defaultMessage: 'Are you sure you want to ban this user?',
})

// Bad - no fallback, unclear purpose
intl.formatMessage({ id: 'some.key' })

// Bad - generic fallback doesn't help
intl.formatMessage({
  id: 'pages.rtcUsers.ban.confirm',
  defaultMessage: 'Confirm',
})
```

**Exception**: When the translation is purely cosmetic (e.g., decorative text), `defaultMessage` can be minimal.

### Handling Dynamic Parameters

Use ICU message syntax for dynamic values. Parameters are wrapped in `{paramName}`.

```typescript
// In locale file
'pages.user.greeting': 'Hello, {name}!',
'pages.items.count': '{count, plural, =0 {No items} one {# item} other {# items}}',

// In component
intl.formatMessage(
  { id: 'pages.user.greeting' },
  { name: currentUser.name }
)

intl.formatMessage(
  { id: 'pages.items.count' },
  { count: selectedItems.length }
)
```

**Important**: If your translation contains `${variable}` syntax (e.g., `'Released ${count} tokens'`), add a biome-ignore comment to suppress the false-positive lint warning:

```typescript
// biome-ignore lint/suspicious/noTemplateCurlyInString: i18n placeholder
'pages.messages.detail.releasedTokens': 'Released ${count} tokens',
```

### Step-by-Step: Adding New Translations

When adding a new feature or UI element:

1. **Define the key** following the naming convention (see above)
2. **Add to all locale files** — at minimum `en-US` and `zh-CN`
3. **Use the key in code** with a descriptive `defaultMessage`
4. **Run coverage check**: `pnpm run i18n:check`

```typescript
// Step 1: Add to en-US/pages.ts
'pages.myFeature.newButton': 'Click Me',

// Step 2: Add to zh-CN/pages.ts
'pages.myFeature.newButton': '点击我',

// Step 3: Use in component
<Button>
  {intl.formatMessage({
    id: 'pages.myFeature.newButton',
    defaultMessage: 'Click Me',
  })}
</Button>

// Step 4: Verify coverage
pnpm run i18n:check
```

**Tip**: Use the i18n-remove script (`scripts/i18n-remove.js`) to find and remove unused translation keys.

### Common Pitfalls

1. **Hardcoded strings**: Always extract user-facing text to locale files
2. **String concatenation**: Use parameters instead of concatenating translations
3. **Missing pluralization**: Use ICU plural syntax for countable items
4. **Inconsistent terminology**: Use the same term across the app (e.g., always "Delete" not sometimes "Remove")

```typescript
// Bad - concatenation breaks in other languages
intl.formatMessage({ id: 'greeting' }) + ' ' + userName

// Good - use parameter substitution
intl.formatMessage(
  { id: 'greeting.withName' },
  { name: userName }
)
```
