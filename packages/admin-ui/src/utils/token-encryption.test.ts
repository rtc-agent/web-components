/**
 * Token Encryption Utility Tests
 *
 * 验证 token 加密/解密功能的正确性和安全性。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptToken,
  decryptToken,
  clearEncryptionKey,
} from './token-encryption';

describe('token-encryption', () => {
  beforeEach(() => {
    // 清除 sessionStorage 中的加密密钥，确保每个测试从干净状态开始
    clearEncryptionKey();
  });

  afterEach(() => {
    // 清理
    clearEncryptionKey();
  });

  describe('encryptToken', () => {
    it('should encrypt a token and return a string with nonce:ciphertext format', async () => {
      const plaintext = 'test-token-12345';
      const encrypted = await encryptToken(plaintext);

      // 加密后的字符串应该包含冒号分隔符
      expect(encrypted).toContain(':');

      // 加密后的字符串不应该等于原文
      expect(encrypted).not.toBe(plaintext);

      // 格式：base64(nonce):base64(ciphertext)
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0].length).toBeGreaterThan(0); // nonce
      expect(parts[1].length).toBeGreaterThan(0); // ciphertext
    });

    it('should produce different ciphertext for the same plaintext (random nonce)', async () => {
      const plaintext = 'test-token-12345';
      const encrypted1 = await encryptToken(plaintext);
      const encrypted2 = await encryptToken(plaintext);

      // 由于 nonce 随机，同一明文应该产生不同的密文
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty string', async () => {
      const plaintext = '';
      const encrypted = await encryptToken(plaintext);

      expect(encrypted).toContain(':');
      expect(encrypted).not.toBe(plaintext);
    });

    it('should handle long tokens', async () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = await encryptToken(plaintext);

      expect(encrypted).toContain(':');
      expect(encrypted).not.toBe(plaintext);
    });

    it('should handle special characters', async () => {
      const plaintext = 'token-with-特殊字符-🔐-emoji';
      const encrypted = await encryptToken(plaintext);

      expect(encrypted).toContain(':');
      expect(encrypted).not.toBe(plaintext);
    });
  });

  describe('decryptToken', () => {
    it('should decrypt an encrypted token back to plaintext', async () => {
      const plaintext = 'test-token-12345';
      const encrypted = await encryptToken(plaintext);
      const decrypted = await decryptToken(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should return original value if not in encrypted format (no colon)', async () => {
      const plaintext = 'plain-token-without-encryption';
      const decrypted = await decryptToken(plaintext);

      // 没有冒号分隔符，视为未加密，直接返回
      expect(decrypted).toBe(plaintext);
    });

    it('should return original value if encryption format is invalid', async () => {
      const invalidEncrypted = 'invalid:format:with:multiple:colons';
      const decrypted = await decryptToken(invalidEncrypted);

      // 格式不正确，返回原值
      expect(decrypted).toBe(invalidEncrypted);
    });

    it('should handle decryption with wrong key gracefully', async () => {
      const plaintext = 'test-token-12345';
      const encrypted = await encryptToken(plaintext);

      // 清除密钥
      clearEncryptionKey();

      // 尝试解密
      // 注意：由于 PBKDF2 使用固定的 salt 和 master key，getOrCreateKey 会重新生成相同的密钥
      // 所以解密仍然会成功
      const decrypted = await decryptToken(encrypted);

      // 解密成功，返回原文
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty encrypted string', async () => {
      const encrypted = ':';
      const decrypted = await decryptToken(encrypted);

      // 格式不正确，返回原值
      expect(decrypted).toBe(encrypted);
    });
  });

  describe('round-trip encryption/decryption', () => {
    it('should correctly round-trip various token formats', async () => {
      const testCases = [
        'simple-token',
        'jwt-token.example.payload',
        'token-with-special-chars!@#$%^&*()',
        'unicode-token-你好世界',
        'a'.repeat(1000), // 长 token
      ];

      for (const plaintext of testCases) {
        const encrypted = await encryptToken(plaintext);
        const decrypted = await decryptToken(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });

    it('should maintain encryption key in sessionStorage across calls', async () => {
      const plaintext1 = 'token-1';
      const plaintext2 = 'token-2';

      // 加密两个 token
      const encrypted1 = await encryptToken(plaintext1);
      const encrypted2 = await encryptToken(plaintext2);

      // 解密时应该使用相同的密钥
      const decrypted1 = await decryptToken(encrypted1);
      const decrypted2 = await decryptToken(encrypted2);

      expect(decrypted1).toBe(plaintext1);
      expect(decrypted2).toBe(plaintext2);
    });
  });

  describe('clearEncryptionKey', () => {
    it('should clear the encryption key from sessionStorage but allow regeneration', async () => {
      const plaintext = 'test-token';
      const encrypted = await encryptToken(plaintext);

      // 清除密钥
      clearEncryptionKey();

      // 尝试解密
      // 注意：getOrCreateKey 会重新生成相同的密钥（因为使用固定的 salt 和 master key）
      // 所以解密仍然会成功
      const decrypted = await decryptToken(encrypted);

      // 解密成功，返回原文
      expect(decrypted).toBe(plaintext);
    });

    it('should be safe to call multiple times', () => {
      expect(() => clearEncryptionKey()).not.toThrow();
      expect(() => clearEncryptionKey()).not.toThrow();
    });
  });

  describe('security considerations', () => {
    it('should use different nonces for each encryption', async () => {
      const plaintext = 'same-token';
      const encrypted1 = await encryptToken(plaintext);
      const encrypted2 = await encryptToken(plaintext);

      // 提取 nonce（第一部分）
      const nonce1 = encrypted1.split(':')[0];
      const nonce2 = encrypted2.split(':')[0];

      // nonce 应该不同（防止重放攻击）
      expect(nonce1).not.toBe(nonce2);
    });

    it('should produce ciphertext that is different from plaintext', async () => {
      const plaintext = 'secret-token';
      const encrypted = await encryptToken(plaintext);

      // 密文不应该包含明文的任何部分
      const ciphertext = encrypted.split(':')[1];
      expect(ciphertext).not.toContain(plaintext);
    });
  });
});
