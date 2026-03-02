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



import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { DbPool } from './db.js';
import type { RowDataPacket } from 'mysql2';
import { sendWebhookLog } from './logging.js';

/**
 * @param req Express request.
 * @returns Best-effort requester IP for logging/validation.
 */
function getRequestIp(req: Request): string {
  const header = req.header('x-real-ip');
  if (header && header.length > 0) return header;
  if (typeof req.ip === 'string' && req.ip.length > 0) return req.ip;
  return 'UNKNOWN';
}

/**
 * @param length Desired key length.
 * @returns Random URL-safe license key.
 */
function makeLicenseKey(length: number): string {
  const raw = randomBytes(Math.ceil(length * 0.75)).toString('base64url');
  return raw.slice(0, length);
}

/**
 * @param pool MySQL connection pool used for license lookups and mutations.
 */
export function createApi(pool: DbPool) {
  const app = express();

  app.use(cors({ origin: '*' }));
  app.use(express.json());

  app.get('/', async (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'Active'
    });
  });

  app.get('/api/:checkKey', async (req: Request, res: Response) => {
    const key = req.params.checkKey;
    const productId = req.header('productid');

    if (!productId) {
      await sendWebhookLog(`[API FAIL] missing productid | ip=${getRequestIp(req)} | key=${key}`);
      res.status(400).json({
        authorized: false,
        reason: 'No Product Id Provided in Headers of the request.'
      });
      return;
    }

    const requestingIp = getRequestIp(req);

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, authKey, licenseOwnerId, authIp FROM licenses WHERE authKey = ? AND id = ? LIMIT 1',
      [key, productId]
    );

    const row = rows[0];

    if (!row) {
      if (config.api.logActions) {
        console.log(`[ACTION LOGS] IP: ${requestingIp} | Key: ${key} | Authorized: false | License Key Not Found`);
      }

      await sendWebhookLog(`[API FAIL] license not found | ip=${requestingIp} | productId=${productId} | key=${key}`);

      res.status(200).json({
        authorized: false,
        requestingIp,
        reason: 'License Key Not Found...'
      });
      return;
    }

    const isIpMatch = row.authIp === requestingIp;

    if (!isIpMatch) {
      await sendWebhookLog(`[API FAIL] ip mismatch | ip=${requestingIp} | expectedIp=${row.authIp} | productId=${productId} | key=${key} | owner=${row.licenseOwnerId}`);
    }

    if (config.api.logActions) {
      console.log(
        `[ACTION LOGS] ID: ${row.id} | IP: ${requestingIp} | Key: ${key} | Authorized: ${isIpMatch} | ${isIpMatch ? 'Accepted Request' : 'Invalid Auth IP'}`
      );
    }

    res.status(200).json({
      id: row.id,
      authorized: isIpMatch,
      requestingIp,
      licenseOwner: String(row.licenseOwnerId)
    });
  });

  app.get('/addLicense', async (req: Request, res: Response) => {
    const secret = req.header('secret');
    const ownerId = req.header('ownerid');

    if (!secret) {
      res.status(400).json({
        authorized: false,
        error: true,
        reason: 'No Secret Provided in Headers of the request.'
      });
      return;
    }

    if (secret !== config.api.newLicenseSecret) {
      res.status(403).json({
        authorized: false,
        error: true,
        reason: 'Invalid Secret Provided in Headers of the request.'
      });
      return;
    }

    if (!ownerId) {
      res.status(400).json({
        authorized: false,
        error: true,
        reason: 'Missing ownerid provided in request.'
      });
      return;
    }

    const authKey = makeLicenseKey(18);

    const [countRows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(id) as total FROM licenses'
    );

    const nextId = Number(countRows[0]?.total ?? 0) + 1;

    await pool.execute(
      'INSERT INTO licenses (id, authKey, licenseOwnerId, authIp) VALUES (?, ?, ?, ?)',
      [nextId, authKey, ownerId, 'NA']
    );

    res.status(200).json({
      authorized: false,
      error: false,
      reason: 'NA',
      licenseInfo: {
        id: nextId,
        authKey,
        licenseOwnerId: ownerId,
        authIp: 'NA'
      }
    });
  });

  app.get('/owners', async (_req: Request, res: Response) => {
    res.status(200).json({
      authorized: false,
      listedOwners: (process.env.MANAGER_IDS ?? '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      authorized: false,
      reason: 'Invalid Request Location'
    });
  });

  return app;
}
