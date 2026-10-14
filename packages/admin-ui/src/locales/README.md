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
