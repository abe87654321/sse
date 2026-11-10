/**
 * OpenAPI 3.1 document for agent-facing REST endpoints.
 *
 * Agents that cannot speak MCP can call `POST /auth/api-key-login` once with
 * their MCP API key, then send the returned JWT as `Authorization: Bearer ...`
 * on every request. The same key/role/department scoping as MCP applies.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const ok = (description: string, schema?: unknown) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
});
const error = (description: string) => ({
  description,
  content: json(ref("Error")),
});

const reportIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const, format: "uuid" },
};

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "SSE - Smart Staff Expense API",
      version: "1.0.0",
      description:
        "Agent-facing REST API for the SSE expense system.\n\n" +
        "Auth flow: call `POST /auth/api-key-login` with your MCP API key " +
        "(`{ \"apiKey\": \"mcp_...\" }`) to obtain `accessToken`, then send " +
        "`Authorization: Bearer <accessToken>` on all other requests. " +
        "Role and department are bound to the key, so data scope is enforced server-side.\n\n" +
        "MCP clients can instead use `POST /mcp` (Streamable HTTP) with the same key.",
    },
    servers: [{ url: process.env.PUBLIC_API_BASE || "/", description: "SSE API" }],
    tags: [
      { name: "Auth" },
      { name: "Expenses" },
      { name: "Approvals" },
      { name: "Verification" },
      { name: "Ontology" },
      { name: "Statistics" },
      { name: "System" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
        ApiKeyLoginRequest: {
          type: "object",
          required: ["apiKey"],
          properties: { apiKey: { type: "string", description: "MCP API key" } },
        },
        ApiKeyLoginResponse: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            user: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                role: { type: "string" },
                department: { type: "string" },
              },
            },
          },
        },
        ExpenseItemInput: {
          type: "object",
          required: ["categoryId", "amount"],
          properties: {
            categoryId: { type: "string", format: "uuid" },
            amount: { type: "number" },
            expenseDate: { type: "string", format: "date" },
            description: { type: "string" },
          },
        },
        CreateExpenseRequest: {
          type: "object",
          required: ["title", "items"],
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              minItems: 1,
              items: ref("ExpenseItemInput"),
            },
          },
        },
        ExpenseReport: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", format: "uuid" },
            serialNo: { type: "string" },
            userId: { type: "string", format: "uuid" },
            applicantName: { type: "string" },
            title: { type: "string" },
            totalAmount: { type: "number" },
            status: {
              type: "string",
              enum: ["draft", "pending", "approved", "rejected", "paid"],
            },
            currentStep: { type: "integer" },
            submittedAt: { type: "string", format: "date-time" },
            completedAt: { type: "string", format: "date-time" },
          },
        },
        ExpenseList: {
          type: "object",
          properties: {
            results: { type: "array", items: ref("ExpenseReport") },
            total: { type: "integer" },
            page: { type: "integer" },
            pageSize: { type: "integer" },
          },
        },
        ExpenseDetail: {
          type: "object",
          additionalProperties: true,
          properties: {
            report: ref("ExpenseReport"),
            items: { type: "array", items: { type: "object", additionalProperties: true } },
            invoices: { type: "array", items: { type: "object", additionalProperties: true } },
            verificationSummary: { type: "object", additionalProperties: true },
            approvalRecords: { type: "array", items: { type: "object", additionalProperties: true } },
            ruleName: { type: "string" },
            viewerActions: { type: "object", additionalProperties: true },
          },
        },
        VerifyRequest: {
          type: "object",
          properties: {
            force: { type: "boolean", description: "Re-run OCR even if a cached result exists" },
          },
        },
        ApproveRequest: {
          type: "object",
          properties: {
            comment: { type: "string" },
            acknowledgeVerification: {
              type: "boolean",
              description: "Required when AI verification reports warning/unverified/error",
            },
          },
        },
        RejectRequest: {
          type: "object",
          required: ["comment"],
          properties: { comment: { type: "string" } },
        },
        ValidateExpenseRequest: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: { type: "number" },
            categoryId: { type: "string", format: "uuid" },
            categoryName: { type: "string" },
          },
        },
        FromInvoiceRequest: {
          type: "object",
          required: ["imageBase64"],
          properties: {
            imageBase64: { type: "string", description: "Base64 of a PDF or image" },
            fileFormat: { type: "string", enum: ["pdf", "image"] },
          },
        },
        SubmitFromTextRequest: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", description: "Natural language expense, e.g. business trip hotel 600 CNY" },
          },
        },
        QueryExpenseStatusRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Natural language status query" },
          },
        },
        SparqlRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "SPARQL SELECT query" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/auth/api-key-login": {
        post: {
          tags: ["Auth"],
          operationId: "apiKeyLogin",
          summary: "Exchange an MCP API key for a JWT access token",
          security: [],
          requestBody: { required: true, content: json(ref("ApiKeyLoginRequest")) },
          responses: {
            "200": ok("JWT issued", ref("ApiKeyLoginResponse")),
            "401": error("Invalid API key"),
            "403": error("API key or user disabled"),
          },
        },
      },
      "/health": {
        get: {
          tags: ["System"],
          operationId: "health",
          summary: "Health check",
          security: [],
          responses: { "200": ok("Service healthy") },
        },
      },
      "/categories": {
        get: {
          tags: ["Expenses"],
          operationId: "listCategories",
          summary: "List expense categories",
          responses: { "200": ok("Category list") },
        },
      },
      "/expenses": {
        get: {
          tags: ["Expenses"],
          operationId: "searchExpenses",
          summary: "Search expense reports (role-scoped)",
          parameters: [
            { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
            { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
            { name: "applicantId", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "applicantName", in: "query", schema: { type: "string" } },
            {
              name: "status",
              in: "query",
              schema: { type: "string", enum: ["draft", "pending", "approved", "rejected", "paid"] },
            },
            { name: "categoryId", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "amountMin", in: "query", schema: { type: "number" } },
            { name: "amountMax", in: "query", schema: { type: "number" } },
            { name: "keyword", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          ],
          responses: {
            "200": ok("Paginated results", ref("ExpenseList")),
            "401": error("Unauthorized"),
          },
        },
        post: {
          tags: ["Expenses"],
          operationId: "createExpense",
          summary: "Create an expense report (draft)",
          requestBody: { required: true, content: json(ref("CreateExpenseRequest")) },
          responses: {
            "201": ok("Created report", ref("ExpenseReport")),
            "400": error("Invalid payload"),
          },
        },
      },
      "/expenses/{id}": {
        get: {
          tags: ["Expenses"],
          operationId: "getExpenseDetail",
          summary: "Get report detail (items, invoices, verification, approvals)",
          parameters: [reportIdParam],
          responses: {
            "200": ok("Report detail", ref("ExpenseDetail")),
            "403": error("No access"),
            "404": error("Report not found"),
          },
        },
      },
      "/expenses/{id}/submit": {
        post: {
          tags: ["Expenses"],
          operationId: "submitExpense",
          summary: "Submit a draft report for approval",
          parameters: [reportIdParam],
          responses: {
            "200": ok("Submitted"),
            "400": error("Invalid state"),
            "403": error("No access"),
          },
        },
      },
      "/expenses/{id}/verify": {
        post: {
          tags: ["Verification"],
          operationId: "verifyExpenseInvoices",
          summary: "Run AI invoice verification (amount/date/number + duplicates)",
          parameters: [reportIdParam],
          requestBody: { content: json(ref("VerifyRequest")) },
          responses: {
            "200": ok("Verification summary"),
            "403": error("No access"),
            "404": error("Report not found"),
          },
        },
      },
      "/expenses/{id}/items/{itemId}/invoice": {
        post: {
          tags: ["Verification"],
          operationId: "uploadInvoice",
          summary: "Attach an invoice file (PDF/OFD) to a report item",
          parameters: [
            reportIdParam,
            {
              name: "itemId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: { file: { type: "string", format: "binary" } },
                },
              },
            },
          },
          responses: {
            "201": ok("Invoice stored"),
            "400": error("Invalid file type/content"),
            "404": error("Report or item not found"),
          },
        },
      },
      "/expenses/validate": {
        post: {
          tags: ["Expenses"],
          operationId: "validateExpense",
          summary: "Check whether an amount/category matches approval rules",
          requestBody: { required: true, content: json(ref("ValidateExpenseRequest")) },
          responses: { "200": ok("Validation result") },
        },
      },
      "/expenses/from-invoice": {
        post: {
          tags: ["Expenses"],
          operationId: "submitExpenseFromInvoice",
          summary: "OCR an invoice and create + submit an expense report",
          requestBody: { required: true, content: json(ref("FromInvoiceRequest")) },
          responses: {
            "200": ok("Created report or business error"),
            "422": error("OCR or extraction failed"),
          },
        },
      },
      "/approvals/pending": {
        get: {
          tags: ["Approvals"],
          operationId: "listPendingApprovals",
          summary: "List pending approval records for the current user",
          responses: { "200": ok("Pending approval records") },
        },
      },
      "/approvals/{reportId}/approve": {
        post: {
          tags: ["Approvals"],
          operationId: "approveExpense",
          summary: "Approve the current step of a report",
          parameters: [
            {
              name: "reportId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: { content: json(ref("ApproveRequest")) },
          responses: {
            "200": ok("Approved / advanced to next step"),
            "409": error("Verification acknowledgement required"),
            "403": error("No access"),
          },
        },
      },
      "/approvals/{reportId}/reject": {
        post: {
          tags: ["Approvals"],
          operationId: "rejectExpense",
          summary: "Reject a report (comment required)",
          parameters: [
            {
              name: "reportId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: { required: true, content: json(ref("RejectRequest")) },
          responses: {
            "200": ok("Rejected"),
            "400": error("Comment required"),
            "403": error("No access"),
          },
        },
      },
      "/statistics": {
        get: {
          tags: ["Statistics"],
          operationId: "getStatistics",
          summary: "Aggregated statistics by category/department/month",
          parameters: [
            { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
            { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
            { name: "department", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": ok("Statistics") },
        },
      },
      "/ontology/submit-from-text": {
        post: {
          tags: ["Ontology"],
          operationId: "submitExpenseFromText",
          summary: "Natural language to create and submit an expense report",
          requestBody: { required: true, content: json(ref("SubmitFromTextRequest")) },
          responses: { "200": ok("Action result") },
        },
      },
      "/ontology/query-expense-status": {
        post: {
          tags: ["Ontology"],
          operationId: "queryExpenseStatus",
          summary: "Natural language query over expense status (role-scoped + LLM summary)",
          requestBody: { required: true, content: json(ref("QueryExpenseStatusRequest")) },
          responses: { "200": ok("Summary + matching reports") },
        },
      },
      "/ontology/graph": {
        get: {
          tags: ["Ontology"],
          operationId: "getOntologyGraph",
          summary: "Get the ontology graph (role-scoped)",
          responses: { "200": ok("Graph nodes and edges") },
        },
      },
      "/ontology/query": {
        get: {
          tags: ["Ontology"],
          operationId: "queryOntology",
          summary: "Query ontology entities by type",
          parameters: [{ name: "type", in: "query", schema: { type: "string" } }],
          responses: { "200": ok("Entity list") },
        },
      },
      "/ontology/sparql": {
        post: {
          tags: ["Ontology"],
          operationId: "querySparql",
          summary: "Run a SPARQL query (admin/finance only)",
          requestBody: { required: true, content: json(ref("SparqlRequest")) },
          responses: {
            "200": ok("Query results"),
            "403": error("Insufficient role"),
          },
        },
      },
    },
  };
}
