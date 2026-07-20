/**
 * MARIA PAIRING SERVER v4.4 - BAILEYS V7 OFFICIAL FLOW
 */

import express, { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  WASocket
} from '@whiskeysockets/baileys';

// Bulletproof import for socks-proxy-agent (handles both ESM and CommonJS)
import * as SocksProxyAgentModule from 'socks-proxy-agent';
const SocksProxyAgent = (SocksProxyAgentModule as any).default || (SocksProxyAgentModule as any).SocksProxyAgent;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 7700;
const logger = pino({ level: 'silent' });

// ============================================
// PROXY CONFIGURATION (Proxy6)
// ============================================
const PROXY_USER = 'KjZxjF';
const PROXY_PASS = 'G6Pbs6';
const PROXY_IP = '193.31.102.44';
const PROXY_PORT = '9594';
const proxyUrl = `socks5://${PROXY_USER}:${PROXY_PASS}@${PROXY_IP}:${PROXY_PORT}`;
const proxyAgent = new SocksProxyAgent(proxyUrl);

// App Config
const appConfig = {
  BOT_NAME: 'MARIA-MM',
  PREFIX: '.',
  CREATOR: '256743668990',
  FOOTER: 'MarkMellon the Creator',
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/BmOS9yQR6b6CFtlI3p0iNg',
  GROUP_ID: '12036321@g.us',
  GROUP_NAME: 'MARIA-MM'
};

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'maria-pairing-site')));

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
  const { number } = req.body as { number ? : string };
  
  let sock: WASocket | null = null;
  let tempFolder: string = path.join(__dirname, `temp_${reqId}`);
  let isCleanedUp = false;
  
  console.log(`[PAIR #${reqId}] Request received for: ${number}`);
  
  // ============================================
  // CLEANUP UTILITY (Idempotent)
  // ============================================
  const cleanup = (): void => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    
    console.log(`[PAIR #${reqId}] Initiating cleanup...`);
    
    try {
      if (sock?.ev) {
        sock.ev.removeAllListeners();
      }
    } catch (err) {
      console.error(`[PAIR #${reqId}] Socket cleanup error:`, err instanceof Error ? err.message : String(err));
    }
    
    // Delay folder deletion to ensure FS unlocks
    setTimeout(() => {
      try {
        if (fs.existsSync(tempFolder)) {
          fs.rmSync(tempFolder, { recursive: true, force: true });
          console.log(`[PAIR #${reqId}] Temp folder deleted.`);
        }
      } catch (err) {
        console.error(`[PAIR #${reqId}] Folder deletion error:`, err instanceof Error ? err.message : String(err));
      }
    }, 3000);
  };
  
  try {
    // ---- VALIDATION ----
    if (!number) {
      throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
    }
    
    const cleaned = String(number).replace(/[^0-9]/g, '');
    
    if (!cleaned || cleaned.length < 8 || cleaned.length > 15) {
      throw Object.assign(new Error('Invalid phone number'), { statusCode: 400 });
    }
    
    console.log(`[PAIR #${reqId}] Cleaned number: ${cleaned}`);
    
    // ---- SETUP TEMP FOLDER ----
    if (fs.existsSync(tempFolder)) {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(tempFolder, { recursive: true });
    
    // ---- CREATE AUTH STATE ----
    console.log(`[PAIR #${reqId}] Creating auth state...`);
    const { state, saveCreds } = await useMultiFileAuthState(tempFolder);
    
    // ---- CREATE SOCKET ----
    console.log(`[PAIR #${reqId}] Initializing Baileys v7 socket with Proxy...`);
    sock = makeWASocket({
      auth: state,
      logger,
      // Reverted back to Ubuntu as it is the official Baileys standard
      browser: Browsers.ubuntu('MARIA-MM'),
      markOnlineOnConnect: false,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 30000,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      agent: proxyAgent // <--- PROXY IS NOW APPLIED HERE
    });
    
    // Register creds.update immediately
    sock.ev.on('creds.update', saveCreds);
    
    // ---- WAIT FOR WHATSAPP TO BE READY ----
    console.log(`[PAIR #${reqId}] Waiting for WhatsApp socket to connect...`);
    await new Promise < void > ((resolve, reject) => {
      let isSettled = false;
      
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('Timed Out waiting for WhatsApp connection'));
        }
      }, 60000);
      
      const onQr = () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeout);
        sock?.ev.off('qr', onQr);
        console.log(`[PAIR #${reqId}] State: Ready for pairing (QR event received)`);
        resolve();
      };
      
      const onConnectionUpdate = (update: any) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (connection === 'connecting') {
          console.log(`[PAIR #${reqId}] State: Connecting...`);
        }
        
        if (!isSettled && (qr || connection === 'open')) {
          isSettled = true;
          clearTimeout(timeout);
          sock?.ev.off('qr', onQr);
          console.log(`[PAIR #${reqId}] State: Ready for pairing`);
          resolve();
        }
        
        if (connection === 'open') {
          console.log(`[PAIR #${reqId}] State: Open - USER PAIRED SUCCESSFULLY!`);
        }
        
        if (connection === 'close') {
          const error = lastDisconnect?.error as any;
          const statusCode = error?.output?.statusCode;
          console.error(`[PAIR #${reqId}] ❌ Disconnect Reason:`, statusCode || 'Unknown', error?.message || '');
          
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            sock?.ev.off('qr', onQr);
            reject(new Error('Connection Closed before opening'));
          } else {
            console.error(`[PAIR #${reqId}] ❌ Connection closed DURING pairing attempt!`);
          }
        }
      };
      
      sock?.ev.on('connection.update', onConnectionUpdate);
      sock?.ev.on('qr', onQr);
    });
    
    // ---- REQUEST PAIRING CODE ----
    console.log(`[PAIR #${reqId}] Requesting pairing code for: ${cleaned}`);
    
    let pairingCode: string;
    try {
      pairingCode = await sock.requestPairingCode(cleaned);
      console.log(`[PAIR #${reqId}] ✅ Code received: ${pairingCode}`);
    } catch (codeErr) {
      console.error(`[PAIR #${reqId}] Pairing error:`, codeErr);
      const errMsg = codeErr instanceof Error ? codeErr.message : String(codeErr);
      if (errMsg.toLowerCase().includes('rate') || errMsg.toLowerCase().includes('already')) {
        throw Object.assign(new Error('Rate Limited'), { statusCode: 429 });
      }
      throw codeErr;
    }
    
    // ---- SEND RESPONSE ----
    const responseData = {
      success: true,
      code: pairingCode,
      number: cleaned,
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
      res.json(responseData);
    }
    
  } catch (error: unknown) {
    const err = error as Error & { statusCode ? : number };
    const errorMsg = err?.message || 'Unknown error';
    console.error(`[PAIR #${reqId}] ❌ ERROR: ${errorMsg}`);
    
    let status = 500;
    let userMsg = 'Failed to generate pairing code. Please try again.';
    
    if (errorMsg.includes('Invalid phone')) {
      status = 400;
      userMsg = 'Invalid phone number format.';
    } else if (errorMsg.includes('Timed Out')) {
      status = 408;
      userMsg = 'Connection timed out. Please try again.';
    } else if (errorMsg.includes('Rate Limited')) {
      status = 429;
      userMsg = 'Too many requests. Please wait a few minutes.';
    } else if (errorMsg.includes('Connection Closed') || errorMsg.includes('Connection Lost')) {
      status = 503;
      userMsg = 'WhatsApp service unavailable. Please try again.';
    } else if (errorMsg.includes('Restart Required')) {
      status = 500;
      userMsg = 'Server temporarily unavailable. Please try again.';
    } else if (errorMsg.includes('Logged Out')) {
      status = 401;
      userMsg = 'Session invalid. Please try again.';
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network') || errorMsg.includes('ENOTFOUND')) {
      status = 503;
      userMsg = 'Network error. Cannot reach WhatsApp.';
    } else if (err?.statusCode) {
      status = err.statusCode;
      if (status === 400) userMsg = 'Invalid phone number format.';
    }
    
    if (!res.headersSent) {
      res.status(status).json({
        success: false,
        error: userMsg,
        timestamp: new Date().toISOString()
      });
    }
  } finally {
    setTimeout(() => {
      cleanup();
    }, 180000); // Kept at 3 minutes so the user has time to type the code
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
  console.log('║      🚀 MARIA-MM PAIRING SERVER v4.4       ║');
  console.log('║      (Baileys v7 + Proxy Bypass)           ║');
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
