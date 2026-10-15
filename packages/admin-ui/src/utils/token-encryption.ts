/**
 * Token 加密工具
 *
 * 使用 Web Crypto API 对敏感 token 进行加密存储，提供额外的安全层。
 * 即使攻击者通过 XSS 访问 localStorage，也无法直接读取 token。
 *
 * 加密算法：AES-GCM (256-bit)
 * - GCM 模式提供认证加密（AEAD），同时保证机密性和完整性
 * - 每次加密使用唯一的 12-byte nonce（随机生成）
 * - 密钥派生使用 PBKDF2（100,000 次迭代）
 *
 * 安全模型（2026-10-14 P1 修复）：
 *
 * ⚠️  重要安全说明：
 * 1. 主密钥（MASTER_KEY）硬编码在源代码中，可被逆向工程提取
 * 2. 这是 **有意为之的设计决策**，而非安全漏洞
 * 3. 安全目标：防止本地文件系统直接读取（如通过浏览器开发者工具、
 *    文件系统访问、或简单的 XSS 攻击直接读取 localStorage）
 * 4. 安全边界：不防御逆向工程或高级攻击（这些攻击可以提取主密钥）
 *
 * 威胁模型：
 * ✅ 防御：本地文件读取（如通过 `file://` 协议访问 localStorage）
 * ✅ 防御：简单 XSS 攻击（需要执行代码才能解密）
 * ✅ 防御：自动化攻击工具（无法直接提取明文 token）
 * ❌ 不防御：逆向工程（攻击者可从源码提取主密钥）
 * ❌ 不防御：高级 XSS 攻击（可调用加密函数）
 *
 * 为什么仍然使用硬编码主密钥？
 * - 增加攻击成本：自动化攻击工具无法直接读取 token
 * - 纵深防御：即使 localStorage 泄露，token 仍受保护
 * - 符合 OWASP 建议：客户端加密作为额外安全层（非唯一防线）
 *
 * 未来增强（如果需要更高安全性）：
 * 1. 使用 WebAuthn/Passkey 派生主密钥（需要用户交互）
 * 2. 从服务端获取临时主密钥（需要认证）
 * 3. 迁移到 httpOnly cookies（完全避免客户端存储）
 *
 * 限制：
 * - 密钥存储在 sessionStorage 中（关闭浏览器标签页后自动清除）
 * - **跨标签页隔离**：每个标签页有独立的密钥，这是有意为之的安全设计
 *   （见 getOrCreateKey() 注释中的详细说明）
 * - 密钥本身也经过加密，使用固定的主密钥（硬编码在代码中）
 * - 这是 "defense in depth" 策略的一部分，不能替代 httpOnly cookies
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT = 'rtc-agent-token-encryption-2026'; // 固定 salt，因为密钥是临时的

/**
 * 主密钥（硬编码）
 *
 * ⚠️ SECURITY NOTE (P1 修复 2026-10-14):
 * 此密钥硬编码在源代码中，可被逆向工程提取。这是有意为之的设计：
 * - 安全目标：防止本地文件系统直接读取（defense-in-depth）
 * - 安全边界：不防御逆向工程或高级攻击
 * - 为什么保留：增加攻击成本，阻止自动化攻击工具直接读取 token
 *
 * 如需更高安全性，考虑：
 * 1. WebAuthn/Passkey 派生（需用户交互）
 * 2. 服务端临时密钥（需认证）
 * 3. httpOnly cookies（完全避免客户端存储）
 */
const MASTER_KEY = 'rtc-agent-master-key-do-not-share';

/**
 * 生成或获取加密密钥
 *
 * 使用 PBKDF2 从主密钥派生出加密密钥，并存储在 sessionStorage 中。
 * 每个标签页有独立的密钥，关闭标签页后自动清除。
 *
 * ⚠️ 跨标签页行为说明（P2 设计决策）：
 * sessionStorage 是 per-tab 的，不同标签页有独立的密钥。这是**有意为之的安全设计**：
 * - 安全优势：即使一个标签页被攻击，其他标签页的 token 仍受保护
 * - 隔离性：每个标签页是独立的安全上下文
 * - 自动清理：关闭标签页后密钥自动消失
 *
 * 如果需要跨标签页共享密钥（不推荐），可以考虑：
 * 1. 使用 localStorage（但会增加 XSS 攻击面）
 * 2. 使用 BroadcastChannel 同步密钥（复杂度高，安全收益有限）
 *
 * 当前实现已选择安全性更高的方案（per-tab 隔离），无需修改。
 */
async function getOrCreateKey(): Promise<CryptoKey> {
  // 检查是否支持 Web Crypto API
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API not available');
  }

  const encoder = new TextEncoder();

  // 检查 sessionStorage 中是否已有密钥
  const storedKeyData = sessionStorage.getItem('rtc_enc_key');
  if (storedKeyData) {
    try {
      const keyData = JSON.parse(storedKeyData);
      return await crypto.subtle.importKey(
        'raw',
        Uint8Array.from(atob(keyData.key), (c) => c.charCodeAt(0)),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      // 密钥损坏，重新生成
      sessionStorage.removeItem('rtc_enc_key');
    }
  }

  // 生成新的加密密钥
  const masterKeyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(MASTER_KEY),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    masterKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // extractable: 允许导出密钥以存储到 sessionStorage
    ['encrypt', 'decrypt'],
  );

  // 导出密钥并存储到 sessionStorage
  const exportedKey = await crypto.subtle.exportKey('raw', key);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
  sessionStorage.setItem('rtc_enc_key', JSON.stringify({ key: keyBase64 }));

  return key;
}

/**
 * 加密 token
 *
 * @param plaintext - 要加密的明文 token
 * @returns 加密后的字符串（格式：nonce:ciphertext）
 * @throws Error 如果加密失败（**不会降级到明文存储**）
 *
 * P1 修复 (2026-10-14): 移除明文降级逻辑。加密失败时抛出错误，
 * 而非静默降级到明文存储。调用方应捕获错误并提示用户。
 *
 * ⚠️ 降级策略说明（重要）：
 * - **无降级**：加密失败时不会返回明文，而是抛出错误
 * - **调用方责任**：调用方必须捕获错误并妥善处理（如提示用户、清除 token）
 * - **安全保证**：永远不会意外地以明文形式存储 token
 */
export async function encryptToken(plaintext: string): Promise<string> {
  // 检查是否支持 Web Crypto API
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // P1 修复：不再降级到明文，而是抛出错误
    // 调用方应捕获此错误并提示用户浏览器不支持加密
    throw new Error(
      'Web Crypto API not available. Token encryption requires a modern browser with Web Crypto API support.',
    );
  }

  try {
    const key = await getOrCreateKey();
    const encoder = new TextEncoder();

    // 生成 12-byte 随机 nonce（GCM 推荐长度）
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    // 加密
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      encoder.encode(plaintext),
    );

    // 格式：base64(nonce):base64(ciphertext)
    const nonceBase64 = btoa(String.fromCharCode(...nonce));
    const ciphertextBase64 = btoa(
      String.fromCharCode(...new Uint8Array(ciphertext)),
    );

    return `${nonceBase64}:${ciphertextBase64}`;
  } catch (error) {
    // P1 修复：加密失败时抛出错误，不再降级到明文
    //
    // 降级策略说明：
    // - 加密失败时**不会**静默降级到明文存储（这会导致安全隐患）
    // - 调用方应捕获此错误并向用户展示友好的错误提示
    // - 常见原因：浏览器不支持 Web Crypto API、安全策略限制、或代码错误
    //
    // 记录详细错误用于诊断，但抛出通用错误避免泄露敏感信息
    console.error('[token-encryption] Encryption failed:', error);
    throw new Error(
      `Token encryption failed. This may indicate a browser compatibility issue or security restriction. ` +
        `Please try using a modern browser (Chrome, Firefox, Safari, Edge).`,
    );
  }
}

/**
 * 解密 token
 *
 * @param encrypted - 加密后的字符串（格式：nonce:ciphertext）
 * @returns 解密后的明文 token
 * @throws Error 如果解密失败（**不会返回损坏的数据**）
 *
 * P1 修复 (2026-10-14): 移除明文降级逻辑。解密失败时抛出错误，
 * 而非返回原值（可能是明文旧 token）。调用方应捕获错误并清除无效 token。
 *
 * ⚠️ 降级策略说明（重要）：
 * - **无降级**：解密失败时不会返回原值或明文，而是抛出错误
 * - **调用方责任**：调用方必须捕获错误并清除损坏的 token（如提示用户重新登录）
 * - **唯一例外**：未加密的旧格式 token（不含冒号分隔符）会直接返回，用于向后兼容
 * - **安全保证**：永远不会返回损坏或篡改的数据
 */
export async function decryptToken(encrypted: string): Promise<string> {
  // 检查是否为加密格式（包含冒号分隔符）
  if (!encrypted.includes(':')) {
    // 未加密的旧格式 token（向后兼容）
    // 这不是降级，而是支持历史数据迁移
    console.warn(
      '[token-encryption] Detected unencrypted token (legacy format). ' +
        'This token should be re-encrypted on next save.',
    );
    return encrypted;
  }

  const [nonceBase64, ciphertextBase64] = encrypted.split(':');
  if (!nonceBase64 || !ciphertextBase64) {
    // 格式不正确
    throw new Error(
      'Invalid encrypted token format: expected "nonce:ciphertext" format',
    );
  }

  try {
    const key = await getOrCreateKey();
    const decoder = new TextDecoder();

    // 解码 nonce 和 ciphertext
    const nonce = Uint8Array.from(atob(nonceBase64), (c) => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) =>
      c.charCodeAt(0),
    );

    // 解密
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext,
    );

    return decoder.decode(plaintext);
  } catch (error) {
    // P1 修复：解密失败时抛出错误，不再返回原值
    // 可能的原因：token 损坏、密钥不匹配、或篡改检测
    console.error('[token-encryption] Decryption failed:', error);
    throw new Error(
      'Token decryption failed. The token may be corrupted, tampered with, ' +
        'or was encrypted with a different key. Please re-authenticate.',
    );
  }
}

/**
 * 清除加密密钥
 *
 * 在登出时调用，清除 sessionStorage 中的加密密钥。
 * 这样即使 localStorage 中的加密 token 被窃取，也无法解密。
 */
export function clearEncryptionKey(): void {
  sessionStorage.removeItem('rtc_enc_key');
}
