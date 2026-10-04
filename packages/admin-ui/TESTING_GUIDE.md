# 登录功能测试指南

## 前置条件

确保 admin-server 已启动并创建管理员账号：

```bash
# 1. 启动 Docker 环境
cd server
docker-compose up -d

# 2. 等待服务启动（约 30 秒）
docker-compose ps

# 3. 创建管理员账号
docker exec rtc-full-admin-server ./rtc-agent admin account create \
  --email=admin@example.com \
  --password=admin123456 \
  --name="Admin User"
```

## 测试步骤

### 方式 1：开发环境测试（推荐）

```bash
# 1. 进入 admin-ui 目录
cd web-components/packages/admin-ui

# 2. 启动开发服务器（关闭 Mock，使用真实 API）
npm run dev

# 3. 访问登录页面
open http://localhost:8000/user/login
```

### 方式 2：生产环境测试

```bash
# 1. 构建前端和后端
cd server
bash ../scripts/build-admin-ui.sh
go build -o rtc-agent .

# 2. 启动 admin-server
./rtc-agent admin serve

# 3. 访问登录页面
open http://localhost:8081/login
```

## 登录测试

### 正常登录
1. 访问登录页面
2. 输入邮箱：`admin@example.com`
3. 输入密码：`admin123456`
4. 点击"登录"按钮
5. 预期结果：
   - ✅ 显示"登录成功！"提示
   - ✅ 自动跳转到 Dashboard 页面
   - ✅ 右上角显示用户头像和名称

### 验证 Token 存储

打开浏览器开发者工具（F12），检查 localStorage：

```javascript
// 在 Console 中执行
localStorage.getItem('admin_access_token')
// 应该返回 JWT token 字符串

localStorage.getItem('admin_refresh_token')
// 应该返回 refresh token 字符串

localStorage.getItem('admin_user_info')
// 应该返回 JSON 格式的用户信息
```

### 验证请求拦截器

在 Network 面板中：
1. 刷新页面
2. 查看 `/api/auth/me` 请求
3. 检查 Request Headers
4. 应该包含：`Authorization: Bearer <token>`

### 错误登录测试
1. 输入错误邮箱：`wrong@example.com`
2. 输入错误密码：`wrongpassword`
3. 点击"登录"按钮
4. 预期结果：
   - ✅ 显示"邮箱或密码错误"提示
   - ✅ 表单下方显示红色错误消息
   - ✅ Token 不会被存储

### 登出测试
1. 登录后进入 Dashboard
2. 点击右上角头像
3. 选择"退出登录"
4. 预期结果：
   - ✅ localStorage 中的 token 被清除
   - ✅ 重定向到登录页面
   - ✅ 再次访问 Dashboard 会自动跳转到登录页

### Token 过期测试

手动模拟 token 过期：

```javascript
// 在 Console 中执行
localStorage.setItem('admin_token_expiry', (Date.now() - 1000).toString())
// 设置过期时间为过去 1 秒

// 刷新页面
location.reload()
// 应该自动跳转到登录页面
```

## API 调试

### 使用 curl 测试

```bash
# 1. 登录获取 token
curl -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123456"
  }'

# 响应示例：
# {
#   "access_token": "eyJ...",
#   "refresh_token": "eyJ...",
#   "expires_in": 3600,
#   "token_type": "Bearer",
#   "user": {
#     "id": "uuid",
#     "email": "admin@example.com",
#     "name": "Admin User"
#   }
# }

# 2. 使用 token 访问受保护的 API
TOKEN="<从上面获取的 access_token>"
curl http://localhost:8081/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# 3. 刷新 token
curl -X POST http://localhost:8081/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "<从登录响应中获取>"
  }'
```

### 使用 Postman

1. 创建新请求：`POST http://localhost:8081/api/auth/login`
2. Body → raw → JSON:
   ```json
   {
     "email": "admin@example.com",
     "password": "admin123456"
   }
   ```
3. Send 并保存响应中的 `access_token`
4. 创建新请求：`GET http://localhost:8081/api/auth/me`
5. Headers → `Authorization: Bearer <your_access_token>`
6. Send 并验证用户信息

## 常见问题

### Q: 登录失败，提示"Network Error"
**A**: 检查 admin-server 是否启动，端口 8081 是否可访问

### Q: 登录成功后跳转到 Dashboard，但显示空白
**A**: 清除浏览器缓存，或按 Ctrl+Shift+R 强制刷新

### Q: Token 没有存储到 localStorage
**A**: 检查浏览器是否禁用了 localStorage，或使用了隐私模式

### Q: 刷新页面后自动跳转到登录页
**A**: 检查 token 是否过期，或 localStorage 是否被清除

### Q: 开发环境下 API 请求 404
**A**: 检查 `config/proxy.ts` 配置，确保 `/api/*` 代理到 `http://localhost:8081`

## 日志查看

### 前端日志
浏览器 Console 面板查看错误信息

### 后端日志
```bash
# Docker 环境
docker logs rtc-full-admin-server -f

# 本地环境
./rtc-agent admin serve
# 日志直接输出到终端
```

## 成功标准

✅ 所有测试通过  
✅ Token 正确存储到 localStorage  
✅ 请求拦截器正确添加 Authorization header  
✅ 401 错误自动清除 token 并重定向  
✅ 登出功能正常清除所有认证信息  

---

**测试日期**: ___________  
**测试人员**: ___________  
**测试结果**: ☐ 通过  ☐ 失败
