/**
 * KJ Land Surveyors — Phase 4 Server
 * Master Agent Orchestration + PDF Quote Generation + Agent-to-Agent Automation
 *
 * npm install express axios dotenv
 * pip install reportlab
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

const PORT = process.env.PORT || 5000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const DIRECTOR_PHONE = process.env.DIRECTOR_PHONE;

// ════════════════════════════════════════════════
// AGENT REGISTRY — every agent's persona & tools
// ════════════════════════════════════════════════
const AGENTS = {
  master: {
    name: 'Master Executive Agent',
    emoji: '🧠',
    system: `You are the Master Executive Agent — AI CEO of KJ Land Surveyors. When given a client enquiry or trigger event, you respond with a JSON delegation plan. Always respond with ONLY valid JSON, no other text.

Format:
{
  "assessment": "one-sentence situation summary",
  "priority": "high|medium|low",
  "delegations": [
    {
      "agent": "agent_key",
      "task": "specific task description",
      "data": { "any": "relevant data to pass" },
      "sequence": 1
    }
  ],
  "director_alert": "message to send to Director (or null)"
}

Available agents: reception, quotation, crm, surveyor, invoicing, social, reporting, knowledge`
  },
  reception: {
    name: 'Reception Agent',
    emoji: '👋',
    system: `You are the Reception Agent for KJ Land Surveyors. Qualify client enquiries professionally. Extract: name, county, service, plot size. Respond warmly. Output a JSON summary at the end: <!--QUALIFIED:{"name":"","county":"","service":"","plotSize":"","readyForQuote":true}-->`
  },
  quotation: {
    name: 'Quotation Agent',
    emoji: '📄',
    system: `You are the Quotation Agent for KJ Land Surveyors. Generate detailed, professional line-item quotes based on service type and plot size. Always respond with ONLY valid JSON:
{
  "intro": "1-sentence personalised opening",
  "lineItems": [
    { "description": "item description", "amount": 12000 }
  ],
  "notes": "scope notes for the PDF",
  "validDays": 30,
  "depositPercent": 50
}

Pricing guidance (KES, ex-VAT):
- Survey fieldwork per acre: 20000-35000 (terrain/distance factor)
- Beacon setting per beacon: 3000-5000
- Mutation documents: 12000-18000
- Title deed processing: 25000-45000
- County approvals: 6000-12000
- Land transfer stamp duty: 4% of value (client pays separately)
- GIS mapping per hectare: 8000-15000
- Topographical survey per acre: 15000-25000
- Dispute resolution: 40000-80000`
  },
  crm: {
    name: 'CRM Agent',
    emoji: '📞',
    system: `You are the CRM & Follow-Up Agent for KJ Land Surveyors. Schedule follow-ups, draft follow-up messages, track client touchpoints. Respond with JSON:
{
  "followUpDate": "YYYY-MM-DD",
  "followUpMessage": "WhatsApp message to send to client",
  "internalNote": "note for the CRM record",
  "reminderDays": [3, 7, 14]
}`
  },
  surveyor: {
    name: 'Survey Planner Agent',
    emoji: '🗺️',
    system: `You are the Survey Planner Agent for KJ Land Surveyors. Schedule field surveys across Kenya's 47 counties. Respond with JSON:
{
  "scheduledDate": "YYYY-MM-DD",
  "estimatedDays": 2,
  "teamRequired": "2 surveyors + 1 GPS operator",
  "equipment": ["Trimble RTK GPS", "Leica Total Station"],
  "travelNote": "logistics note for field team",
  "mileage": "estimated km from Nairobi hub"
}`
  },
  invoicing: {
    name: 'Invoicing Agent',
    emoji: '💳',
    system: `You are the Invoicing Agent for KJ Land Surveyors. Prepare invoice summaries and payment instructions. Respond with JSON:
{
  "invoiceRef": "KJ-INV-XXXXXX",
  "depositAmount": 0,
  "depositDue": "YYYY-MM-DD",
  "paymentInstructions": "M-Pesa or bank details message",
  "reminderSchedule": ["3 days before due", "on due date"]
}`
  },
  reporting: {
    name: 'Reporting Agent',
    emoji: '📋',
    system: `You are the Reporting Agent for KJ Land Surveyors. Log events, generate status reports. Respond with JSON:
{
  "logEntry": "formatted log message",
  "reportSummary": "1-2 sentence summary",
  "flagged": false,
  "flagReason": null
}`
  }
};

// ════════════════════════════════════════════════
// ORCHESTRATION LOG
// ════════════════════════════════════════════════
const orchestrationLog = [];
const quoteHistory = [];

function logEvent(type, data) {
  const entry = { id: `evt_${Date.now()}`, type, data, timestamp: new Date().toISOString() };
  orchestrationLog.unshift(entry);
  if (orchestrationLog.length > 200) orchestrationLog.pop();
  return entry;
}

// ════════════════════════════════════════════════
// CALL ANY AGENT
// ════════════════════════════════════════════════
async function callAgent(agentKey, prompt, parseJson = false) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);

  logEvent('agent_call', { agent: agentKey, prompt: prompt.slice(0, 100) });

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: agent.system,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });

  const text = res.data.content.map(b => b.text || '').join('');
  logEvent('agent_response', { agent: agentKey, response: text.slice(0, 200) });

  if (parseJson) {
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      console.error(`JSON parse error from ${agentKey}:`, e.message);
      return { raw: text };
    }
  }
  return text;
}

// ════════════════════════════════════════════════
// MASTER AGENT ORCHESTRATION
// ════════════════════════════════════════════════
async function orchestrate(trigger) {
  const { event, client, message } = trigger;
  console.log(`\n🧠 Master Agent triggered: ${event}`);
  logEvent('orchestration_start', { event, client: client?.name });

  // Step 1 — Master Agent creates delegation plan
  const masterPrompt = `Event: ${event}
Client: ${JSON.stringify(client || {})}
Message: "${message || ''}"
Date: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}

Create a delegation plan for this KJ Land Surveyors event.`;

  const plan = await callAgent('master', masterPrompt, true);
  logEvent('delegation_plan', plan);
  console.log(`📋 Delegation plan: ${plan.delegations?.length || 0} tasks, priority: ${plan.priority}`);

  const results = {};

  // Step 2 — Execute delegations in sequence order
  if (plan.delegations) {
    const sorted = [...plan.delegations].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    for (const delegation of sorted) {
      const { agent, task, data } = delegation;
      console.log(`  → Delegating to ${agent}: ${task}`);
      logEvent('delegation_execute', { agent, task });

      try {
        const agentPrompt = `Task: ${task}
Client: ${JSON.stringify({ ...client, ...data })}
Context: ${plan.assessment}`;

        const result = await callAgent(agent, agentPrompt, true);
        results[agent] = result;
        logEvent('delegation_result', { agent, result });

        // Special actions based on agent results
        if (agent === 'quotation' && result.lineItems) {
          // Auto-generate PDF quote
          const pdf = await generateQuotePDF(client, result);
          results.quotePDF = pdf;
          logEvent('quote_pdf_generated', { ref: pdf.ref, path: pdf.path });
          console.log(`  ✅ PDF quote generated: ${pdf.ref}`);
        }

      } catch (err) {
        console.error(`  ❌ ${agent} error:`, err.message);
        results[agent] = { error: err.message };
        logEvent('delegation_error', { agent, error: err.message });
      }

      // Small delay between agents
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Step 3 — Notify Director
  if (plan.director_alert && DIRECTOR_PHONE) {
    const alert = `🤖 *MASTER AGENT BRIEFING*\n\n${plan.director_alert}\n\n📊 *Agents Activated:* ${plan.delegations?.map(d => AGENTS[d.agent]?.emoji + d.agent).join(', ') || 'none'}\n🎯 *Priority:* ${plan.priority?.toUpperCase()}\n⏰ ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n\n_KJ AI Orchestration System_`;
    await sendWhatsApp(DIRECTOR_PHONE, alert);
    logEvent('director_notified', { message: plan.director_alert });
  }

  logEvent('orchestration_complete', { event, agentsUsed: Object.keys(results) });
  return { plan, results };
}

// ════════════════════════════════════════════════
// PDF QUOTE GENERATION (calls Python script)
// ════════════════════════════════════════════════
async function generateQuotePDF(client, quoteData) {
  const ref = `KJ-Q-${Date.now().toString().slice(-6)}`;
  const outputDir = path.join(__dirname, 'quotes');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outputPath = path.join(outputDir, `${ref}.pdf`);

  const items = (quoteData.lineItems || [])
    .map(i => `${i.description}:${i.amount}`)
    .join(',');

  return new Promise((resolve, reject) => {
    execFile('python3', [
      path.join(__dirname, 'generate_quote.py'),
      '--client', client?.name || 'Valued Client',
      '--phone',  client?.phone || '254720397313',
      '--county', client?.county || 'Nairobi',
      '--service', client?.service || 'Land Survey',
      '--plot',   client?.plotSize || '',
      '--email',  client?.email || '',
      '--notes',  quoteData.notes || '',
      '--ref',    ref,
      '--output', outputPath,
      '--items',  items || 'Professional land survey services:50000',
    ], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        const record = {
          ref, outputPath,
          client: client?.name,
          service: client?.service,
          total: (quoteData.lineItems || []).reduce((s, i) => s + i.amount, 0),
          createdAt: new Date().toISOString(),
          lineItems: quoteData.lineItems,
        };
        quoteHistory.unshift(record);
        resolve(record);
      }
    });
  });
}

// ════════════════════════════════════════════════
// WHATSAPP
// ════════════════════════════════════════════════
async function sendWhatsApp(to, message) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  try {
    await axios.post(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('WA error:', e.message); }
}

// ════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════

// Trigger Master Agent orchestration
app.post('/api/orchestrate', async (req, res) => {
  try {
    const result = await orchestrate(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate PDF quote directly
app.post('/api/quote/generate', async (req, res) => {
  const { client, lineItems, notes } = req.body;
  if (!client || !lineItems) return res.status(400).json({ error: 'client and lineItems required' });
  try {
    const pdf = await generateQuotePDF(client, { lineItems, notes });
    res.json({ success: true, ...pdf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download a quote PDF
app.get('/api/quote/:ref/download', (req, res) => {
  const record = quoteHistory.find(q => q.ref === req.params.ref);
  if (!record) return res.status(404).json({ error: 'Quote not found' });
  res.download(record.outputPath, `${record.ref}.pdf`);
});

// Call a specific agent directly
app.post('/api/agent/:key', async (req, res) => {
  const { key } = req.params;
  const { prompt, parseJson } = req.body;
  if (!AGENTS[key]) return res.status(404).json({ error: 'Agent not found' });
  try {
    const result = await callAgent(key, prompt, parseJson !== false);
    res.json({ success: true, agent: key, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get orchestration log
app.get('/api/log', (req, res) => {
  res.json({ log: orchestrationLog.slice(0, 100), total: orchestrationLog.length });
});

// Get quote history
app.get('/api/quotes', (req, res) => {
  res.json({ quotes: quoteHistory, total: quoteHistory.length });
});

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'online', phase: 4,
    agents: Object.keys(AGENTS).length,
    orchestrations: orchestrationLog.filter(e => e.type === 'orchestration_complete').length,
    quotesGenerated: quoteHistory.length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   KJ Land Surveyors — Phase 4 Server                 ║
║   Master Agent Orchestration + PDF Quotes            ║
╠══════════════════════════════════════════════════════╣
║   Port:           ${PORT}                                 ║
║   Agents:         ${Object.keys(AGENTS).length} registered                       ║
║   Orchestrate:    POST /api/orchestrate              ║
║   Generate PDF:   POST /api/quote/generate           ║
║   Agent direct:   POST /api/agent/:key               ║
║   Log:            GET  /api/log                      ║
╚══════════════════════════════════════════════════════╝
  `);
});
