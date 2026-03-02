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
import mysql from 'mysql2/promise';
import { config } from './config.js';

export type DbPool = mysql.Pool;

/**
 * @returns MySQL connection pool.
 */
export function createDbPool(): DbPool {
  return mysql.createPool({
    host: config.database.host,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    connectionLimit: 10,
    queueLimit: 5000
  });
}

/**
 * @param pool MySQL connection pool.
 * @param table Table name.
 * @param column Column name.
 */
async function columnExists(pool: DbPool, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

/**
 * @param pool MySQL connection pool.
 */
export async function ensureSchema(pool: DbPool): Promise<void> {
  await pool.execute(
    'CREATE TABLE IF NOT EXISTS licenses (id INT PRIMARY KEY, authKey VARCHAR(255) NOT NULL, licenseOwnerId VARCHAR(64) NOT NULL, authIp VARCHAR(255) NOT NULL)'
  );

  if (!(await columnExists(pool, 'licenses', 'createdAt'))) await pool.execute('ALTER TABLE licenses ADD COLUMN createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  if (!(await columnExists(pool, 'licenses', 'expiresAt'))) await pool.execute('ALTER TABLE licenses ADD COLUMN expiresAt DATETIME NULL');
  if (!(await columnExists(pool, 'licenses', 'note'))) await pool.execute('ALTER TABLE licenses ADD COLUMN note TEXT NULL');
  if (!(await columnExists(pool, 'licenses', 'revoked'))) await pool.execute('ALTER TABLE licenses ADD COLUMN revoked TINYINT(1) NOT NULL DEFAULT 0');
  if (!(await columnExists(pool, 'licenses', 'revokedAt'))) await pool.execute('ALTER TABLE licenses ADD COLUMN revokedAt DATETIME NULL');
  if (!(await columnExists(pool, 'licenses', 'revokedNote'))) await pool.execute('ALTER TABLE licenses ADD COLUMN revokedNote TEXT NULL');
}
