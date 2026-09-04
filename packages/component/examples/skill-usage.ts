/**
 * Skill System Usage Examples
 *
 * 展示如何使用 Phase 3 和 Phase 4 的 API
 */

import { defineRegistry, loadScenariosFromURL } from '@rtc-agent/component';

// ============================================
// Phase 3: Function 注册
// ============================================

// 1. 创建 Registry（应用启动时）
const rtcAgent = defineRegistry({
  name: 'MyApp',
  description: '帮助用户管理订单的智能助手',
  persona: '你是一个专业的客服助手，负责帮助用户解决订单相关问题。'
});

// 2. 注册单个 Function
rtcAgent.register({
  name: 'user.register',
  description: '注册新用户',
  parameters: [
    { name: 'email', schema: { type: 'string', description: '用户邮箱' }, required: true },
    { name: 'password', schema: { type: 'string', description: '密码（至少 8 位）' }, required: true },
    { name: 'name', schema: { type: 'string', description: '用户姓名' }, required: false }
  ],
  returns: { schema: { type: 'object', description: '用户信息，包含 id 和 email' } },
  hooks: {
    onStart: (params) => {
      console.log('开始注册用户:', params.email);
    },
    onSuccess: (result) => {
      console.log('注册成功:', result);
    },
    onError: (error) => {
      console.error('注册失败:', error);
    }
  },
  handler: async (params) => {
    // 实际业务逻辑
    const response = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return response.json();
  }
});

// 3. 创建 FunctionGroup（批量注册）
const orderGroup = rtcAgent.createGroup({
  name: 'order',
  description: '订单管理'
});

orderGroup.register({
  name: 'create',
  description: '创建新订单',
  parameters: [
    { name: 'productId', schema: { type: 'string', description: '产品 ID' }, required: true },
    { name: 'quantity', schema: { type: 'number', description: '数量' }, required: true },
    { name: 'address', schema: { type: 'object', description: '收货地址' }, required: true }
  ],
  returns: { schema: { type: 'object', description: '订单信息' } },
  handler: async (params) => {
    const response = await fetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    return response.json();
  }
});

orderGroup.register({
  name: 'cancel',
  description: '取消订单',
  parameters: [
    { name: 'orderId', schema: { type: 'string', description: '订单 ID' }, required: true },
    { name: 'reason', schema: { type: 'string', description: '取消原因' }, required: false }
  ],
  handler: async (params) => {
    const response = await fetch(`/api/orders/${params.orderId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: params.reason })
    });
    return response.json();
  }
});

// 4. 链式调用（宿主应用内部使用）
async function exampleUsage() {
  // 方式 1：通过 Proxy 链式调用
  const result1 = await rtcAgent.order.create({
    productId: 'prod_123',
    quantity: 2,
    address: { city: 'Beijing', street: '...' }
  });

  // 方式 2：通过 execute 方法
  const result2 = await rtcAgent.execute('order.cancel', {
    orderId: 'order_456',
    reason: '不想要了'
  });

  console.log(result1, result2);
}

// ============================================
// Phase 4: Scenario 加载
// ============================================

// 方式 1：从 URL 加载（推荐）
async function loadMyScenarios() {
  // 假设你的服务器上有以下结构：
  // /scenarios/
  //   ├── manifest.json
  //   ├── register-flow.md
  //   └── payment-error.md

  const count = await loadScenariosFromURL('/scenarios/');
  console.log(`Loaded ${count} scenarios`);
}

// 方式 2：手动写入
async function writeCustomScenario() {
  await rtcAgent.writeScenario({
    title: '用户注册流程',
    content: `
# 用户注册流程

## 业务背景

当新用户访问应用时，需要引导他们完成注册流程。

## 步骤

1. 用户点击"注册"按钮
2. 调用 \`user.register\` Function
3. 发送验证邮件
4. 用户点击验证链接
5. 调用 \`user.verifyEmail\` Function

## 注意事项

- 密码必须包含至少 8 个字符
- 邮箱格式必须符合 RFC 5322
- 注册成功后自动登录
`,
    tags: ['onboarding', 'authentication']
  });
}

// ============================================
// 完整的初始化示例
// ============================================

async function initializeApp() {
  // 1. Registry 已在上面创建

  // 2. 注册 Functions
  // ... (见上面的示例)

  // 3. 加载 Scenarios
  await loadMyScenarios();

  // 4. 现在虚拟文件系统已包含：
  // /AGENT.md - 系统入口（包含 persona + 索引）
  // /functions/
  //   ├── INDEX.md
  //   ├── user/
  //   │   └── register.md
  //   └── order/
  //       ├── create.md
  //       └── cancel.md
  // /scenarios/
  //   ├── INDEX.md
  //   └── *.md

  console.log('Skill system initialized!');
}

// 导出示例函数
export { exampleUsage, loadMyScenarios, writeCustomScenario, initializeApp };
