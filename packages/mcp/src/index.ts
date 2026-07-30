export { startServer, runServer } from "./server.js";
export { registerApiKey, validateApiKey, resolveAuthContext, enforceReadAccess } from "./auth.js";
export type { AuthContext } from "./auth.js";

runServer().catch((err) => {
  console.error("MCP Server failed to start:", err);
  process.exit(1);
});
