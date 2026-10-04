# RTC Agent Admin UI

基于 Ant Design Pro v6.0.3 的 RTC Agent 管理后台。

## ✨ 特性

- 🔐 **真实登录认证** - 使用 JWT Token，支持 localStorage 存储
- 🎨 **现代 UI** - Ant Design Pro v6 + React 19 + Ant Design 6
- 🚀 **TypeScript** - 完整的类型定义
- 📱 **响应式** - 适配桌面和移动设备
- 🌍 **国际化** - 支持多语言
- 🔌 **RTC Agent 集成** - 内置 RTC Agent Web 组件依赖

## 🚀 快速开始

### 开发环境

```bash
# 1. 安装依赖
cd web-components
pnpm install

# 2. 启动 admin-server（另一个终端）
cd server
docker-compose up -d

# 3. 创建管理员账号
docker exec rtc-full-admin-server ./rtc-agent admin account create \
  --email=admin@example.com \
  --password=admin123456

# 4. 启动前端开发服务器
cd web-components/packages/admin-ui
npm run dev  # 使用真实 API
# 或
npm start    # 使用 Mock 数据

# 5. 访问
open http://localhost:8000
```

### 生产环境

```bash
# 1. 构建前端
cd server
bash ../scripts/build-admin-ui.sh

# 2. 构建 Go 二进制
go build -o rtc-agent .

# 3. 启动服务
./rtc-agent admin serve

# 4. 访问
open http://localhost:8081
```

## 📖 文档

- [集成完成报告](./INTEGRATION_COMPLETE.md) - 详细的实现说明
- [测试指南](./TESTING_GUIDE.md) - 登录功能测试步骤

## 🔧 命令

```bash
# 开发
npm start              # 启动开发服务器（带 Mock）
npm run dev            # 启动开发服务器（真实 API）

# 构建
npm run build          # 生产构建
npm run analyze        # 构建并分析包大小

# 代码质量
npm run lint           # 运行 lint（Biome + TypeScript）
npm run biome          # 自动修复代码格式
npm run tsc            # 仅运行类型检查

# 测试
npm run test           # 运行测试
npm run test:watch     # 监听模式运行测试
```

## 🏗️ 架构

```
src/
├── services/
│   ├── admin-auth.ts          # 真正的登录 API
│   └── ant-design-pro/        # Mock API（自动生成）
├── utils/
│   └── auth-storage.ts        # JWT 存储管理
├── app.tsx                    # 应用配置
├── requestErrorConfig.ts      # 请求拦截器
└── pages/
    └── user/login/            # 登录页面
```

## 🔐 认证流程

1. 用户输入邮箱和密码
2. 调用 `/api/auth/login` API
3. 服务器返回 JWT Token
4. 前端存储到 localStorage
5. 后续请求自动携带 `Authorization: Bearer <token>`
6. 401 错误自动清除 Token 并重定向登录页

## 📝 环境变量

开发环境需要配置代理：

```typescript
// config/proxy.ts
export default {
  dev: {
    '/api/': {
      target: 'http://localhost:8081',  // admin-server 地址
      changeOrigin: true,
    },
  },
};
```

## 🎯 Mock 策略

- **登录功能**：使用真实 API（admin-server）
- **其他功能**：使用 Ant Design Pro 的 Mock 系统
- 开发时通过 `npm start`（Mock）或 `npm run dev`（真实 API）切换

## 🐛 常见问题

### Q: 登录失败，提示"Network Error"
检查 admin-server 是否启动，端口 8081 是否可访问。

### Q: 构建时报 TypeScript 错误
运行 `npm run tsc` 查看详细错误信息。

### Q: 开发服务器启动慢
使用 `npm start` 会启用 Mock，启动更快。

## 📚 参考

- [Ant Design Pro 文档](https://pro.ant.design/)
- [Umi Max 文档](https://umijs.org/docs/max/introduce)
- [Ant Design 文档](https://ant.design/)

## 📄 许可证

MIT License
