import * as Minio from 'minio';
import * as crypto from 'crypto';
import type { IFileStorage } from '@sse/core';

export class MinioStorage implements IFileStorage {
  private client: Minio.Client;

  constructor(config?: { endpoint?: string; port?: number; accessKey?: string; secretKey?: string }) {
    this.client = new Minio.Client({
      endPoint: config?.endpoint || process.env.MINIO_ENDPOINT || 'localhost',
      port: config?.port || Number(process.env.MINIO_PORT) || 9002,
      useSSL: false,
      accessKey: config?.accessKey || process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: config?.secretKey || process.env.MINIO_SECRET_KEY || 'minioadmin',
    });
  }

  async upload(key: string, bucket: string, data: Buffer, contentType: string): Promise<void> {
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket);
    }
    await this.client.putObject(bucket, key, data, data.length, { 'Content-Type': contentType });
  }

  async getSignedUrl(key: string, bucket: string, expiresInSeconds: number = 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expiresInSeconds);
  }

  async getObject(key: string, bucket: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
