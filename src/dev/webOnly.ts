/**
 * Local web-only CalClaim (no Telegram polling).
 * Used by scripts/dev-web.sh so /dev stays up outside agent shells.
 */
import fs from "node:fs";
import {
  DATA_DIR,
  loadConfig,
  loadDotEnv,
  setBotUsername,
} from "../config.js";
import { initDb } from "../db/session.js";
import { startWebServer } from "../web/server.js";

loadDotEnv();
fs.mkdirSync(DATA_DIR, { recursive: true });

const config = loadConfig();
const port = Number(process.env.PORT || config.port || 3000);
(config as { port: number }).port = port;

initDb(config.databasePath);
setBotUsername(config.botUsername || "CalClaim_bot");
startWebServer(config);

console.log(`web-only on :${port} (pid ${process.pid})`);
console.log(`Message tree: http://localhost:${port}/dev#tree`);
console.log(`Gate chart:   http://localhost:${port}/dev/tree/chart`);
