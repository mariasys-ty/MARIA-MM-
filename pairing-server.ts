/**
 * MARIA PAIRING SERVER v5.0 - PRODUCTION STABLE
 * Fully compatible with @whiskeysockets/baileys v7.0.0-rc13+
 * Node.js 20+ / Railway Compatible / Express 5 Ready
 * 
 * Fixes:
 * - Prevents premature session destruction.
 * - Keeps socket alive while user enters the code.
 * - Implements robust lifecycle management and timers.
 * - Uses asynchronous filesystem APIs to prevent event loop blocking.
 */

import express, { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import path from 'path';
import * as fs from 'fs/promises'; // Using async fs API
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  WASocket,
  AuthenticationState
} from '@whiskeysockets/baileys';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 7700;
const logger = pino({ level: 'silent' });

// ============================================
// CONFIGURATION
// ============================================
const appConfig = {
  BOT_NAME: 'MARIA-MM',
  PREFIX: '.',
  CREATOR: '256743668990',
  FOOTER: 'MarkMellon the Creator',
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/BmOS9yQR6b6CFtlI3p0iNg',
  GROUP_ID: '12036321@g.us',
  GROUP_NAME: 'MARIA-MM'
};

const PAIRING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to enter the code
const CRED_SAVE_DELAY_MS = 5 * 1000; // 5 seconds to ensure creds flush to disk

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'maria-pairing-site')));

// ============================================
// UTILITY FUNCTIONS
// ============================================

function validatePhoneNumber(input: unknown): string {
  if (!input) throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
  const cleaned = String(input).replace(/[^0-9]/g, '');
  if (!cleaned || cleaned.length < 8 || cleaned.length > 15) {
    throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
  }
  return cleaned;
}

async function createTempAuthFolder(reqId: string): Promise<string> {
  const folder = path.join(__dirname, `temp_${reqId}`);
  await fs.mkdir(folder, { recursive: true });
  console.log(`[PAIR #${reqId}] Auth folder created.`);
  return folder;
}

function createBaileysSocket(state: AuthenticationState, reqId: string): WASocket {
  console.log(`[PAIR #${reqId}] Initializing Baileys v7 socket...`);
  return makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('MARIA-MM'),
    markOnlineOnConnect: false,
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 30000,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    printQRInTerminal: false
  });
}

async function generatePairingCode(sock: WASocket, phoneNumber: string, reqId: string): Promise<string> {
  try {
    console.log(`[PAIR #${reqId}] Requesting pairing code for: ${phoneNumber}`);
    const code = await sock.requestPairingCode(phoneNumber);
    console.log(`[PAIR #${reqId}] ✅ Code generated: ${code}`);
    return code;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('already')) {
      throw Object.assign(new Error('Rate Limited'), { statusCode: 429 });
    }
    throw Object.assign(new Error('Failed to generate pairing code.'), { statusCode: 500 });
  }
}

function sendSuccessResponse(res: Response, pairingCode: string, phoneNumber: string): void {
  res.json({
    success: true,
    code: pairingCode,
    number: phoneNumber,
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
  });
}

function sendErrorResponse(res: Response, status: number, message: string): void {
  let userMsg = 'Failed to generate pairing code. Please try again.';
  
  if (message.includes('Invalid phone')) userMsg = 'Invalid phone number format.';
  else if (message.includes('Timed Out')) userMsg = 'Connection timed out. Please try again.';
  else if (message.includes('Rate Limited')) userMsg = 'Too many requests. Please wait a few minutes.';
  else if (message.includes('Connection Closed') || message.includes('Connection Lost')) userMsg = 'WhatsApp service unavailable. Please try again.';
  else if (message.includes('Restart Required')) userMsg = 'Server temporarily unavailable. Please try again.';
  else if (message.includes('Logged Out')) userMsg = 'Session invalid. Please try again.';
  else if (message.includes('ECONNREFUSED') || message.includes('Network') || message.includes('ENOTFOUND')) userMsg = 'Network error. Cannot reach WhatsApp.';

  if (!res.headersSent) {
    res.status(status).json({
      success: false,
      error: userMsg,
      timestamp: new Date().toISOString()
    });
  }
}

// ============================================
// ROUTES
// ============================================

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'maria-pairing-site', 'index.html'));
});

app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    BOT_NAME: appConfig.BOT_NAME,
    PREFIX: appConfig.PREFIX,
    CREATOR: appConfig.CREATOR,
    FOOTER: appConfig.FOOTER,
    GROUP_LINK: appConfig.GROUP_INVITE_LINK,
    status: 'online'
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'MARIA-MM Pairing Server',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString()
  });
});

// ============================================
// MAIN ENDPOINT: POST /pair
// ============================================
app.post('/pair', async (req: Request, res: Response) => {
  const reqId = Date.now().toString(36);
  
  let sock: WASocket | null = null;
  let tempFolder: string | null = null;
  let isCleanedUp = false;
  let isResponseSent = false;
  const activeTimers: NodeJS.Timeout[] = [];

  // ============================================
  // CLEANUP UTILITY (Idempotent & Safe)
  // ============================================
  const cleanupSession = async (): Promise<void> => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    
    console.log(`[PAIR #${reqId}] Initiating cleanup...`);
    
    // Clear all active timers to prevent memory leaks
    activeTimers.forEach(timer => clearTimeout(timer));
    
    // Gracefully shutdown socket listeners
    try {
      if (sock?.ev) {
        sock.ev.removeAllListeners();
      }
    } catch (err) {
      console.error(`[PAIR #${reqId}] Socket listener cleanup error:`, err instanceof Error ? err.message : String(err));
    } finally {
      sock = null; // Dereference for GC
    }
    
    // Asynchronously delete temp folder
    if (tempFolder) {
      try {
        await fs.rm(tempFolder, { recursive: true, force: true });
        console.log(`[PAIR #${reqId}] Temp folder deleted.`);
      } catch (err) {
        console.error(`[PAIR #${reqId}] Folder deletion error:`, err instanceof Error ? err.message : String(err));
      }
    }
  };

  // Handle client disconnecting abruptly before code is generated
  req.on('close', async () => {
    if (!res.writableEnded) {
      console.log(`[PAIR #${reqId}] Client aborted request. Cleaning up.`);
      await cleanupSession();
    }
  });

  try {
    // 1. Validate Input
    const phoneNumber = validatePhoneNumber(req.body?.number);
    
    // 2. Setup Auth State
    tempFolder = await createTempAuthFolder(reqId);
    const { state, saveCreds } = await useMultiFileAuthState(tempFolder);
    
    // 3. Create Socket
    sock = createBaileysSocket(state, reqId);
    
    // 4. Register creds.update immediately
    sock.ev.on('creds.update', saveCreds);
    
    // 5. Setup Connection Monitor & Timers
    // Global timeout for the entire pairing process
    const timeoutTimer = setTimeout(async () => {
      console.log(`[PAIR #${reqId}] Global pairing timeout reached. Cleaning up.`);
      if (!isResponseSent) {
        sendErrorResponse(res, 408, 'Timed Out');
        isResponseSent = true;
      }
      await cleanupSession();
    }, PAIRING_TIMEOUT_MS);
    activeTimers.push(timeoutTimer);

    // Monitor connection state
    sock.ev.on('connection.update', async (update) => {
      if (isCleanedUp) return;
      const { connection } = update;
      
      if (connection === 'connecting') {
        console.log(`[PAIR #${reqId}] State: Connecting...`);
      } else if (connection === 'open') {
        console.log(`[PAIR #${reqId}] State: Open. Pairing successful. Credentials saved.`);
        // Wait a few seconds to ensure all creds are written to disk, then cleanup
        const saveTimer = setTimeout(async () => {
          console.log(`[PAIR #${reqId}] Post-open cleanup triggered.`);
          await cleanupSession();
        }, CRED_SAVE_DELAY_MS);
        activeTimers.push(saveTimer);
      } else if (connection === 'close') {
        console.log(`[PAIR #${reqId}] State: Closed. Cleaning up.`);
        await cleanupSession();
      }
    });

    // 6. Request Pairing Code
    const pairingCode = await generatePairingCode(sock, phoneNumber, reqId);
    
    // 7. Send Response Immediately (Keep socket alive in background)
    if (!isResponseSent) {
      sendSuccessResponse(res, pairingCode, phoneNumber);
      isResponseSent = true;
    }
    
    // NOTE: We intentionally DO NOT call cleanupSession() here in a finally block.
    // The socket must remain alive while the user enters the code on their phone.
    // Cleanup is handled by the connection.update 'open' event or the timeout.
    
  } catch (error) {
    console.error(`[PAIR #${reqId}] Error:`, error instanceof Error ? error.message : String(error));
    if (!isResponseSent) {
      const err = error as Error & { statusCode?: number };
      sendErrorResponse(res, err.statusCode || 500, err.message || 'Unknown error');
      isResponseSent = true;
    }
    // If an error occurs before the response is sent, clean up immediately
    await cleanupSession();
  }
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Not found: ${req.method} ${req.url}`
  });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  console.error('[SERVER] Unhandled Error:', err instanceof Error ? err.message : String(err));
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║                                            ║');
  console.log('║      🚀 MARIA-MM PAIRING SERVER v5.0       ║');
  console.log('║      (Baileys v7 Production Flow)          ║');
  console.log('║                                            ║');
  console.log(`║      🌐 Listening on port ${PORT}             ║`);
  console.log('║      ✅ Status: ONLINE                      ║');
  console.log('║                                            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log('Available Endpoints:');
  console.log(`  🌍 GET  /             → Pairing Website`);
  console.log(`  🔗 POST /pair         → Generate Pairing Code`);
  console.log(`  ⚙️  GET  /api/config   → Server Config`);
  console.log(`  ❤️  GET  /health      → Health Check`);
  console.log('');
});
