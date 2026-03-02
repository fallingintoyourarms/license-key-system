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

import 'dotenv/config';

/**
 * @param name Environment variable name.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discord: {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID ?? null,
    logChannelId: process.env.DISCORD_LOG_CHANNEL_ID ?? null,
    logWebhookUrl: process.env.DISCORD_LOG_WEBHOOK_URL ?? null
  },
  api: {
    port: Number(process.env.API_PORT ?? '3000'),
    logActions: (process.env.API_LOG_ACTIONS ?? 'false').toLowerCase() === 'true',
    newLicenseSecret: requireEnv('NEW_LICENSE_SECRET')
  },
  permissions: {
    managers: (process.env.MANAGER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  },
  database: {
    host: requireEnv('DB_HOST'),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: requireEnv('DB_NAME')
  }
} as const;
