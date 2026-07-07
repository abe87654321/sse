export type ExpenseReport = {
  id: string;
  serialNo: string;
  userId: string;
  title: string;
  totalAmount: number;
  description?: string;
  status: string;
  currentStep: number;
  submittedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
