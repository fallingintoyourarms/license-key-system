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

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { DbPool } from './db.js';

function isManager(userId: string): boolean {
  return config.permissions.managers.includes(userId);
}

function makeLicenseKey(length: number): string {
  const raw = randomBytes(Math.ceil(length * 0.75)).toString('base64url');
  return raw.slice(0, length);
}

async function sendBotLog(client: Client, message: string): Promise<void> {
  const channelId = config.discord.logChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    if (!('send' in channel) || typeof channel.send !== 'function') return;
    await channel.send({ content: message.slice(0, 1900) });
  } catch {
    // ignore
  }
}

/**
 * @param expiry Expiry string (e.g. 7d/12h/never) or ISO date.
 */
function parseExpiryToDate(expiry: string | null): Date | null {
  if (!expiry) return null;
  const v = expiry.trim().toLowerCase();
  if (v === 'never' || v === 'none' || v === 'na') return null;

  const m = v.match(/^([0-9]+)([smhdw])$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
    return new Date(Date.now() + n * mult);
  }

  const asDate = new Date(expiry);
  if (!Number.isFinite(asDate.getTime())) return null;
  return asDate;
}

async function registerSlashCommands(): Promise<void> {
  const commands = [
    new SlashCommandBuilder()
      .setName('license-create')
      .setDescription('Create a new license key for a user')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption((o) => o.setName('expiry').setDescription('Expiry (e.g. 7d, 12h, 2026-12-31, never)').setRequired(false))
      .addStringOption((o) => o.setName('note').setDescription('Optional note').setRequired(false)),
    new SlashCommandBuilder()
      .setName('license-revoke')
      .setDescription('Revoke all active keys for a user')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Revocation note').setRequired(false)),
    new SlashCommandBuilder()
      .setName('license-view')
      .setDescription('View all keys for a user')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true)),
    new SlashCommandBuilder()
      .setName('license-setip')
      .setDescription('Bind all active keys for a user to an IP')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption((o) => o.setName('ip').setDescription('IP to bind (e.g. 1.2.3.4) or NA').setRequired(true))
  ].map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  if (config.discord.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
  }
}

/**
 * @param interaction Slash command interaction.
 * @param pool MySQL connection pool.
 */
async function handleLicenseCreate(interaction: ChatInputCommandInteraction, pool: DbPool): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const expiry = interaction.options.getString('expiry', false);
  const note = interaction.options.getString('note', false);

  const expiresAt = parseExpiryToDate(expiry);
  const authKey = makeLicenseKey(18);

  const [maxRows] = await pool.execute<any[]>('SELECT MAX(id) as maxId FROM licenses');
  const nextId = Number(maxRows?.[0]?.maxId ?? 0) + 1;

  await pool.execute(
    'INSERT INTO licenses (id, authKey, licenseOwnerId, authIp, expiresAt, note, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [nextId, authKey, String(user.id), 'NA', expiresAt, note]
  );

  await interaction.editReply({
    content: `Created license for <@${user.id}>\nID: ${nextId}\nKey: ${authKey}\nExpiry: ${expiresAt ? expiresAt.toISOString() : 'never'}\nNote: ${note ?? 'NA'}`
  });
}

/**
 * @param interaction Slash command interaction.
 * @param pool MySQL connection pool.
 */
async function handleLicenseRevoke(interaction: ChatInputCommandInteraction, pool: DbPool): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const note = interaction.options.getString('note', false);

  const [result] = await pool.execute<any>(
    'UPDATE licenses SET revoked = 1, revokedAt = NOW(), revokedNote = ? WHERE licenseOwnerId = ? AND revoked = 0',
    [note, String(user.id)]
  );

  const affected = Number(result?.affectedRows ?? 0);
  await interaction.editReply({ content: `Revoked ${affected} key(s) for <@${user.id}>\nNote: ${note ?? 'NA'}` });
}

/**
 * @param interaction Slash command interaction.
 * @param pool MySQL connection pool.
 */
async function handleLicenseView(interaction: ChatInputCommandInteraction, pool: DbPool): Promise<void> {
  const user = interaction.options.getUser('user', true);

  const [rows] = await pool.execute<any[]>(
    'SELECT id, authKey, authIp, createdAt, expiresAt, note, revoked, revokedAt FROM licenses WHERE licenseOwnerId = ? ORDER BY id DESC LIMIT 25',
    [String(user.id)]
  );

  if (!rows || rows.length === 0) {
    await interaction.editReply({ content: `No licenses found for <@${user.id}>` });
    return;
  }

  const lines = rows.map((r) => {
    const exp = r.expiresAt ? new Date(r.expiresAt).toISOString() : 'never';
    const created = r.createdAt ? new Date(r.createdAt).toISOString() : 'NA';
    const status = r.revoked ? `REVOKED${r.revokedAt ? ` @ ${new Date(r.revokedAt).toISOString()}` : ''}` : 'ACTIVE';
    return `#${r.id} | ${status} | ip=${r.authIp} | exp=${exp}\nkey=${r.authKey}\nnote=${r.note ?? 'NA'}\ncreated=${created}`;
  });

  const content = `Licenses for <@${user.id}> (showing up to 25)\n\n${lines.join('\n\n')}`;
  await interaction.editReply({ content: content.length > 1900 ? content.slice(0, 1900) + '\n…' : content });
}

/**
 * @param interaction Slash command interaction.
 * @param pool MySQL connection pool.
 */
async function handleLicenseSetIp(interaction: ChatInputCommandInteraction, pool: DbPool): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const ip = interaction.options.getString('ip', true);

  const [result] = await pool.execute<any>(
    'UPDATE licenses SET authIp = ? WHERE licenseOwnerId = ? AND revoked = 0',
    [ip, String(user.id)]
  );

  const affected = Number(result?.affectedRows ?? 0);
  await interaction.editReply({ content: `Updated authIp to '${ip}' for ${affected} active key(s) for <@${user.id}>` });
}

/**
 * @param pool MySQL connection pool used for license commands.
 */
export function createBot(pool: DbPool): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true }
  });

  client.once('ready', () => {
    if (!client.user) return;
    console.log(`Logged in as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;

      if (!isManager(interaction.user.id)) {
        await interaction.reply({ content: 'Not authorized.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      switch (interaction.commandName) {
        case 'license-create':
          await handleLicenseCreate(interaction, pool);
          await sendBotLog(client, `[LICENSE CREATE] by ${interaction.user.tag} (${interaction.user.id}) -> user=${interaction.options.getUser('user', true).id}`);
          return;
        case 'license-revoke':
          await handleLicenseRevoke(interaction, pool);
          await sendBotLog(client, `[LICENSE REVOKE] by ${interaction.user.tag} (${interaction.user.id}) -> user=${interaction.options.getUser('user', true).id}`);
          return;
        case 'license-view':
          await handleLicenseView(interaction, pool);
          return;
        case 'license-setip':
          await handleLicenseSetIp(interaction, pool);
          await sendBotLog(client, `[LICENSE SETIP] by ${interaction.user.tag} (${interaction.user.id}) -> user=${interaction.options.getUser('user', true).id} ip=${interaction.options.getString('ip', true)}`);
          return;
        default:
          await interaction.editReply({ content: 'Unknown command.' });
      }
    } catch (err: unknown) {
      console.error('interactionCreate error:', err);
      if (interaction.isRepliable()) {
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'Command failed.' });
          } else {
            await interaction.reply({ content: 'Command failed.', ephemeral: true });
          }
        } catch {
          // ignore
        }
      }
    }
  });

  client.on('error', (err) => {
    console.error('Discord client error:', err);
  });

  return client;
}

/**
 * @param client Discord client instance.
 */
export async function startBot(client: Client): Promise<void> {
  await registerSlashCommands();
  await client.login(config.discord.token);
}
