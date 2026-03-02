/*
/   __ _             
  / _(_)            
 | |_ _ _   _  __ _ 
 |  _| | | | |/ _` |
 | | | | |_| | (_| |
 |_| |_|\__, |\__,_|
         __/ |      
        |___/       
*/

import { createDbPool, ensureSchema } from './db.js';
import { createApi } from './api.js';
import { config } from './config.js';
import { createBot, startBot } from './bot.js';

const pool = createDbPool();
await ensureSchema(pool);

const api = createApi(pool);

const server = api.listen(config.api.port, () => {
  console.log(`[FIYA] API listening on port ${config.api.port}`);
});

const bot = createBot(pool);
startBot(bot).catch((err) => {
  console.error('[FIYA] Failed to start Discord bot:', err);
  process.exit(1);
});

/**
 * @param code Process exit code.
 */
function shutdown(code: number) {
  server.close(() => {
    pool.end().catch(() => undefined).finally(() => {
      bot.destroy();
      process.exit(code);
    });
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
