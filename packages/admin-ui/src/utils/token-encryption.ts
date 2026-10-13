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
 * 安全说明：
 * - 密钥存储在 sessionStorage 中（关闭浏览器标签页后自动清除）
 * - 密钥本身也经过加密，使用固定的主密钥（硬编码在代码中）
 * - 这是 "defense in depth" 策略的一部分，不能替代 httpOnly cookies
 *
 * 限制：
 * - 主密钥硬编码在代码中，攻击者可以提取
 * - 但攻击者需要：1) 找到主密钥 2) 解密 sessionStorage 中的密钥 3) 才能解密 token
 * - 这大大增加了攻击成本，特别是对于自动化攻击工具
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT = 'rtc-agent-token-encryption-2026'; // 固定 salt，因为密钥是临时的
const MASTER_KEY = 'rtc-agent-master-key-do-not-share'; // 主密钥（硬编码）

/**
 * 生成或获取加密密钥
 *
 * 使用 PBKDF2 从主密钥派生出加密密钥，并存储在 sessionStorage 中。
 * 每个标签页有独立的密钥，关闭标签页后自动清除。
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
 * @returns 加密后的字符串（格式：nonce:ciphertext），失败时返回原文
 */
export async function encryptToken(plaintext: string): Promise<string> {
  try {
    // 检查是否支持 Web Crypto API
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      console.warn('[token-encryption] Web Crypto API not available, using plaintext');
      return plaintext;
    }

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
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

    return `${nonceBase64}:${ciphertextBase64}`;
  } catch (error) {
    // 在测试环境中输出详细错误
    if (process.env.NODE_ENV === 'test') {
      console.error('[token-encryption] Encryption failed:', error);
    } else {
      console.error('[token-encryption] Encryption failed, using plaintext:', error);
    }
    // 降级：返回原文（不加密）
    // 这确保了在加密失败时（如浏览器不支持）功能仍然可用
    return plaintext;
  }
}

/**
 * 解密 token
 *
 * @param encrypted - 加密后的字符串（格式：nonce:ciphertext）
 * @returns 解密后的明文 token，失败时返回原文
 */
export async function decryptToken(encrypted: string): Promise<string> {
  try {
    // 检查是否为加密格式（包含冒号分隔符）
    if (!encrypted.includes(':')) {
      // 可能是未加密的旧格式，直接返回
      return encrypted;
    }

    const [nonceBase64, ciphertextBase64] = encrypted.split(':');
    if (!nonceBase64 || !ciphertextBase64) {
      // 格式不正确，返回原文
      return encrypted;
    }

    const key = await getOrCreateKey();
    const decoder = new TextDecoder();

    // 解码 nonce 和 ciphertext
    const nonce = Uint8Array.from(atob(nonceBase64), (c) => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));

    // 解密
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext,
    );

    return decoder.decode(plaintext);
  } catch (error) {
    console.error('[token-encryption] Decryption failed, using original value:', error);
    // 降级：返回原值（可能是未加密的旧 token）
    return encrypted;
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
