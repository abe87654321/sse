export const GRAPH_COLORS: Record<string, string> = {
  Person: '#e878b0',
  Department: '#5898e0',
  Company: '#88c040',
  ExpenseReport: '#48b8a8',
  Report: '#48b8a8',
  DraftReport: '#48b8a8',
  PendingReport: '#48b8a8',
  ApprovedReport: '#48b8a8',
  RejectedReport: '#e87870',
  PaidReport: '#88c040',
  ExpenseItem: '#e8c820',
  ExpenseCategory: '#d08a2c',
  Invoice: '#e87870',
  MissingInvoiceFlag: '#c0392b',
  ApprovalRule: '#c080e0',
  ApprovalRecord: '#48b0c8',
  Approver: '#48b0c8',
  PaymentReceipt: '#88c040',
  Unknown: '#999',
}

export const GRAPH_SHAPES: Record<string, string> = {
  Person: 'dot',
  Department: 'diamond',
  Company: 'hexagon',
  ExpenseReport: 'dot',
  Report: 'dot',
  ExpenseItem: 'box',
  ExpenseCategory: 'square',
  Invoice: 'star',
  MissingInvoiceFlag: 'triangle',
  ApprovalRule: 'square',
  ApprovalRecord: 'dot',
  Approver: 'dot',
  PaymentReceipt: 'hexagon',
  Unknown: 'dot',
}

export const GRAPH_TYPE_LABELS: Record<string, string> = {
  Person: '人员',
  Department: '部门',
  Company: '公司',
  ExpenseReport: '报销单',
  Report: '报销单',
  DraftReport: '草稿报销单',
  PendingReport: '待审批报销单',
  ApprovedReport: '已通过报销单',
  RejectedReport: '已驳回报销单',
  PaidReport: '已打款报销单',
  ExpenseItem: '费用明细',
  ExpenseCategory: '费用类别',
  Invoice: '发票',
  MissingInvoiceReport: '缺发票报销单',
  MissingInvoiceFlag: '缺发票',
  ApprovalRule: '审批规则',
  ApprovalRecord: '审批记录',
  Approver: '审批人',
  PaymentReceipt: '打款回单',
  Unknown: '未知',
}

export const DEFAULT_LEGEND_TYPES = [
  'Person',
  'Department',
  'Company',
  'ExpenseReport',
  'ExpenseItem',
  'ExpenseCategory',
  'Invoice',
  'MissingInvoiceFlag',
  'ApprovalRule',
  'ApprovalRecord',
  'PaymentReceipt',
  'Unknown',
]

export interface GraphLegendItem {
  type: string
  label: string
  color: string
  shape: string
}

const LEGEND_ORDER = new Map(DEFAULT_LEGEND_TYPES.map((type, index) => [type, index]))

/** Builds legend entries from the types present, falling back to the core set. */
export function graphLegendItems(types: string[]): GraphLegendItem[] {
  const present = [...new Set(types.filter((type) => typeof type === 'string' && type.trim() !== ''))]
  const selected = present.length > 0 ? present : DEFAULT_LEGEND_TYPES
  return [...selected]
    .sort(
      (a, b) =>
        (LEGEND_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (LEGEND_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    )
    .map((type) => ({
      type,
      label: GRAPH_TYPE_LABELS[type] ?? type,
      color: GRAPH_COLORS[type] ?? GRAPH_COLORS.Unknown,
      shape: GRAPH_SHAPES[type] ?? 'dot',
    }))
}
