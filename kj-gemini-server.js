/**
 * KJ Land Surveyors — Server (Gemini Edition)
 * Master Agent Orchestration + WhatsApp + M-Pesa + Google Sheets + PDF Quotes
 * Uses Google Gemini API (free tier)
 *
 * npm install express axios dotenv googleapis node-cron
 * node server.js
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;
const DIRECTOR_PHONE = process.env.DIRECTOR_PHONE;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

// ════════════════════════════════════════════
// IN-MEMORY STORE
// ════════════════════════════════════════════
const clients = [];
const projects = [];
const payments = [];
const log = [];

function addLog(type, data) {
  const entry = { id: Date.now(), type, data, time: new Date().toISOString() };
  log.unshift(entry);
  if (log.length > 200) log.pop();
  return entry;
}

// ════════════════════════════════════════════
// CALL GEMINI
// ════════════════════════════════════════════
async function callGemini(systemPrompt, userMessage) {
  const body = {
    contents: [
      {
        parts: [
          { text: systemPrompt + '\n\nUser: ' + userMessage }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 800,
      temperature: 0.7,
    }
  };

  const res = await axios.post(GEMINI_URL, body, {
    headers: { 'Content-Type': 'application/json' }
  });

  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ════════════════════════════════════════════
// AGENT SYSTEMS
// ════════════════════════════════════════════
const AGENTS = {
  reception: {
    name: 'Reception Agent',
    system: `You are the Reception Agent for KJ Land Surveyors & Realtors Consultants — Kenya's leading ISK-registered land surveying firm across all 47 counties since 2014.

Services: Land Subdivision, Beacon Setting (RTK GPS ±10mm), Title Deed Processing, Land Transfer, GIS Mapping, Topographical Survey, Boundary Dispute Resolution.

Contact: WhatsApp +254 720 397313 | info@kjlandsurveyors.co.ke | Mon-Sat 8am-6pm

Be warm, professional, and concise (2-4 sentences). Ask for their name, county, and what service they need. Guide them toward booking a consultation.`
  },
  quotation: {
    name: 'Quotation Agent',
    system: `You are the Quotation Agent for KJ Land Surveyors. Generate professional line-item quotes in KES, ex-VAT. Respond with ONLY valid JSON:
{"intro":"personalised opening","lineItems":[{"description":"item","amount":12000}],"notes":"scope notes","validDays":30}

Pricing guidance (KES, ex-VAT):
- Survey fieldwork per acre: 20000-35000
- Beacon setting per beacon: 3000-5000
- Mutation documents: 12000-18000
- Title deed processing: 25000-45000
- County approvals: 6000-12000
- GIS mapping per hectare: 8000-15000
- Topographical survey per acre: 15000-25000
- Dispute resolution: 40000-80000`
  },
  master: {
    name: 'Master Agent',
    system: `You are the Master Executive Agent — AI CEO of KJ Land Surveyors. When given a trigger event, create a delegation plan. Respond with ONLY valid JSON:
{"assessment":"one-sentence summary","priority":"high|medium|low","delegations":[{"agent":"reception|quotation|crm|surveyor","task":"specific task","sequence":1}],"director_alert":"message to Director or null"}`
  }
};

// ════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════
async function sendWhatsApp(to, message) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log('WA not configured — would send to', to, ':', message.slice(0, 50));
    return;
  }
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('WhatsApp error:', e.response?.data || e.message);
  }
}

// ════════════════════════════════════════════
// WHATSAPP WEBHOOK
// ════════════════════════════════════════════
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA_VERIFY) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;
    const text = msg.text.body;
    console.log(`📱 Message from ${from}: ${text}`);
    addLog('whatsapp_in', { from, text });

    // Generate reply with Gemini Reception Agent
    const reply = await callGemini(AGENTS.reception.system, text);

    // Save client
    const existing = clients.find(c => c.phone === from);
    if (!existing) {
      clients.push({
        id: `c_${Date.now()}`,
        phone: from,
        firstMessage: text,
        source: 'WhatsApp',
        createdAt: new Date().toISOString()
      });
    }

    // Send reply
    await sendWhatsApp(from, reply);
    addLog('whatsapp_out', { to: from, reply: reply.slice(0, 100) });

    // Notify Director
    if (DIRECTOR_PHONE && from !== DIRECTOR_PHONE) {
      await sendWhatsApp(DIRECTOR_PHONE,
        `📱 *New WhatsApp Enquiry*\n\nFrom: ${from}\nMessage: "${text}"\n\n_KJ AI System_`
      );
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
    addLog('error', { message: err.message });
  }
});

// ════════════════════════════════════════════
// M-PESA STK PUSH
// ════════════════════════════════════════════
async function getMpesaToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) return null;
  const env = process.env.MPESA_ENVIRONMENT === 'production' ?
    'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';
  const res = await axios.get(
    `https://${env}/oauth/v1/generate?grant_type=client_credentials`,
    { auth: { username: key, password: secret } }
  );
  return res.data.access_token;
}

async function stkPush(phone, amount, description) {
  const token = await getMpesaToken();
  if (!token) return { error: 'M-Pesa not configured' };

  const env = process.env.MPESA_ENVIRONMENT === 'production' ?
    'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

  const res = await axios.post(
    `https://${env}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: 'KJ Land Surveyors',
      TransactionDesc: description
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data;
}

app.post('/mpesa/callback', (req, res) => {
  res.sendStatus(200);
  const cb = req.body?.Body?.stkCallback;
  if (!cb) return;
  const success = cb.ResultCode === 0;
  const amount = cb.CallbackMetadata?.Item?.find(i => i.Name === 'Amount')?.Value;
  const code = cb.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
  addLog('mpesa_callback', { success, amount, code });
  if (success && DIRECTOR_PHONE) {
    sendWhatsApp(DIRECTOR_PHONE,
      `💰 *M-Pesa Payment Received*\n\nAmount: KES ${amount}\nCode: ${code}\n\n_KJ AI System_`
    );
  }
});

// ════════════════════════════════════════════
// PDF QUOTE
// ════════════════════════════════════════════
async function generateQuotePDF(client, lineItems, notes) {
  const ref = `KJ-Q-${Date.now().toString().slice(-6)}`;
  const outputDir = path.join(__dirname, 'quotes');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outputPath = path.join(outputDir, `${ref}.pdf`);
  const items = lineItems.map(i => `${i.description}:${i.amount}`).join(',');

  return new Promise((resolve, reject) => {
    execFile('python3', [
      path.join(__dirname, 'generate_quote.py'),
      '--client', client.name || 'Valued Client',
      '--phone',  client.phone || '254720397313',
      '--county', client.county || 'Nairobi',
      '--service', client.service || 'Land Survey',
      '--plot',   client.plotSize || '',
      '--notes',  notes || '',
      '--ref',    ref,
      '--output', outputPath,
      '--items',  items || 'Professional survey services:50000',
    ], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ ref, outputPath, total: lineItems.reduce((s, i) => s + i.amount, 0) });
    });
  });
}

// ════════════════════════════════════════════
// MASTER AGENT ORCHESTRATION
// ════════════════════════════════════════════
app.post('/api/orchestrate', async (req, res) => {
  const { event, client, message } = req.body;
  addLog('orchestration', { event, client: client?.name });
  try {
    const prompt = `Event: ${event}\nClient: ${JSON.stringify(client || {})}\nMessage: "${message || ''}"\nDate: ${new Date().toISOString()}`;
    const raw = await callGemini(AGENTS.master.system, prompt);
    const clean = raw.replace(/```json|```/g, '').trim();
    let plan;
    try { plan = JSON.parse(clean); } catch { plan = { assessment: raw, delegations: [] }; }

    if (plan.director_alert && DIRECTOR_PHONE) {
      await sendWhatsApp(DIRECTOR_PHONE,
        `🤖 *Master Agent Alert*\n\n${plan.director_alert}\n\nPriority: ${plan.priority?.toUpperCase()}\n\n_KJ AI System_`
      );
    }
    addLog('orchestration_done', { plan });
    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════
// QUOTE API
// ════════════════════════════════════════════
app.post('/api/quote/generate', async (req, res) => {
  const { client, lineItems, notes } = req.body;
  if (!client || !lineItems) return res.status(400).json({ error: 'client and lineItems required' });
  try {
    const result = await generateQuotePDF(client, lineItems, notes);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/quote/ai', async (req, res) => {
  const { service, county, plotSize } = req.body;
  try {
    const raw = await callGemini(AGENTS.quotation.system,
      `Service: ${service}, County: ${county}, Plot: ${plotSize}`);
    const clean = raw.replace(/```json|```/g, '').trim();
    const quote = JSON.parse(clean);
    res.json({ success: true, quote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════
// MPESA INITIATE
// ════════════════════════════════════════════
app.post('/api/mpesa/initiate', async (req, res) => {
  const { phone, amount, description } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
  try {
    const result = await stkPush(phone, amount, description || 'KJ Land Survey Payment');
    payments.push({ phone, amount, description, result, time: new Date().toISOString() });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════
// CLIENTS & PROJECTS
// ════════════════════════════════════════════
app.get('/api/clients', (req, res) => res.json({ clients, total: clients.length }));
app.post('/api/clients', (req, res) => {
  const client = { id: `c_${Date.now()}`, ...req.body, createdAt: new Date().toISOString() };
  clients.push(client);
  addLog('client_added', { name: client.name, source: client.source });
  res.json({ success: true, client });
});

app.get('/api/projects', (req, res) => res.json({ projects, total: projects.length }));
app.post('/api/projects', (req, res) => {
  const project = { id: `p_${Date.now()}`, ...req.body, createdAt: new Date().toISOString() };
  projects.push(project);
  res.json({ success: true, project });
});

app.get('/api/payments', (req, res) => res.json({ payments, total: payments.length }));
app.get('/api/log', (req, res) => res.json({ log: log.slice(0, 100) }));

// ════════════════════════════════════════════
// DAILY SUMMARY (call manually or via cron)
// ════════════════════════════════════════════
app.post('/api/trigger/daily-summary', async (req, res) => {
  try {
    const summary = await callGemini(
      'You are a business analyst for KJ Land Surveyors. Write a concise 4-sentence daily briefing.',
      `Date: ${new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}
       New clients today: ${clients.filter(c => c.createdAt?.startsWith(new Date().toISOString().slice(0,10))).length}
       Total clients: ${clients.length}, Projects: ${projects.length}, Payments: ${payments.length}`
    );
    if (DIRECTOR_PHONE) {
      await sendWhatsApp(DIRECTOR_PHONE, `📊 *KJ Daily Summary*\n\n${summary}\n\n_KJ AI System · ${new Date().toLocaleDateString('en-KE')}_`);
    }
    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    ai: 'Google Gemini 1.5 Flash (free)',
    clients: clients.length,
    projects: projects.length,
    payments: payments.length,
    uptime: Math.floor(process.uptime()) + 's',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send('<h2>KJ Land Surveyors AI Server — Online ✅</h2><p><a href="/health">Health Check</a></p>');
});

// ════════════════════════════════════════════
// START
// ════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   KJ Land Surveyors — AI Server              ║
║   Powered by Google Gemini (Free)            ║
╠══════════════════════════════════════════════╣
║   Port:     ${PORT}                               ║
║   AI:       Gemini 1.5 Flash                 ║
║   Webhook:  GET/POST /webhook                ║
║   Health:   GET /health                      ║
╚══════════════════════════════════════════════╝
  `);
});
