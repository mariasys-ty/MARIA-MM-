/**
 * MARIA BOT - PRODUCTION READY v4.0
 * Connected to index.ts / pairing-server.ts Backend
 * 
 * ✅ Clean, Modular, Production-Ready
 * ✅ No duplicate functions or listeners
 * ✅ Fully cross-device compatible
 */

'use strict';

// ============================================
// 🎯 GLOBAL CONFIG & STATE
// ============================================
const appConfig = {
  BOT_NAME: 'MARIA-MM',
  PREFIX: '.',
  CREATOR: '256743668990',
  FOOTER: 'MarkMellon the Creator',
  MODE: 'public',
  API_BASE_URL: window.location.origin
};

let isLoading = false;

// ============================================
// 🛠️ DOM UTILITIES & CACHE
// ============================================
const elements = {};

function cacheDomElements() {
  elements.numberInput = document.getElementById('number');
  elements.countryCode = document.getElementById('countryCode');
  elements.generateBtn = document.getElementById('generateBtn');
  elements.resultDiv = document.getElementById('result');
  elements.form = document.querySelector('.pairing-form');
  elements.steps = document.querySelectorAll('.step');
  elements.navbar = document.querySelector('.navbar');
  elements.navLinks = document.querySelectorAll('.nav-link');
  elements.backToTop = document.getElementById('backToTop');
  elements.autoCopy = document.getElementById('autoCopy');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function shakeElement(el) {
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetHeight; // Trigger reflow
  el.style.animation = 'shake 0.5s ease';
  setTimeout(() => { if (el) el.style.animation = ''; }, 500);
}

// ============================================
// 🔔 TOAST NOTIFICATION SYSTEM
// ============================================
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || 'fa-info-circle'} toast-icon"></i>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close"><i class="fas fa-times"></i></button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentElement) {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast.parentElement) toast.remove(); }, 300);
    }
  }, 3500);
}

// ============================================
// 🔐 CLIPBOARD FUNCTIONS
// ============================================
function safeCopyToClipboard(text, successMsg = 'Copied! ✓') {
  if (!text) {
    showToast('Nothing to copy', 'error');
    return;
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, 'success');
    }).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (success) {
      showToast(successMsg, 'success');
    } else {
      showCopyPopup(text);
    }
  } catch (err) {
    showCopyPopup(text);
  }
}

function showCopyPopup(text) {
  const existing = document.getElementById('copy-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'copy-popup';
  popup.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    z-index:999999; background:#1a1a2e; color:#00ff88; border:2px solid #00ffcc;
    padding:20px; border-radius:16px; font-family:monospace; font-size:14px;
    max-width:90vw; width:400px; box-shadow:0 20px 60px rgba(0,0,0,0.8);
  `;
  popup.innerHTML = `
    <div style="font-weight:bold; margin-bottom:10px; color:#fff;">
      <i class="fas fa-info-circle"></i> Select & Copy (Ctrl+C):
    </div>
    <textarea readonly style="width:100%; height:120px; background:#0f0f23; color:#0f0; border:1px solid #333; border-radius:8px; padding:10px; font-size:13px; resize:none;">${escapeHtml(text)}</textarea>
    <div style="margin-top:10px; text-align:center;">
      <button class="close-popup" style="background:#00ffcc; color:#000; border:none; padding:8px 24px; border-radius:8px; cursor:pointer; font-weight:bold;">Close</button>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  const ta = popup.querySelector('textarea');
  const closeBtn = popup.querySelector('.close-popup');
  
  if (ta) setTimeout(() => { ta.select(); ta.focus(); }, 100);
  if (closeBtn) closeBtn.addEventListener('click', () => popup.remove());
  
  setTimeout(() => { if (document.body.contains(popup)) popup.remove(); }, 15000);
  showToast('Text selected - press Ctrl+C to copy', 'info');
}

// ============================================
// 💾 SESSION MANAGEMENT
// ============================================
function downloadSessionFile() {
  const ta = document.getElementById('sessionData');
  if (!ta || !ta.value) {
    showToast('No session to download', 'error');
    return;
  }

  try {
    const blob = new Blob([ta.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(appConfig.BOT_NAME || 'bot').toLowerCase()}-session-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded!', 'success');
  } catch (err) {
    showToast('Download failed', 'error');
  }
}

function saveSessionToBrowser() {
  const ta = document.getElementById('sessionData');
  if (!ta || !ta.value) {
    showToast('No session data', 'error');
    return;
  }

  try {
    localStorage.setItem(`${appConfig.BOT_NAME || 'bot'}_session`, ta.value);
    showToast('Saved to browser!', 'success');
  } catch (err) {
    showToast('Could not save', 'error');
  }
}

// ============================================
// 📺 UI RENDERING FUNCTIONS
// ============================================
function showSuccessResult(code, session, fullNumber) {
  if (!elements.resultDiv) return;
  
  const safeCode = escapeHtml(code) || '';
  const safeSession = escapeHtml(session) || '{}';
  const botName = appConfig.BOT_NAME || 'MARIA-MM';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date().toLocaleString();

  elements.resultDiv.innerHTML = `
    <div class="success-container">
      <div class="success-header">
        <div class="success-icon-large">✅</div>
        <h3>${escapeHtml(botName)} Connected!</h3>
        <p class="success-subtitle">Pairing Code Generated Successfully</p>
      </div>

      <div class="code-display">
        <div class="code-label">Your 8-Digit Code</div>
        <div class="code-value">${safeCode.toUpperCase().split('').join(' ')}</div>
        <button class="copy-code-btn" data-copy-code="${safeCode}">
          <i class="fas fa-copy"></i> Copy Code
        </button>
      </div>

      <div class="session-id-container">
        <div class="chat-bubble received">
          <div class="chat-header">
            <span class="chat-name">👤 ${escapeHtml(botName)}</span>
            <span class="chat-time">${timeStr}</span>
          </div>
          
          <div class="chat-message">
            <p class="chat-text">
              <span class="mention">MARKMELLON</span><br>
              <strong>${safeCode.toUpperCase()}</strong><br><br>
              
              <div class="session-id-highlight">
                <span class="checkmark">✅</span>
                <strong>SESSION ID</strong>
                <span class="checkmark">✅</span>
              </div>
            </p>
          </div>
          
          <div class="session-meta">
            <h4>💾 Session Information</h4>
            
            <div class="session-details">
              <div class="detail-item">
                <span class="detail-label">📱 Session:</span>
                <code class="code-value short-session">${safeSession.substring(0, 25)}...</code>
                <button class="copy-mini-btn copy-session-trigger" title="Copy full session">
                  <i class="fas fa-copy"></i>
                </button>
              </div>

              <div class="detail-item">
                <span class="detail-label">🔗 Full Session:</span>
                <textarea id="sessionData" readonly>${safeSession}</textarea>
                <button class="download-btn download-trigger">
                  <i class="fas fa-download"></i> Download JSON
                </button>
              </div>

              <div class="detail-item">
                <span class="detail-label">⏰️ Expires:</span>
                <span class="warning-text">~2 minutes</span>
              </div>

              <div class="detail-item">
                <span class="detail-label">👤 Bot:</span>
                <span class="detail-value">${escapeHtml(botName)}</span>
              </div>

              <div class="detail-item">
                <span class="detail-label">📱 For Number:</span>
                <span class="detail-value">${escapeHtml(fullNumber)}</span>
              </div>

              <div class="detail-item">
                <span class="detail-label">🕐 Generated:</span>
                <span class="detail-value">${dateStr}</span>
              </div>
            </div>

            <div class="action-buttons-row">
              <button class="btn-secondary reset-trigger">
                <i class="fas fa-redo"></i> Generate New Code
              </button>
              
              <a href="https://wa.me/${appConfig.CREATOR}" target="_blank" class="btn-primary">
                <i class="fab fa-whatsapp"></i> Contact Support
              </a>
            </div>

            <div class="session-warning">
              <p>⚠️ Save this session securely!</p>
              <p>You'll need it to reconnect.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="instructions-box">
        <h4><i class="fas fa-info-circle"></i> How to Link:</h4>
        <ol>
          <li>Open <strong>WhatsApp</strong></li>
          <li><strong>Settings → Linked Devices</strong></li>
          <li>Tap <strong>"Link a Device"</strong></li>
          <li>Enter code above</li>
        </ol>
      </div>

      <div class="result-footer">
        <p class="result-footer-text">✨ Generated at ${dateStr}</p>
      </div>
    </div>
  `;
  
  elements.resultDiv.classList.remove('hidden');
  
  // Attach event listeners to newly created elements
  elements.resultDiv.querySelector('.copy-code-btn').addEventListener('click', (e) => {
    const codeToCopy = e.currentTarget.getAttribute('data-copy-code');
    safeCopyToClipboard(codeToCopy, 'Code copied!');
  });

  elements.resultDiv.querySelector('.copy-session-trigger').addEventListener('click', () => {
    const ta = document.getElementById('sessionData');
    if (ta && ta.value) safeCopyToClipboard(ta.value, 'Session copied!');
    else showToast('No session data', 'error');
  });

  elements.resultDiv.querySelector('.download-trigger').addEventListener('click', downloadSessionFile);
  elements.resultDiv.querySelector('.reset-trigger').addEventListener('click', resetAll);
  
  setTimeout(() => {
    if (elements.resultDiv) {
      elements.resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 150);
}

function showErrorResult(message) {
  if (!elements.resultDiv) return;

  elements.resultDiv.innerHTML = `
    <div class="result-error">
      <div class="error-icon">❌</div>
      <h3>Error Occurred</h3>
      <p>${escapeHtml(message)}</p>
      <div class="error-help">
        <h4>Solutions:</h4>
        <ul>
          <li>✓ Make sure server is running</li>
          <li>✓ Check number format (with country code like +256)</li>
          <li>✓ Ensure WhatsApp installed on phone</li>
          <li>✓ Wait 2-3 minutes before retrying</li>
        </ul>
      </div>
      <button class="retry-btn reset-trigger">
        <i class="fas fa-redo"></i> Try Again
      </button>
    </div>
  `;
  elements.resultDiv.classList.remove('hidden');
  
  const resetBtn = elements.resultDiv.querySelector('.reset-trigger');
  if (resetBtn) resetBtn.addEventListener('click', resetAll);
}

function resetAll() {
  if (elements.numberInput) {
    elements.numberInput.value = '';
    const group = elements.numberInput.closest('.input-group');
    if (group) group.classList.remove('valid', 'invalid');
  }
  
  if (elements.resultDiv) {
    elements.resultDiv.classList.add('hidden');
    elements.resultDiv.innerHTML = '';
  }
  
  updateProgress(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (elements.numberInput) elements.numberInput.focus();
}

function setLoadingState(loading) {
  isLoading = loading;
  if (elements.generateBtn) {
    elements.generateBtn.disabled = loading;
    elements.generateBtn.classList.toggle('loading', loading);
  }
}

function updateProgress(step) {
  if (!elements.steps) return;
  elements.steps.forEach((el, i) => {
    if (!el) return;
    el.classList.remove('active', 'completed');
    if (i + 1 < step) el.classList.add('completed');
    if (i + 1 === step) el.classList.add('active');
  });
}

// ============================================
// 🎯 VALIDATION & API
// ============================================
function validateInput(number) {
  if (!elements.numberInput) return false;
  
  const group = elements.numberInput.closest('.input-group');
  if (group) group.classList.remove('valid', 'invalid');

  if (!number || number.length < 6) {
    showToast('Enter valid phone number (6+ digits)', 'error');
    if (group) group.classList.add('invalid');
    shakeElement(elements.numberInput);
    return false;
  }

  if (!/^\d+$/.test(number)) {
    showToast('Numbers only please!', 'error');
    if (group) group.classList.add('invalid');
    return false;
  }

  if (number.length > 15) {
    showToast('Max 15 digits allowed', 'error');
    if (group) group.classList.add('invalid');
    return false;
  }

  if (group) group.classList.add('valid');
  return true;
}

async function generateCode() {
  if (!elements.numberInput || isLoading) {
    showToast('Form not ready or already processing', 'error');
    return;
  }

  const rawNumber = (elements.numberInput.value || '').trim();
  const countryCode = (elements.countryCode && elements.countryCode.value) ? elements.countryCode.value : '+256';
  const fullNumber = countryCode + rawNumber;

  if (!validateInput(rawNumber)) return;

  setLoadingState(true);
  updateProgress(2);

  try {
    showToast('Connecting to server...', 'info');
    const response = await fetch(`${appConfig.API_BASE_URL}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ number: fullNumber })
    });

    if (!response.ok) {
      let errorData = {};
      try { errorData = await response.json(); } catch (e) {}
      throw new Error(errorData.error || `Server returned ${response.status}`);
    }

    let data = {};
    try { data = await response.json(); } catch (e) {
      throw new Error('Invalid response from server');
    }

    if (data.error) throw new Error(data.error);

    showSuccessResult(data.code, data.session || '{}', fullNumber);

    if (elements.autoCopy && elements.autoCopy.checked) {
      setTimeout(() => safeCopyToClipboard(data.code, 'Code auto-copied!'), 500);
    }

  } catch (error) {
    console.error('[Generate Error]', error.message || error);
    let errorMessage = error.message || 'Failed to generate code';
    
    if (errorMessage.includes('TIMEOUT')) errorMessage = 'Connection timed out. Check internet and retry.';
    else if (errorMessage.includes('RATE_LIMITED')) errorMessage = 'Too many requests! Wait 5 minutes before trying again.';
    else if (errorMessage.includes('NETWORK_ERROR') || errorMessage.includes('Failed to fetch')) errorMessage = 'Network error. Cannot reach server.';
    
    showErrorResult(errorMessage);
    showToast(errorMessage, 'error');
    updateProgress(1);
  } finally {
    setLoadingState(false);
  }
}

// ============================================
// 📱 COUNTRY CODE HANDLER
// ============================================
function updatePlaceholder() {
  if (!elements.countryCode || !elements.numberInput) return;
  
  const code = elements.countryCode.value;
  const placeholders = {
    '+256': '712345678', '+254': '712345678', '+255': '712345678',
    '+27': '821234567', '+234': '8123456789', '+20': '10123456789',
    '+213': '551234567', '+249': '912345678', '+250': '712345678',
    '+260': '912345678', '+263': '712345678', '+264': '612345678',
    '+265': '912345678', '+267': '71234567', '+268': '75123456',
    '+230': '51234567', '+231': '812345678', '+233': '241234567',
    '+235': '612345678', '+237': '612345678', '+243': '991234567',
    '+244': '912345678', '+245': '77123456', '+252': '61234567',
    '+253': '22123456', '+257': '79123456', '+258': '84123456',
    '+91': '9876543210', '+86': '13800138000', '+81': '9012345678',
    '+82': '1012345678', '+66': '812345678', '+60': '123456789',
    '+62': '81234567890', '+84': '912345678', '+63': '9171234567',
    '+880': '1712345678', '+92': '3012345678', '+93': '701234567',
    '+94': '771234567', '+95': '912345678', '+961': '71123456',
    '+962': '791234567', '+964': '7912345678', '+965': '51234567',
    '+966': '512345678', '+967': '712345678', '+968': '99123456',
    '+971': '501234567', '+972': '501234567', '+973': '37123456',
    '+974': '331234567', '+975': '17123456', '+976': '88123456',
    '+977': '9812345678', '+850': '1912345678', '+852': '51234567',
    '+853': '61234567', '+855': '112345678', '+856': '20123456',
    '+886': '912345678', '+992': '912345678', '+993': '61234567',
    '+994': '501234567', '+995': '51234567', '+996': '312123456',
    '+998': '971234567', '+44': '7911234567', '+49': '15123456789',
    '+33': '612345678', '+39': '3123456789', '+34': '612345678',
    '+31': '612345678', '+32': '471234567', '+46': '701234567',
    '+47': '91234567', '+351': '912345678', '+352': '621123456',
    '+353': '851234567', '+355': '691234567', '+356': '79123456',
    '+357': '99123456', '+358': '50123456', '+359': '88123456',
    '+36': '20123456', '+380': '391234567', '+381': '61234567',
    '+385': '991234567', '+386': '31234567', '+387': '61123456',
    '+389': '70123456', '+40': '712345678', '+41': '79123456',
    '+43': '661234567', '+420': '123456789', '+421': '912345678',
    '+48': '512345678', '+30': '6912345678', '+90': '5012345678',
    '+7': '9123456789', '+1': '5551234567', '+52': '55123456789',
    '+54': '1112345678', '+55': '11999999999', '+56': '912345678',
    '+57': '3012345678', '+58': '412345678', '+51': '912345678',
    '+501': '5123456', '+502': '51234567', '+503': '71234567',
    '+504': '91234567', '+505': '81234567', '+506': '51234567',
    '+507': '6123456', '+591': '71234567', '+592': '6123456',
    '+593': '991234567', '+595': '96123456', '+598': '99123456',
    '+599': '91234567', '+61': '412345678', '+64': '211234567',
    '+65': '81234567', '+673': '2123456', '+674': '551234',
    '+675': '71234567', '+676': '21434', '+677': '123456',
    '+678': '212345', '+679': '712345', '+680': '2471234',
    '+681': '281234', '+682': '71234', '+683': '4123',
    '+685': '7212345', '+686': '3012345', '+687': '281234',
    '+688': '20123', '+689': '401234', '+690': '2143',
    '+691': '2312345', '+692': '2471234', '+670': '4123456', '+671': '7123456'
  };
  
  const placeholder = placeholders[code] || '712345678';
  
  if (elements.numberInput.placeholder !== placeholder) {
    elements.numberInput.style.opacity = '0';
    elements.numberInput.style.transition = 'opacity 0.15s ease';
    
    setTimeout(() => {
      elements.numberInput.placeholder = placeholder;
      elements.numberInput.style.opacity = '1';
      elements.numberInput.title = `Example: ${code} ${placeholder}`;
    }, 150);
  }
  
  const exampleEl = document.getElementById('exampleFormat');
  if (exampleEl) {
    exampleEl.textContent = `${code} ${placeholder}`;
    exampleEl.style.transform = 'scale(1.05)';
    exampleEl.style.color = '#00ffcc';
    exampleEl.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      exampleEl.style.transform = 'scale(1)';
      exampleEl.style.color = '';
    }, 300);
  }
}

function highlightCountryChange() {
  if (!elements.countryCode) return;
  const selector = elements.countryCode.closest('.country-selector');
  if (!selector) return;
  
  selector.style.boxShadow = '0 0 20px rgba(0, 255, 204, 0.5)';
  selector.style.borderColor = '#00ffcc';
  selector.style.transition = 'all 0.3s ease';
  
  setTimeout(() => {
    selector.style.boxShadow = '';
    selector.style.borderColor = '';
  }, 500);
}

// ============================================
// 🎬 UI INTERACTIONS & ANIMATIONS
// ============================================
function initScrollEffects() {
  window.addEventListener('scroll', () => {
    if (elements.navbar) elements.navbar.classList.toggle('scrolled', window.scrollY > 50);
    if (elements.backToTop) elements.backToTop.classList.toggle('visible', window.scrollY > 500);
  }, { passive: true });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        const nav = document.querySelector('.nav-links');
        if (nav) nav.classList.remove('open');
      }
    });
  });
}

function initAnimations() {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          if (entry.target) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
          }
        }, i * 80);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.info-card, .feature-card, .testimonial-card, .timeline-item, .faq-item').forEach(el => {
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      el.style.transition = 'opacity 0.6s, transform 0.6s';
      observer.observe(el);
    }
  });
}

// ============================================
// 🚀 INITIALIZATION & CONFIG
// ============================================
async function loadAppConfig() {
  try {
    const response = await fetch(`${appConfig.API_BASE_URL}/api/config`);
    if (!response.ok) throw new Error('API unavailable');
    const data = await response.json();
    Object.assign(appConfig, data);
    console.log('%c✅ Config loaded from server', 'color:#00ffcc');
  } catch (error) {
    console.log('%cℹ️ Using default config (backend may be starting...)', 'color:#888');
    if (typeof window.MARIA_CONFIG !== 'undefined') {
      Object.assign(appConfig, window.MARIA_CONFIG);
    }
  }
}

function initUIWithConfig() {
  try {
    if (appConfig.BOT_NAME) {
      document.title = `${appConfig.BOT_NAME} • Pairing Code`;
      document.querySelectorAll('.logo-text').forEach(el => {
        el.innerHTML = `${appConfig.BOT_NAME}<span class="highlight">BOT</span>`;
      });
      const title = document.querySelector('.main-title .gradient-text');
      if (title) title.textContent = appConfig.BOT_NAME;
      const sub = document.querySelector('.subtitle');
      if (sub) sub.textContent = `Link your WhatsApp to ${appConfig.BOT_NAME}`;
    }

    const fLogo = document.querySelector('.footer-logo span:last-child');
    if (fLogo && appConfig.BOT_NAME) fLogo.textContent = appConfig.BOT_NAME;

    const fDesc = document.querySelector('.footer-description');
    if (fDesc && appConfig.FOOTER) fDesc.textContent = appConfig.FOOTER;
  } catch (e) {
    console.warn('UI init error:', e.message);
  }
}

function setupEventListeners() {
  // Generate button
  if (elements.generateBtn) {
    elements.generateBtn.addEventListener('click', generateCode);
  }

  // Input validation & enter key
  if (elements.numberInput) {
    elements.numberInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !isLoading) generateCode();
    });
    elements.numberInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  }

  // Country code
  if (elements.countryCode) {
    elements.countryCode.addEventListener('change', () => {
      updatePlaceholder();
      highlightCountryChange();
    });
    elements.countryCode.addEventListener('touchend', () => {
      setTimeout(() => { updatePlaceholder(); highlightCountryChange(); }, 100);
    }, { passive: true });
  }

  // Global UI toggles
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.getAttribute('data-action');
      if (action === 'toggle-options') {
        const content = document.getElementById('advancedContent');
        if (content) content.classList.toggle('open');
        e.currentTarget.classList.toggle('open');
      } else if (action === 'toggle-theme') {
        const html = document.documentElement;
        const icon = e.currentTarget.querySelector('i');
        if (html.dataset.theme === 'dark') {
          html.dataset.theme = 'light';
          if (icon) icon.className = 'fas fa-sun';
        } else {
          html.dataset.theme = 'dark';
          if (icon) icon.className = 'fas fa-moon';
        }
      } else if (action === 'toggle-mobile-menu') {
        const nav = document.querySelector('.nav-links');
        if (nav) nav.classList.toggle('open');
      } else if (action === 'scroll-top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (action === 'toggle-faq') {
        const item = e.currentTarget.parentElement;
        document.querySelectorAll('.faq-item').forEach(f => { if (f !== item) f.classList.remove('active'); });
        if (item) item.classList.toggle('active');
      }
    });
  });
}

async function init() {
  cacheDomElements();
  setupEventListeners();
  initScrollEffects();
  initAnimations();
  
  await loadAppConfig();
  initUIWithConfig();
  
  if (elements.countryCode) {
    if (!elements.countryCode.value) elements.countryCode.value = '+256';
    updatePlaceholder();
  }
  
  setTimeout(() => { if (elements.numberInput) elements.numberInput.focus(); }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Dynamic shake style injection
const shakeStyle = document.createElement('style');
shakeStyle.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-10px)}50%{transform:translateX(10px)}75%{transform:translateX(-10px)}}';
document.head.appendChild(shakeStyle);

// Console Branding
console.log('%c🧿 %c MARIA BOT %c v4.0 %c PRODUCTION READY ', 
  'color:#00ffcc;font-size:20px;font-weight:bold;',
  'color:white;font-size:20px;font-weight:bold;',
  'color:#ff00cc;font-size:20px;font-weight:bold;',
  'color:#888;font-size:11px;'
);
