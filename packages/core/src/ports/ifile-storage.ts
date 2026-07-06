export interface IFileStorage {
  upload(key: string, bucket: string, data: Buffer, contentType: string): Promise<void>;
  getSignedUrl(key: string, bucket: string, expiresInSeconds: number): Promise<string>;
  getObject(key: string, bucket: string): Promise<Buffer>;
  calculateChecksum(data: Buffer): string;
}
