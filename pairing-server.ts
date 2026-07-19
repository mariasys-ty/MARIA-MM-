/**
 * MARIA PAIRING SERVER v4.1 - FIXED & CLEAN
 */
import pino from 'pino';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 7700;
const logger = pino({ level: 'silent' });
// App Config
const appConfig = {
  BOT_NAME: 'MARIA-MM',
  PREFIX: '.',
  CREATOR: '256743668990',
  FOOTER: 'markmellon the creater',
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

// Serve pairing website
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'maria-pairing-site', 'index.html'));
});

// Config endpoint
app.get('/api/config', function(req, res) {
  res.json({
    BOT_NAME: appConfig.BOT_NAME,
    PREFIX: appConfig.PREFIX,
    CREATOR: appConfig.CREATOR,
    FOOTER: appConfig.FOOTER,
    GROUP_LINK: appConfig.GROUP_INVITE_LINK,
    status: 'online'
  });
});

// Health check
app.get('/health', function(req, res) {
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
app.post('/pair', async function(req, res) {
  
  const reqId = Date.now().toString(36);
  const { number } = req.body;
  let sock = null;
  
  console.log('[PAIR] #' + reqId + ' Request for:', number);

  try {
    // ---- VALIDATION ----
    if (!number) {
      return res.status(400).json({
        success: false,
        error: 'Phone number required'
      });
    }

    const cleaned = String(number).replace(/[^0-9]/g, '');
    
    if (!cleaned || cleaned.length < 8 || cleaned.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number (8-15 digits with country code)'
      });
    }

    console.log('[PAIR] Cleaned number:', cleaned);

    // ---- SETUP TEMP FOLDER ----
    const tempFolder = path.join(__dirname, 'temp_' + reqId);

    if (fs.existsSync(tempFolder)) {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(tempFolder, { recursive: true });

    // ---- IMPORT BAILEYS ----
    console.log('[PAIR] Loading baileys...');
    
    let baileys;
    
    try {
      baileys = await import('@whiskeysockets/baileys');
      console.log('[PAIR] Using @whiskeysockets/baileys');
    } catch (e) {
      try {
        baileys = await import('baileys');
        console.log('[PAIR] Using baileys');
      } catch (e2) {
        console.error('[PAIR] ❌ BAILEYS NOT FOUND!');
        return res.status(500).json({
          success: false,
          error: 'Baileys not installed! Run: npm install @whiskeysockets/baileys'
        });
      }
    }

    const makeWASocket = baileys.default?.makeWASocket || baileys.makeWASocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const DisconnectReason = baileys.DisconnectReason;
    const Browsers = baileys.Browsers;

    if (!makeWASocket || !useMultiFileAuthState) {
      return res.status(500).json({
        success: false,
        error: 'Invalid baileys installation'
      });
    }

    // ---- CREATE AUTH STATE ----
    console.log('[PAIR] Creating auth state...');
   const { state, saveCreds } = await useMultiFileAuthState(tempFolder);

 // ---- CREATE SOCKET ----
console.log('[PAIR] Creating socket...');

sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  logger,
  browser: Browsers ? Browsers.ubuntu('MARIA-MM') : ['MARIA-MM', 'Chrome', '1.0'],
  markOnlineOnConnect: false,
  connectTimeoutMs: 30000,
  keepAliveIntervalMs: 25000
});

// Save authentication credentials
sock.ev.on('creds.update', saveCreds);

    // ---- REQUEST PAIRING CODE ----
    console.log('[PAIR] Requesting code for:', cleaned);
    
    let pairingCode;
    
    try {
      pairingCode = await sock.requestPairingCode(cleaned);
      console.log('[PAIR] ✅ Code received:', pairingCode);
    } catch (codeErr) {
      const errMsg = codeErr?.message || String(codeErr);
      console.error('[PAIR] Code error:', errMsg);
      
      if (errMsg.includes('already') || errMsg.includes('rate')) {
        return res.status(429).json({
          success: false,
          error: 'Rate limited! Wait 5 minutes.'
        });
      }
      
      return res.status(500).json({
        success: false,
        error: 'Failed to get code: ' + errMsg
      });
    }

    // ---- CLEANUP SOCKET IMMEDIATELY ----
    // We don't need to wait for connection - just send the code
    try {
      if (sock?.ev) {
        sock.ev.removeAllListeners('connection.update');
      }
      if (typeof sock?.end === 'function') {
        await sock.end();
      }
    } catch (cleanupErr) {
      console.log('[PAIR] Cleanup done');
    }

    // ---- SCHEDULE TEMP FOLDER CLEANUP ----
    setTimeout(function() {
      try {
        if (fs.existsSync(tempFolder)) {
          fs.rmSync(tempFolder, { recursive: true, force: true });
          console.log('[PAIR] Cleaned up temp folder');
        }
      } catch (e) {}
    }, 30000);

    // ============================================
    // ✅ SUCCESS RESPONSE - THIS WAS MISSING!
    // ============================================
    return res.json({
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
        '4. Enter: ' + pairingCode,
        '5. Join group: ' + appConfig.GROUP_INVITE_LINK
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMsg = error?.message || 'Unknown error';
    
    console.error('[PAIR] ❌ ERROR:', errorMsg);

    // Cleanup socket on error
    try {
      if (sock?.ev) {
        sock.ev.removeAllListeners('connection.update');
      }
      if (typeof sock?.end === 'function') {
        sock.end();
      }
    } catch (e) {}

    let status = 500;
    let userMsg = errorMsg;

    if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
      status = 408;
      userMsg = 'Connection timed out. Check internet and retry.';
    } else if (errorMsg.includes('Rate limited') || errorMsg.includes('RATE_LIMITED')) {
      status = 429;
      userMsg = 'Too many requests! Wait 5 minutes.';
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('Network')) {
      status = 503;
      userMsg = 'Network error. Cannot reach WhatsApp.';
    }

    if (!res.headersSent) {
      return res.status(status).json({
        success: false,
        error: userMsg,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// ============================================
// ERROR HANDLING
// ============================================

app.use(function(err, req, res, next) {
  console.error('[SERVER] Error:', err?.message || err);
  
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.use(function(req, res) {
  res.status(404).json({
    success: false,
    error: 'Not found: ' + req.method + ' ' + req.url
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║                                            ║');
  console.log('║      🚀 MARIA-MM PAIRING SERVER v4.1       ║');
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