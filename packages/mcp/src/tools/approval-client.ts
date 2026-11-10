import type { AuthContext } from "../auth.js";
import { apiJson, type ApiResult } from "./api-client.js";

export type ApprovalApiResult = ApiResult;

/**
 * Delegates approve/reject to the existing REST routes so verification
 * acknowledgement, approval-chain dedupe, status transitions and
 * notifications stay in one place.
 */
export async function callApprovalApi(
  auth: AuthContext,
  reportId: string,
  action: "approve" | "reject",
  body: Record<string, unknown>,
): Promise<ApprovalApiResult> {
  return apiJson(
    auth,
    "POST",
    `/approvals/${encodeURIComponent(reportId)}/${action}`,
    body,
  );
}
