import { startServer, runServer } from "./server.js";
export { startServer, runServer };
export { registerApiKey, validateApiKey, resolveAuthContext, enforceReadAccess } from "./auth.js";
export type { AuthContext } from "./auth.js";

runServer().catch((err: Error) => {
  console.error("MCP Server failed to start:", err);
  process.exit(1);
});
