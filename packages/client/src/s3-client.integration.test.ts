// S3 Client 集成测试（需要真实服务）
// 运行方式：REFRESH_TOKEN=xxx pnpm test:integration

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { S3Client } from './s3-client.js';

/**
 * 生成一个随机的 32 位十六进制字符串（符合 MD5 格式要求）
 */
function generateMd5LikeHash(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 跳过条件：没有 REFRESH_TOKEN 环境变量
const describeIntegration = process.env.REFRESH_TOKEN
  ? describe
  : describe.skip;

/**
 * 从 JWT 中解析 user_id
 */
function parseUserIdFromJwt(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = JSON.parse(atob(parts[1]));
  return payload.user_id;
}

/**
 * 使用 refresh_token 换取 access_token
 */
async function exchangeRefreshToken(refreshToken: string): Promise<{
  access_token: string;
  user_id: string;
}> {
  const serverUrl = process.env.SERVER_URL ?? 'http://localhost:8888';

  const response = await fetch(`${serverUrl}/oauth2/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to exchange refresh token: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  // 从 JWT 解析 user_id
  const user_id = parseUserIdFromJwt(data.access_token);

  return {
    access_token: data.access_token,
    user_id,
  };
}

describeIntegration('S3Client Integration', () => {
  let client: S3Client;
  let userId: string;
  let accessToken: string;

  // 测试用的文件数据
  let testMd5: string;
  const testExt = 'txt';
  const testContent = 'Hello, S3 Integration Test!';

  beforeAll(async () => {
    const refreshToken = process.env.REFRESH_TOKEN!;
    const tokens = await exchangeRefreshToken(refreshToken);

    accessToken = tokens.access_token;
    userId = tokens.user_id;
    testMd5 = generateMd5LikeHash();

    client = new S3Client({
      serverUrl: process.env.SERVER_URL ?? 'http://localhost:8888',
      getToken: () => accessToken,
    });
  });

  afterAll(() => {
    client.dispose();
  });

  describe('基本操作', () => {
    it('should upload and download a small file', async () => {
      const blob = new Blob([testContent], { type: 'text/plain' });

      // 上传
      await client.upload(userId, testMd5, testExt, blob, {
        contentType: 'text/plain',
      });

      // 下载
      const downloaded = await client.download(userId, testMd5, testExt);
      const text = await downloaded.text();

      expect(text).toBe(testContent);
    });

    it('should get file metadata', async () => {
      const head = await client.head(userId, testMd5, testExt);

      expect(head.contentLength).toBe(testContent.length);
      expect(head.contentType).toBe('text/plain');
      expect(head.lastModified).toBeInstanceOf(Date);
    });

    it('should list user objects', async () => {
      const result = await client.list(userId);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some(item => item.key.includes(testMd5))).toBe(true);
    });

    it('should delete file', async () => {
      await client.delete(userId, testMd5, testExt);

      // 验证文件已删除
      try {
        await client.head(userId, testMd5, testExt);
        // 如果没抛异常，说明文件还存在
        expect.fail('File should have been deleted');
      } catch (error) {
        // 期望抛异常（404）
        expect(error).toBeDefined();
      }
    });
  });

  describe('大文件上传', () => {
    let largeMd5: string;
    const largeSize = 6 * 1024 * 1024; // 6MB，超过 5MB 分片阈值

    beforeAll(() => {
      largeMd5 = generateMd5LikeHash();
    });

    it('should upload large file with multipart', async () => {
      // 生成大文件内容
      const content = new Uint8Array(largeSize);
      for (let i = 0; i < largeSize; i++) {
        content[i] = i % 256;
      }
      const blob = new Blob([content], { type: 'application/octet-stream' });

      let progressCalled = false;

      // 上传
      await client.upload(userId, largeMd5, 'bin', blob, {
        contentType: 'application/octet-stream',
        onProgress: (loaded, total) => {
          progressCalled = true;
          expect(loaded).toBeLessThanOrEqual(total);
        },
      });

      expect(progressCalled).toBe(true);

      // 验证文件已上传
      const head = await client.head(userId, largeMd5, 'bin');
      expect(head.contentLength).toBe(largeSize);

      // 清理
      await client.delete(userId, largeMd5, 'bin');
    });
  });

  describe('预签名 URL', () => {
    it('should get presigned URL for download', async () => {
      // 先上传一个文件
      const md5 = generateMd5LikeHash();
      const blob = new Blob(['presigned test'], { type: 'text/plain' });
      await client.upload(userId, md5, 'txt', blob);

      // 获取预签名 URL
      const url = await client.getPresignedUrl('get', `user-${userId}/${md5}.txt`);

      expect(url).toContain('http');
      expect(url).toContain(md5);

      // 使用预签名 URL 下载
      const response = await fetch(url);
      expect(response.ok).toBe(true);
      const text = await response.text();
      expect(text).toBe('presigned test');

      // 清理
      await client.delete(userId, md5, 'txt');
    });
  });

  describe('凭证过期场景', () => {
    it('should automatically refresh credentials when expired', async () => {
      // 先执行一次操作，确保凭证已获取
      const md5 = generateMd5LikeHash();
      const blob = new Blob(['test'], { type: 'text/plain' });
      await client.upload(userId, md5, 'txt', blob);

      // 通过类型断言访问私有属性，强制设置凭证过期时间
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = client as any;

      // 将过期时间设置为过去（模拟凭证已过期）
      clientAny.expiresAt = new Date(Date.now() - 1000);

      // 执行操作，应该会自动刷新凭证
      const md52 = generateMd5LikeHash();
      await client.upload(userId, md52, 'txt', blob);

      // 验证凭证已被刷新：过期时间应该被更新为未来的时间
      const newExpiresAt = clientAny.expiresAt as Date;
      expect(newExpiresAt.getTime()).toBeGreaterThan(Date.now());

      // 清理
      await client.delete(userId, md5, 'txt');
      await client.delete(userId, md52, 'txt');
    });

    it('should handle concurrent requests during credential refresh', async () => {
      // 强制凭证过期
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = client as any;
      clientAny.expiresAt = new Date(Date.now() - 1000);

      // 并发发起多个请求
      const blob = new Blob(['concurrent test'], { type: 'text/plain' });
      const hashes = Array.from({ length: 5 }, () => generateMd5LikeHash());

      const uploadPromises = hashes.map(md5 =>
        client.upload(userId, md5, 'txt', blob)
      );

      // 所有请求应该成功完成
      await Promise.all(uploadPromises);

      // 验证所有文件都已上传
      for (const md5 of hashes) {
        const head = await client.head(userId, md5, 'txt');
        expect(head.contentLength).toBe(15); // 'concurrent test' 的长度
        await client.delete(userId, md5, 'txt');
      }
    });

    it('should refresh credentials proactively before expiry', async () => {
      // 强制设置过期时间为 3 分钟后（小于 5 分钟的提前刷新阈值）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientAny = client as any;
      clientAny.expiresAt = new Date(Date.now() + 3 * 60 * 1000);
      const originalCredentials = clientAny.credentials;

      // 执行操作，应该会触发提前刷新
      const md5 = generateMd5LikeHash();
      const blob = new Blob(['proactive refresh test'], { type: 'text/plain' });
      await client.upload(userId, md5, 'txt', blob);

      // 验证凭证已被刷新
      const newCredentials = clientAny.credentials;
      expect(newCredentials).not.toBe(originalCredentials);

      // 清理
      await client.delete(userId, md5, 'txt');
    });
  });
});
