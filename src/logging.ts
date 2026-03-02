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

import { config } from './config.js';

/**
 * @param message Message to send to the configured Discord webhook.
 */
export async function sendWebhookLog(message: string): Promise<void> {
  const url = config.discord.logWebhookUrl;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message.slice(0, 1900) })
    });
  } catch {
    // ignore
  }
}
