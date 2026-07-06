export type User = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  department: string;
  role: string;
  parentId?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};
