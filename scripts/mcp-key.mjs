// Make a Claude Code key for one team member's MCP access (app/api/mcp).
//
//   node scripts/mcp-key.mjs rob@example.com
//
// Prints two things:
//   1. the key — give it to that person once (they paste it into their
//      `claude mcp add` command); it is not stored anywhere else
//   2. the `email=hash` pair — append it to MCP_KEYS in Vercel (comma
//      separated) and redeploy. Delete the pair to revoke the key.
import { createHash, randomBytes } from "node:crypto";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: node scripts/mcp-key.mjs <team member email>");
  process.exit(1);
}
const key = "sdk_" + randomBytes(24).toString("hex");
const hash = createHash("sha256").update(key).digest("hex");
console.log(`key (give to the person):  ${key}`);
console.log(`MCP_KEYS pair (Vercel):    ${email}=${hash}`);
