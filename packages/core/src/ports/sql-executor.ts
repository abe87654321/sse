export interface SqlExecutor {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
}
