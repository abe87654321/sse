export interface IFileStorage {
  upload(key: string, bucket: string, data: Buffer, contentType: string): Promise<void>;
  getObject(key: string, bucket: string): Promise<Buffer>;
  calculateChecksum(data: Buffer): string;
}
