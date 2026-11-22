import { Client } from 'minio';

export interface MinioObject {
  key: string;
  size: number;
}

export interface ObjectSource {
  listObjects(bucket: string): Promise<MinioObject[]>;
  getObject(bucket: string, key: string): Promise<Buffer>;
}

export interface ObjectStore {
  listObjects(bucket: string): Promise<MinioObject[]>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  putObject(bucket: string, key: string, data: Buffer): Promise<void>;
  removePrefix(bucket: string, prefix: string): Promise<void>;
}

export function createMinioClient(config: {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}): Client {
  return new Client(config);
}

export function minioObjectStore(client: Client): ObjectStore {
  return {
    async listObjects(bucket: string): Promise<MinioObject[]> {
      const stream = client.listObjectsV2(bucket, '', true);
      const objects: MinioObject[] = [];
      for await (const item of stream) {
        objects.push({ key: item.name, size: Number(item.size ?? 0) });
      }
      return objects;
    },
    async getObject(bucket: string, key: string): Promise<Buffer> {
      const stream = await client.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },
    async putObject(bucket: string, key: string, data: Buffer): Promise<void> {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
      await client.putObject(bucket, key, data, data.length);
    },
    async removePrefix(bucket: string, prefix: string): Promise<void> {
      if (!prefix) return;
      const stream = client.listObjectsV2(bucket, prefix, true);
      const names: string[] = [];
      for await (const item of stream) names.push(item.name);
      if (names.length > 0) await client.removeObjects(bucket, names);
    },
  };
}
