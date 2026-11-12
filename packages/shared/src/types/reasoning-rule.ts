export interface ReasoningRule {
  id: string;
  name: string;
  description?: string;
  conditions: Array<{ subject: string; predicate: string; object: string }>;
  conclusion: { subject: string; predicate: string; object: string };
  priority: number;
  isActive: boolean;
  constructQuery?: string | null;
  severity?: string;
  message?: string | null;
}
