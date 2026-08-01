import fs from "node:fs";
import http from "node:http";
import { webhookCallback } from "grammy";
import { createBot } from "./bot/createBot.js";
import { DATA_DIR, loadConfig, loadDotEnv } from "./config.js";
import { initDb } from "./db/session.js";
import { startReminderCron } from "./reminders/cron.js";

async function main(): Promise<void> {
  loadDotEnv();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = loadConfig();
  initDb(config.databasePath);

  const bot = createBot(config.token);
  startReminderCron(bot, config.tz);

  if (config.mode === "webhook") {
    if (!config.webhookUrl) {
      throw new Error("WEBHOOK_URL required when BOT_MODE=webhook");
    }
    const handler = webhookCallback(bot, "http", {
      secretToken: config.webhookSecret,
    });
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      void handler(req, res);
    });
    server.listen(config.port, async () => {
      await bot.api.setWebhook(config.webhookUrl!, {
        secret_token: config.webhookSecret,
      });
      console.log(`CalClaim v2 webhook listening on :${config.port}`);
    });
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log("CalClaim v2 starting long polling…");
  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} online (v2 financial aid navigator)`);
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
