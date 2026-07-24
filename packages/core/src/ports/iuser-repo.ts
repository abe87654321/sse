import type { User } from '@sse/shared';

export interface IUserRepo {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findDeptApprovers(department: string): Promise<User[]>;
  findByRole(role: string, department?: string): Promise<User[]>;
  findAll(): Promise<User[]>;
}
