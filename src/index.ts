import fs from "node:fs";
import { webhookCallback } from "grammy";
import { createBot } from "./bot/createBot.js";
import { setFlowConfig } from "./bot/flow.js";
import { DATA_DIR, loadConfig, loadDotEnv, setBotUsername } from "./config.js";
import { initDb } from "./db/session.js";
import { startDisasterScanCron } from "./disaster/cron.js";
import { startReminderCron } from "./reminders/cron.js";
import { startReopenNotifyCron } from "./reopen/cron.js";
import { impactStatsMode } from "./analytics/stats.js";
import { startWebServer } from "./web/server.js";

async function main(): Promise<void> {
  loadDotEnv();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const config = loadConfig();
  initDb(config.databasePath);
  setFlowConfig(config);

  const bot = createBot(config.token);
  startReminderCron(bot, config.tz);
  startDisasterScanCron(bot, config.tz, config.publicBaseUrl);
  startReopenNotifyCron(bot, config.tz);

  const me = await bot.api.getMe();
  setBotUsername(me.username ?? config.botUsername);
  if (config.botUsername === "" && me.username) {
    console.log(`Bot username resolved: @${me.username}`);
  }

  if (config.mode === "webhook") {
    if (!config.webhookUrl) {
      throw new Error("WEBHOOK_URL required when BOT_MODE=webhook");
    }
    const telegramHandler = webhookCallback(bot, "http", {
      secretToken: config.webhookSecret,
    });
    startWebServer(config, telegramHandler);
    await bot.api.setWebhook(config.webhookUrl, {
      secret_token: config.webhookSecret,
    });
    // #region agent log
    console.log(
      `[agent-debug] D index.ts:boot mode=webhook url=${config.webhookUrl}`,
    );
    // #endregion
    console.log(`CalClaim v2 webhook + impact site on :${config.port}`);
    console.log(`Impact stats mode: ${impactStatsMode()}`);
    return;
  }

  // Long polling still serves the funder site + tracking redirects
  startWebServer(config);
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  // #region agent log
  console.log("[agent-debug] D index.ts:boot mode=long_polling");
  // #endregion
  console.log("CalClaim v2 starting long polling…");
  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} online (v2 financial aid navigator)`);
      console.log(`Impact: ${config.publicBaseUrl}/impact`);
      console.log(`Developer: ${config.publicBaseUrl}/dev`);
      console.log(`Impact stats mode: ${impactStatsMode()}`);
      // #region agent log
      console.log(
        `[agent-debug] D index.ts:onStart bot=@${info.username} polling=true`,
      );
      // #endregion
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
