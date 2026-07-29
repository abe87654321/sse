import type { User } from '@sse/shared';

export interface IUserRepo {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findDeptApprovers(department: string): Promise<User[]>;
  findByRole(role: string, department?: string): Promise<User[]>;
  findAll(): Promise<User[]>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
  cascadeDelete(id: string): Promise<void>;
  updateAvatar(id: string, avatarUrl: string): Promise<void>;
  getRelatedDataCount(id: string): Promise<number>;
}
