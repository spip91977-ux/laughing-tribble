/**
 * KJ Land Surveyors — Phase 3 Server
 * Google Sheets Auto-Sync + M-Pesa Daraja STK Push + Daily AI Summary
 *
 * npm install express axios dotenv googleapis node-cron
 * node server.js
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════
const {
  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SPREADSHEET_ID,

  // M-Pesa Daraja
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_PASSKEY,
  MPESA_SHORTCODE,          // Your till/paybill number
  MPESA_CALLBACK_URL,       // Your server URL + /mpesa/callback
  MPESA_ENVIRONMENT,        // 'sandbox' or 'production'

  // Anthropic
  ANTHROPIC_API_KEY,

  // WhatsApp (for daily summary delivery)
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  DIRECTOR_PHONE,
} = process.env;

// ════════════════════════════════════════════════
// IN-MEMORY STORES (replace with DB in production)
// ════════════════════════════════════════════════
const clients    = [];
const projects   = [];
const payments   = [];
const syncLog    = [];

// ════════════════════════════════════════════════
// GOOGLE SHEETS SETUP
// ════════════════════════════════════════════════
function getGoogleAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function appendToSheet(sheetName, values) {
  try {
    const auth = await getGoogleAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
    const entry = { sheet: sheetName, values, timestamp: new Date().toISOString(), status: 'success' };
    syncLog.unshift(entry);
    console.log(`✅ Synced to Sheet "${sheetName}":`, values[0]);
    return true;
  } catch (err) {
    const entry = { sheet: sheetName, values, timestamp: new Date().toISOString(), status: 'error', error: err.message };
    syncLog.unshift(entry);
    console.error(`❌ Sheet sync error (${sheetName}):`, err.message);
    return false;
  }
}

async function updateCellInSheet(sheetName, range, value) {
  try {
    const auth = await getGoogleAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: `${sheetName}!${range}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
    return true;
  } catch (err) {
    console.error('Sheet update error:', err.message);
    return false;
  }
}

// Sheet: Clients
async function syncClientToSheet(client) {
  return appendToSheet('Clients', [
    client.id || '',
    client.name || '',
    client.phone || '',
    client.email || '',
    client.county || '',
    client.service || '',
    client.plotSize || '',
    client.status || 'Enquiry',
    client.source || 'Manual',
    client.addedAt || new Date().toISOString(),
    client.notes || '',
  ]);
}

// Sheet: Projects
async function syncProjectToSheet(project) {
  return appendToSheet('Projects', [
    project.id || '',
    project.title || '',
    project.clientName || '',
    project.clientPhone || '',
    project.service || '',
    project.county || '',
    project.plotSize || '',
    project.stage || 'Consultation',
    project.created || new Date().toISOString(),
    project.notes || '',
  ]);
}

// Sheet: Payments
async function syncPaymentToSheet(payment) {
  return appendToSheet('Payments', [
    payment.id || '',
    payment.clientName || '',
    payment.phone || '',
    payment.amount || '',
    payment.service || '',
    payment.mpesaCode || '',
    payment.status || '',
    payment.timestamp || new Date().toISOString(),
    payment.description || '',
  ]);
}

// ════════════════════════════════════════════════
// M-PESA DARAJA
// ════════════════════════════════════════════════
const MPESA_BASE = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getMpesaToken() {
  const credentials = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  return res.data.access_token;
}

function getMpesaPassword() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const raw = `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`;
  const password = Buffer.from(raw).toString('base64');
  return { password, timestamp };
}

/**
 * Initiate STK Push to client's phone
 * @param {string} phone   - Client phone e.g. 254712345678
 * @param {number} amount  - Amount in KES
 * @param {string} desc    - Payment description
 * @param {string} ref     - Your internal reference
 */
async function initiateSTKPush(phone, amount, desc, ref) {
  const token = await getMpesaToken();
  const { password, timestamp } = getMpesaPassword();

  const res = await axios.post(
    `${MPESA_BASE}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount),
      PartyA: phone,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: ref,
      TransactionDesc: desc,
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

// M-Pesa STK Push endpoint
app.post('/api/mpesa/initiate', async (req, res) => {
  const { phone, amount, clientName, service, description } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });

  try {
    const ref = `KJ-${Date.now().toString().slice(-6)}`;
    const result = await initiateSTKPush(phone, amount, description || `KJ Land Surveyors - ${service}`, ref);

    const payment = {
      id: ref,
      clientName: clientName || 'Unknown',
      phone,
      amount,
      service: service || '',
      description: description || '',
      status: 'Pending',
      checkoutId: result.CheckoutRequestID,
      timestamp: new Date().toISOString(),
    };
    payments.unshift(payment);

    // Sync to Payments sheet immediately
    await syncPaymentToSheet(payment);

    res.json({ success: true, ref, checkoutId: result.CheckoutRequestID, message: 'STK Push sent to client phone' });
  } catch (err) {
    console.error('STK Push error:', err.response?.data || err.message);
    res.status(500).json({ error: 'STK Push failed', details: err.response?.data || err.message });
  }
});

// M-Pesa callback (Safaricom calls this when payment completes)
app.post('/mpesa/callback', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body?.Body?.stkCallback;
    const checkoutId = body?.CheckoutRequestID;
    const resultCode = body?.ResultCode;
    const items = body?.CallbackMetadata?.Item || [];

    const getItem = (name) => items.find(i => i.Name === name)?.Value;

    const mpesaCode = getItem('MpesaReceiptNumber');
    const amount = getItem('Amount');
    const phone = getItem('PhoneNumber');

    const pIdx = payments.findIndex(p => p.checkoutId === checkoutId);
    if (pIdx >= 0) {
      payments[pIdx].status = resultCode === 0 ? 'Completed' : 'Failed';
      payments[pIdx].mpesaCode = mpesaCode || '';
      payments[pIdx].completedAt = new Date().toISOString();

      // Update sheet
      await syncPaymentToSheet({ ...payments[pIdx], status: payments[pIdx].status, mpesaCode });

      // Notify director via WhatsApp
      if (resultCode === 0 && DIRECTOR_PHONE) {
        const msg = `✅ *M-PESA PAYMENT RECEIVED*\n\n👤 ${payments[pIdx].clientName}\n📱 +${phone}\n💰 KES ${amount?.toLocaleString()}\n🧾 Code: ${mpesaCode}\n🏗️ ${payments[pIdx].service}\n\n_KJ Land Surveyors Payment System_`;
        await sendWhatsApp(DIRECTOR_PHONE, msg);
      }

      console.log(`💰 Payment ${resultCode === 0 ? 'COMPLETED' : 'FAILED'}: ${mpesaCode} KES ${amount}`);
    }
  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ════════════════════════════════════════════════
// GOOGLE SHEETS INIT (create headers on first run)
// ════════════════════════════════════════════════
async function initSheetHeaders() {
  try {
    const auth = await getGoogleAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetDefs = [
      {
        name: 'Clients',
        headers: ['ID','Name','Phone','Email','County','Service','Plot Size','Status','Source','Added At','Notes'],
      },
      {
        name: 'Projects',
        headers: ['ID','Title','Client Name','Client Phone','Service','County','Plot Size','Stage','Created','Notes'],
      },
      {
        name: 'Payments',
        headers: ['ID','Client Name','Phone','Amount (KES)','Service','M-Pesa Code','Status','Timestamp','Description'],
      },
      {
        name: 'Daily Summary',
        headers: ['Date','New Clients','Active Projects','Completed Projects','Payments Received','Total Revenue (KES)','Summary','Generated At'],
      },
    ];

    const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SPREADSHEET_ID });
    const existingSheets = meta.data.sheets.map(s => s.properties.title);

    for (const def of sheetDefs) {
      if (!existingSheets.includes(def.name)) {
        // Create sheet tab
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: GOOGLE_SPREADSHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: def.name } } }] },
        });
      }
      // Write headers to row 1
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SPREADSHEET_ID,
        range: `${def.name}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [def.headers] },
      });
    }
    console.log('✅ Google Sheets initialised with all tabs and headers');
  } catch (err) {
    console.error('❌ Sheet init error:', err.message);
  }
}

// ════════════════════════════════════════════════
// DAILY AI SUMMARY (runs every morning at 7:00 AM EAT)
// ════════════════════════════════════════════════
async function generateDailySummary() {
  console.log('📊 Generating daily AI summary...');

  const today = new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' });
  const todayClients = clients.filter(c => c.addedAt?.startsWith(new Date().toISOString().slice(0,10)));
  const activeProjects = projects.filter(p => p.stage !== 'Completed');
  const completedToday = projects.filter(p => p.stage === 'Completed');
  const todayPayments = payments.filter(p => p.status === 'Completed' && p.timestamp?.startsWith(new Date().toISOString().slice(0,10)));
  const totalRevenue = todayPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  // Ask Claude to write the summary
  let summaryText = '';
  try {
    const prompt = `You are the Reporting Agent for KJ Land Surveyors & Realtors Consultants. Write a concise, professional daily morning briefing for the Director based on this data:

Date: ${today}
New clients today: ${todayClients.length}
Client details: ${JSON.stringify(todayClients.map(c=>({name:c.name,county:c.county,service:c.service})))}
Active projects: ${activeProjects.length}
Completed projects: ${completedToday.length}
Payments received today: ${todayPayments.length}
Total revenue today: KES ${totalRevenue.toLocaleString()}
Active project stages: ${JSON.stringify(activeProjects.slice(0,5).map(p=>({title:p.title,stage:p.stage,client:p.clientName})))}

Write a 4–6 sentence briefing. Mention highlights, flag anything urgent, and end with one recommendation for the day. Be professional, warm, and data-driven.`;

    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    summaryText = res.data.content.map(b => b.text || '').join('');
  } catch (err) {
    summaryText = `Daily summary for ${today}: ${todayClients.length} new clients, ${activeProjects.length} active projects, KES ${totalRevenue.toLocaleString()} revenue.`;
  }

  // Sync to Daily Summary sheet
  await appendToSheet('Daily Summary', [
    today,
    todayClients.length,
    activeProjects.length,
    completedToday.length,
    todayPayments.length,
    totalRevenue,
    summaryText,
    new Date().toISOString(),
  ]);

  // Send to Director via WhatsApp
  if (DIRECTOR_PHONE) {
    const waMsg = `📊 *KJ DAILY BRIEFING — ${today}*\n\n${summaryText}\n\n📈 *Quick Stats:*\n👥 New clients: ${todayClients.length}\n📁 Active projects: ${activeProjects.length}\n✅ Completed: ${completedToday.length}\n💰 Revenue: KES ${totalRevenue.toLocaleString()}\n\n_KJ Land Surveyors AI System_`;
    await sendWhatsApp(DIRECTOR_PHONE, waMsg);
    console.log('📱 Daily summary sent to Director via WhatsApp');
  }

  console.log(`✅ Daily summary generated and synced for ${today}`);
}

// Schedule daily summary at 7:00 AM East Africa Time
cron.schedule('0 7 * * *', generateDailySummary, { timezone: 'Africa/Nairobi' });

// ════════════════════════════════════════════════
// WHATSAPP HELPER
// ════════════════════════════════════════════════
async function sendWhatsApp(to, message) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('WhatsApp send error:', err.message);
  }
}

// ════════════════════════════════════════════════
// REST API — Clients
// ════════════════════════════════════════════════
app.get('/api/clients', (req, res) => res.json({ clients, total: clients.length }));

app.post('/api/clients', async (req, res) => {
  const client = { id: 'c_' + Date.now(), addedAt: new Date().toISOString(), source: 'Dashboard', ...req.body };
  clients.unshift(client);
  const synced = await syncClientToSheet(client);
  res.json({ success: true, client, synced });
});

// ════════════════════════════════════════════════
// REST API — Projects
// ════════════════════════════════════════════════
app.get('/api/projects', (req, res) => res.json({ projects, total: projects.length }));

app.post('/api/projects', async (req, res) => {
  const project = { id: 'p_' + Date.now(), created: new Date().toISOString(), ...req.body };
  projects.unshift(project);
  const synced = await syncProjectToSheet(project);
  res.json({ success: true, project, synced });
});

app.patch('/api/projects/:id', async (req, res) => {
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  projects[idx] = { ...projects[idx], ...req.body };
  await syncProjectToSheet(projects[idx]);
  res.json({ success: true, project: projects[idx] });
});

// ════════════════════════════════════════════════
// REST API — Payments
// ════════════════════════════════════════════════
app.get('/api/payments', (req, res) => res.json({ payments, total: payments.length }));

// ════════════════════════════════════════════════
// REST API — Sync Log
// ════════════════════════════════════════════════
app.get('/api/sync-log', (req, res) => res.json({ log: syncLog.slice(0, 50) }));

// ════════════════════════════════════════════════
// REST API — Manual triggers
// ════════════════════════════════════════════════
app.post('/api/trigger/daily-summary', async (req, res) => {
  await generateDailySummary();
  res.json({ success: true, message: 'Daily summary generated and sent' });
});

app.post('/api/trigger/init-sheets', async (req, res) => {
  await initSheetHeaders();
  res.json({ success: true, message: 'Sheets initialised' });
});

// ════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════
app.get('/health', (req, res) => res.json({
  status: 'online',
  phase: 3,
  clients: clients.length,
  projects: projects.length,
  payments: payments.length,
  syncLog: syncLog.length,
  uptime: process.uptime(),
  nextSummary: '07:00 EAT daily',
  timestamp: new Date().toISOString(),
}));

// ════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   KJ Land Surveyors — Phase 3 Server                 ║
║   Google Sheets + M-Pesa + Daily AI Summary          ║
╠══════════════════════════════════════════════════════╣
║   Port:           ${PORT}                                 ║
║   Sheets sync:    Auto on every write                ║
║   M-Pesa STK:     POST /api/mpesa/initiate           ║
║   Daily summary:  07:00 EAT (cron)                   ║
║   Health:         GET  /health                       ║
╚══════════════════════════════════════════════════════╝
  `);
  // Auto-init sheet headers on startup
  if (GOOGLE_SPREADSHEET_ID) await initSheetHeaders();
});
