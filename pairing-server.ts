/**
 * MARIA PAIRING SERVER v5.0 - BAILEYS V7 OFFICIAL FLOW
 * Fully compatible with @whiskeysockets/baileys v7.0.0-rc13+
 * Node.js 20+ / Railway Compatible / Express 5 Ready
 * 
 * Features:
 * - Robust Socket Connection Handling (Waits for ready state)
 * - Exponential Backoff Retry Logic (1s, 2s, 4s)
 * - Strict Input Validation & Sanitization
 * - Security Middleware (Helmet, CORS, Rate Limiting)
 * - Graceful Shutdown & Cleanup
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  type WASocket,
  type AuthenticationState,
  type WAVersion
} from '@whiskeysockets/baileys';

// ============================================
// TYPES & INTERFACES
// ============================================

interface PairRequestBody {
  number?: string;
}

interface PairResponse {
  success: boolean;
  code?: string;
  number?: string;
  message: string;
  groupLink?: string;
  groupName?: string;
  botName?: string;
  instructions?: string[];
  timestamp: string;
}

interface ErrorResponse {
  success: boolean;
  error: string;
  errorCode: string;
  timestamp: string;
}

interface AppError extends Error {
  statusCode: number;
  errorCode: string;
  retryCount?: number;
  disconnectReason?: string;
  originalError?: unknown;
}

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAX_RETRIES = 3;
const PAIRING_TIMEOUT_MS = 60000; // 60 seconds
const logger = pino({ level: 'silent' });

const appConfig = {
  BOT_NAME: process.env.BOT_NAME || 'MARIA-MM',
  GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://chat.whatsapp.com/default',
  GROUP_NAME: process.env.GROUP_NAME || 'MARIA-MM Support'
};

// Track active requests to prevent duplicates
const activeRequests = new Set<string>();
const activeSockets = new Set<WASocket>();

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Professional logging utility
 */
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, extra?: unknown): void {
  const prefix = '[PAIR]';
  const time = new Date().toISOString();
  
  if (level === 'error') {
    console.error(`${prefix} ${time} - ERROR: ${message}`);
    if (extra) console.error(extra);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${time} - WARN: ${message}`);
    if (extra) console.warn(extra);
  } else {
    console.log(`${prefix} ${time} - ${message}`);
    if (extra) console.log(extra);
  }
}

/**
 * Delay utility for exponential backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitize and validate phone number
 */
function sanitizePhoneNumber(input: string | undefined): string {
  if (!input) return '';
  
  // Remove spaces, dashes, brackets
  let cleaned = String(input).replace(/[\s\-()]/g, '');
  
  // Accept numbers beginning with +
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  
  // Validate international format: + followed by 6-15 digits
  const phoneRegex = /^\+[1-9]\d{6,14}$/;
  if (!phoneRegex.test(cleaned)) {
    throw Object.assign(new Error('Invalid phone number format. Must be international format (e.g., +2567xxxxxxxx).'), {
      statusCode: 400,
      errorCode: 'INVALID_PHONE_FORMAT'
    });
  }
  
  // Extract raw digits for Baileys
  return cleaned.replace(/\+/g, '');
}

/**
 * Cleanup temporary authentication folder
 */
function cleanupFolder(folderPath: string): void {
  try {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      log('info', `Cleaned temporary files: ${path.basename(folderPath)}`);
    }
  } catch (err) {
    log('error', `Failed to clean folder ${path.basename(folderPath)}`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Close and cleanup a Baileys socket
 */
async function closeSocket(sock: WASocket | null): Promise<void> {
  if (!sock) return;
  
  try {
    activeSockets.delete(sock);
    sock.ev.removeAllListeners();
    // Use end() instead of logout() to preserve session if user wants to retry,
    // but since this is a temp pairing session, end() is safest.
    if (sock.ws) {
      await sock.end(new Error('Pairing process completed or aborted'));
    }
  } catch (err) {
    // Ignore errors on close
  }
}

// ============================================
// BAILEYS CONNECTION MANAGER
// ============================================

/**
 * Wait for socket to be fully ready before requesting pairing code
 */
function waitForSocketReady(sock: WASocket, reqId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(Object.assign(new Error('Timed Out waiting for socket to connect'), {
        statusCode: 408,
        errorCode: 'SOCKET_CONNECTION_TIMEOUT'
      }));
    }, 20000);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'connecting') {
        log('info', `#${reqId} Socket state: Connecting...`);
      } else if (connection === 'open') {
        clearTimeout(timeoutId);
        log('info', `#${reqId} Socket state: Open & Ready`);
        resolve();
      } else if (connection === 'close') {
        clearTimeout(timeoutId);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || 'Unknown disconnect reason';
        
        log('error', `#${reqId} Socket closed. Status: ${statusCode}, Reason: ${reason}`);
        
        const error = new Error(`Connection Closed: ${reason}`) as AppError;
        error.statusCode = statusCode === 429 ? 429 : 503;
        error.errorCode = 'CONNECTION_CLOSED';
        error.disconnectReason = reason;
        
        reject(error);
      }
    });
  });
}

/**
 * Core pairing logic for a single attempt
 */
async function attemptPairing(number: string, tempFolder: string, reqId: string): Promise<string> {
  log('info', `#${reqId} Creating auth state...`);
  const { state, saveCreds }: { state: AuthenticationState; saveCreds: () => Promise<void> } = 
    await useMultiFileAuthState(tempFolder);

  log('info', `#${reqId} Fetching latest Baileys version...`);
  const { version, isLatest }: { version: WAVersion; isLatest: boolean } = 
    await fetchLatestBaileysVersion();
  log('info', `#${reqId} Using Baileys v${version.join('.')}`);

  log('info', `#${reqId} Creating socket...`);
  const sock: WASocket = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('MARIA-MM'),
    version,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    printQRInTerminal: false
  });

  activeSockets.add(sock);

  // Save credentials whenever they update
  sock.ev.on('creds.update', saveCreds);

  // Wait for socket to be ready
  log('info', `#${reqId} Waiting for socket to be ready...`);
  await waitForSocketReady(sock, reqId);

  // Request pairing code
  log('info', `#${reqId} Requesting pairing code for: ${number}`);
  const pairingCode = await sock.requestPairingCode(number);

  if (!pairingCode) {
    throw Object.assign(new Error('WhatsApp returned an empty pairing code.'), {
      statusCode: 500,
      errorCode: 'EMPTY_PAIRING_CODE'
    });
  }

  log('info', `#${reqId} Pairing code generated: ${pairingCode}`);
  
  // Cleanup socket but keep temp folder until the finally block of the route
  await closeSocket(sock);
  
  return pairingCode;
}

/**
 * Pairing logic with exponential backoff retry
 */
async function pairNumberWithRetry(number: string, tempFolder: string, reqId: string): Promise<string> {
  let lastError: AppError | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log('info', `#${reqId} Pairing attempt ${attempt} of ${MAX_RETRIES}`);
    
    try {
      const code = await attemptPairing(number, tempFolder, reqId);
      return code;
    } catch (err) {
      const error = err as AppError;
      lastError = error;
      lastError.retryCount = attempt;

      const errorMessage = error.message || '';
      const shouldRetry = 
        errorMessage.includes('Connection Closed') ||
        errorMessage.includes('Restart Required') ||
        errorMessage.includes('Timed Out') ||
        errorMessage.includes('Stream Errored') ||
        errorMessage.includes('Connection Lost');

      if (shouldRetry && attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        log('warn', `#${reqId} Retryable error encountered. Backing off for ${backoffMs}ms...`);
        await delay(backoffMs);
      } else {
        // Non-retryable error or max retries reached
        log('error', `#${reqId} Failing permanently. Reason: ${errorMessage}`);
        throw lastError;
      }
    }
  }

  throw lastError || Object.assign(new Error('Unknown pairing failure'), { statusCode: 500, errorCode: 'UNKNOWN_ERROR' });
}

// ============================================
// EXPRESS APP SETUP
// ============================================

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Rate limiting: Prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    errorCode: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  }
});
app.use(limiter);

// ============================================
// ROUTES
// ============================================

app.get('/', (req: Request, res: Response) => {
  res.status(200).send('Server Online');
});

app.get('/health', (req: Request, res: Response) => {
  const memoryUsage = process.memoryUsage();
  res.status(200).json({
    status: 'online',
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) // MB
    },
    version: 'v5.0'
  });
});

app.post('/pair', async (req: Request, res: Response) => {
  const reqId = Date.now().toString(36).slice(-6);
  const { number } = req.body as PairRequestBody;
  
  let tempFolder: string = path.join(__dirname, `temp_${reqId}`);
  let sanitizedNumber: string = '';
  
  log('info', `#${reqId} Request received`);
  
  try {
    // Validate and sanitize input
    sanitizedNumber = sanitizePhoneNumber(number);
    log('info', `#${reqId} Sanitized number: ${sanitizedNumber}`);
    
    // Prevent duplicate concurrent requests for the same number
    if (activeRequests.has(sanitizedNumber)) {
      throw Object.assign(new Error('A pairing request for this number is already in progress.'), {
        statusCode: 409,
        errorCode: 'DUPLICATE_REQUEST'
      });
    }
    activeRequests.add(sanitizedNumber);
    
    // Prepare temp folder
    if (fs.existsSync(tempFolder)) {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(tempFolder, { recursive: true });
    
    // Setup 60s timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(Object.assign(new Error('Timed Out: WhatsApp did not respond within 60 seconds'), {
          statusCode: 408,
          errorCode: 'PAIRING_TIMEOUT'
        }));
      }, PAIRING_TIMEOUT_MS);
    });
    
    // Execute pairing with retry logic and timeout
    const pairingPromise = pairNumberWithRetry(sanitizedNumber, tempFolder, reqId);
    const pairingCode = await Promise.race([pairingPromise, timeoutPromise]);
    
    // Send success response
    const responseData: PairResponse = {
      success: true,
      code: pairingCode,
      number: sanitizedNumber,
      message: 'Enter this code in WhatsApp',
      groupLink: appConfig.GROUP_INVITE_LINK,
      groupName: appConfig.GROUP_NAME,
      botName: appConfig.BOT_NAME,
      instructions: [
        '1. Open WhatsApp',
        '2. Go to Linked Devices',
        '3. Select "Link with phone number"',
        `4. Enter: ${pairingCode}`,
        `5. Join group: ${appConfig.GROUP_INVITE_LINK}`
      ],
      timestamp: new Date().toISOString()
    };
    
    if (!res.headersSent) {
      res.status(200).json(responseData);
    }
    
  } catch (error) {
    const err = error as AppError;
    const errorMsg = err?.message || 'Internal server error';
    const statusCode = err?.statusCode || 500;
    const errorCode = err?.errorCode || 'INTERNAL_ERROR';
    
    // Comprehensive Error Logging
    log('error', `#${reqId} Pairing failed`, {
      message: errorMsg,
      stack: err?.stack,
      disconnectReason: err?.disconnectReason || 'N/A',
      statusCode: statusCode,
      errorCode: errorCode,
      retryCount: err?.retryCount || 0,
      originalError: err?.originalError ? String(err.originalError) : undefined
    });
    
    if (!res.headersSent) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: errorMsg,
        errorCode: errorCode,
        timestamp: new Date().toISOString()
      };
      res.status(statusCode).json(errorResponse);
    }
  } finally {
    // Always remove from active requests
    if (sanitizedNumber) activeRequests.delete(sanitizedNumber);
    
    // Always cleanup temp folder to prevent Railway disk bloat
    log('info', `#${reqId} Initiating final cleanup...`);
    cleanupFolder(tempFolder);
  }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Not found: ${req.method} ${req.url}`,
    errorCode: 'NOT_FOUND',
    timestamp: new Date().toISOString()
  });
});

// Global Error Handler
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  log('error', 'Unhandled server error', err instanceof Error ? err.message : String(err));
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function gracefulShutdown(signal: string) {
  log('warn', `${signal} received. Shutting down gracefully...`);
  
  // Close all active sockets
  log('info', 'Closing active sockets...');
  for (const sock of activeSockets) {
    await closeSocket(sock);
  }
  
  // Delete any leftover temp folders
  log('info', 'Cleaning up temporary directories...');
  const files = fs.readdirSync(__dirname);
  for (const file of files) {
    if (file.startsWith('temp_')) {
      cleanupFolder(path.join(__dirname, file));
    }
  }
  
  log('info', 'Cleanup complete. Exiting.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  log('info', 'Server started');
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║      🚀 MARIA-MM PAIRING SERVER v5.0       ║');
  console.log('║      (Baileys v7 Official Flow)            ║');
  console.log(`║      🌐 Listening on port ${PORT}             ║`);
  console.log('║      ✅ Status: ONLINE                      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
});
