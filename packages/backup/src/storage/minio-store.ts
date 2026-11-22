import type { Client } from 'minio';

export class MinioBackupStore {
  constructor(
    private readonly client: Client,
    private readonly bucket: string,
    private readonly prefix: string
  ) {}

  private objectKey(id: string): string {
    return `${this.prefix}${id}.tar.gz`;
  }

  async upload(id: string, archivePath: string): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
    await this.client.fPutObject(this.bucket, this.objectKey(id), archivePath, {});
  }

  async download(id: string, archivePath: string): Promise<void> {
    await this.client.fGetObject(this.bucket, this.objectKey(id), archivePath);
  }

  async createReadStream(id: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.bucket, this.objectKey(id));
  }

  async list(): Promise<string[]> {
    const stream = this.client.listObjectsV2(this.bucket, this.prefix, true);
    const ids: string[] = [];
    for await (const item of stream) {
      const match = new RegExp(`^${escapeRegExp(this.prefix)}(.+)\\.tar\\.gz$`).exec(item.name);
      if (match) ids.push(match[1]);
    }
    return ids.sort((a, b) => b.localeCompare(a));
  }

  async delete(id: string): Promise<void> {
    await this.client.removeObject(this.bucket, this.objectKey(id));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
