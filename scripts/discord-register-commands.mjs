// Registers the /ask slash command on the team's Discord server. Run once after
// creating the Discord application, and again only if the command changes.
//
//   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord-register-commands.mjs
//
// Guild-scoped (one server), so it shows up instantly; a global command takes
// up to an hour. The bot token is only needed here, never by the website.

const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guild = process.env.DISCORD_GUILD_ID;
if (!appId || !token || !guild) {
  console.error("Set DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const commands = [
  {
    name: "ask",
    type: 1,
    description: "Ask the creative dashboard a question (read-only).",
    options: [{ type: 3, name: "question", description: "e.g. Which persona had the best NC ROAS last month?", required: true, max_length: 2000 }],
    // Server members only, not DMs.
    contexts: [0],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guild}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
const body = await res.text();
console.log(res.status, body);
process.exit(res.ok ? 0 : 1);
