#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Table } from 'cmd-table';

const PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_DIR = join(homedir(), '.cache', 'copilot-analytics');
const CACHE_FILE = join(CACHE_DIR, 'pricing.json');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREMIUM_REQUEST_DOLLAR = 0.04;

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchPricing() {
  ensureCacheDir();
  if (existsSync(CACHE_FILE)) {
    const stat = statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  }
  console.error('Fetching pricing data from litellm...');
  const res = await fetch(PRICING_URL);
  if (!res.ok) throw new Error(`Failed to fetch pricing: ${res.status}`);
  const data = await res.json();
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  return data;
}

function getPricingForModel(pricing, modelName) {
  const candidates = [modelName, `openai/${modelName}`, `github_copilot/${modelName}`];
  for (const key of candidates) {
    if (pricing[key]) return pricing[key];
  }
  for (const key of Object.keys(pricing)) {
    if (key.split('/').pop() === modelName) return pricing[key];
  }
  return null;
}

function parseArgs(argv) {
  const args = { fullId: false, sessionPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--full-id') args.fullId = true;
    else if (argv[i] === '--path' && i + 1 < argv.length) args.sessionPath = argv[++i];
  }
  return args;
}

function parseEventsFile(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return events;
}

function extractSessionData(sessionDir) {
  const eventsFile = join(sessionDir, 'events.jsonl');
  if (!existsSync(eventsFile)) return null;
  const events = parseEventsFile(eventsFile);
  let sessionId = null;
  let startTime = null;
  let shutdownData = null;

  for (const ev of events) {
    if (ev.type === 'session.start') {
      sessionId = ev.data?.sessionId;
      startTime = ev.data?.startTime;
    } else if (ev.type === 'session.shutdown') {
      shutdownData = ev.data;
    }
  }
  return { sessionId, startTime, shutdownData };
}

function computeCosts(modelMetrics, pricing) {
  const results = [];
  for (const modelName of Object.keys(modelMetrics)) {
    const metrics = modelMetrics[modelName];
    const usage = metrics.usage || {};
    const reqCost = metrics.requests?.cost ?? 0;
    const p = getPricingForModel(pricing, modelName);

    const inputTokens = (usage.inputTokens || 0) - (usage.cacheReadTokens || 0);
    const cacheReadTokens = usage.cacheReadTokens || 0;
    const cacheWriteTokens = usage.cacheWriteTokens || 0;
    const outputTokens = usage.outputTokens || 0;
    const reasoningTokens = usage.reasoningTokens || 0;

    if (!p) {
      results.push({ model: modelName, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens, cost: reqCost, totalPricing: null });
      continue;
    }

    const inputCostPerToken = p.input_cost_per_token ?? 0;
    const cacheReadCostPerToken = p.cache_read_input_token_cost ?? p.cache_read_input_token_cost_priority ?? inputCostPerToken * 0.1;
    const cacheWriteCostPerToken = p.cache_creation_input_token_cost ?? p.cache_creation_input_token_cost ?? inputCostPerToken;
    const outputCostPerToken = p.output_cost_per_token ?? 0;

    const totalPricing =
      inputTokens * inputCostPerToken +
      cacheReadTokens * cacheReadCostPerToken +
      cacheWriteTokens * cacheWriteCostPerToken +
      outputTokens * outputCostPerToken;

    results.push({ model: modelName, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens, cost: reqCost, totalPricing });
  }
  return results;
}

function fmtNum(n) {
  if (n === null || n === undefined) return 'N/A';
  return n.toLocaleString('en-US');
}

function fmtUSD(n) {
  if (n === null || n === undefined) return 'N/A';
  if (typeof n !== 'number') return String(n);
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function displayId(id, full) {
  return full ? id : id.slice(0, 8) + '…';
}

function displayWidth(value) {
  return Array.from(String(value ?? '')).length;
}

function getColumnWidth(name, key, rows, footer) {
  return Math.max(
    displayWidth(name),
    ...rows.map(row => displayWidth(row[key])),
    displayWidth(footer[key])
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const sessionPath = args.sessionPath || join(homedir(), '.copilot', 'session-state');
  if (!existsSync(sessionPath)) {
    console.error(`Session directory not found: ${sessionPath}`);
    process.exit(1);
  }

  const dirs = readdirSync(sessionPath)
    .map(d => join(sessionPath, d))
    .filter(d => statSync(d).isDirectory());

  const sessions = [];
  const skipped = [];

  for (const dir of dirs) {
    const data = extractSessionData(dir);
    if (!data) continue;
    if (!data.shutdownData) {
      skipped.push(data.sessionId || dir.split('/').pop());
      continue;
    }
    sessions.push(data);
  }

  sessions.sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return ta - tb;
  });

  if (sessions.length === 0 && skipped.length === 0) {
    console.log('No session data found.');
    return;
  }

  const pricing = await fetchPricing();

  const rows = [];
  let grandTotalPricing = 0;
  let grandTotalCost = 0;
  let grandTotalTokens = 0;
  let grandTotalInput = 0;
  let grandTotalCacheWrite = 0;
  let grandTotalCacheRead = 0;
  let grandTotalOutput = 0;
  let grandTotalReasoning = 0;

  for (const session of sessions) {
    const costs = computeCosts(session.shutdownData.modelMetrics, pricing);
    for (const c of costs) {
      const id = displayId(session.sessionId, args.fullId);
      const ts = new Date(session.startTime);
      const timestamp = session.startTime
        ? `${String(ts.getMonth() + 1).padStart(2, '0')}/${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
        : '-';
      const totalTokens = c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens + c.outputTokens;
      const outputStr = c.reasoningTokens > 0
        ? `${fmtNum(c.outputTokens)}(${fmtNum(c.reasoningTokens)})`
        : fmtNum(c.outputTokens);
      const pricingStr = c.totalPricing !== null ? fmtUSD(c.totalPricing) : 'N/A';
      const efficiency = (c.cost > 0 && c.totalPricing !== null)
        ? (c.totalPricing / (c.cost * PREMIUM_REQUEST_DOLLAR)).toFixed(1)
        : '-';
      rows.push({
        id, model: c.model, timestamp, cost: String(c.cost),
        input: fmtNum(c.inputTokens), cacheWrite: fmtNum(c.cacheWriteTokens),
        cacheRead: fmtNum(c.cacheReadTokens), output: outputStr,
        total: fmtNum(totalTokens), pricing: pricingStr, efficiency
      });

      if (c.totalPricing !== null) grandTotalPricing += c.totalPricing;
      grandTotalCost += c.cost;
      grandTotalTokens += totalTokens;
      grandTotalInput += c.inputTokens;
      grandTotalCacheWrite += c.cacheWriteTokens;
      grandTotalCacheRead += c.cacheReadTokens;
      grandTotalOutput += c.outputTokens;
      grandTotalReasoning += c.reasoningTokens;
    }
  }

  const totalEfficiency = grandTotalCost > 0
    ? (grandTotalPricing / (grandTotalCost * PREMIUM_REQUEST_DOLLAR)).toFixed(1)
    : '-';
  const totalOutputStr = grandTotalReasoning > 0
    ? `${fmtNum(grandTotalOutput)}(${fmtNum(grandTotalReasoning)})`
    : fmtNum(grandTotalOutput);

  const footer = {
    id: 'TOTAL',
    cost: String(grandTotalCost),
    input: fmtNum(grandTotalInput),
    cacheWrite: fmtNum(grandTotalCacheWrite),
    cacheRead: fmtNum(grandTotalCacheRead),
    output: totalOutputStr,
    total: fmtNum(grandTotalTokens),
    pricing: fmtUSD(grandTotalPricing),
    efficiency: totalEfficiency
  };

  const table = new Table({
    responsiveMode: 'hide',
    headerColor: 'cyan',
    columns: [
      { name: 'Session ID',       key: 'id',         align: 'left',  priority: 3, width: getColumnWidth('Session ID', 'id', rows, footer) },
      { name: 'Model',            key: 'model',      align: 'left',  priority: 1, width: getColumnWidth('Model', 'model', rows, footer) },
      { name: 'Timestamp',        key: 'timestamp',  align: 'left',  priority: 0, width: getColumnWidth('Timestamp', 'timestamp', rows, footer) },
      { name: 'Input Token',      key: 'input',      align: 'right', priority: 2, width: getColumnWidth('Input Token', 'input', rows, footer) },
      { name: 'CacheWrite',       key: 'cacheWrite', align: 'right', priority: 4, width: getColumnWidth('CacheWrite', 'cacheWrite', rows, footer) },
      { name: 'CacheRead',        key: 'cacheRead',  align: 'right', priority: 4, width: getColumnWidth('CacheRead', 'cacheRead', rows, footer) },
      { name: 'Output Token',     key: 'output',     align: 'right', priority: 2, width: getColumnWidth('Output Token', 'output', rows, footer) },
      { name: 'Total Token',      key: 'total',      align: 'right', priority: 0, width: getColumnWidth('Total Token', 'total', rows, footer) },
      { name: 'Total Pricing',    key: 'pricing',    align: 'right', priority: 0, width: getColumnWidth('Total Pricing', 'pricing', rows, footer) },
      { name: 'Premium Requests', key: 'cost',       align: 'right', priority: 4, width: getColumnWidth('Premium Requests', 'cost', rows, footer) },
      { name: 'Efficiency',       key: 'efficiency', align: 'right', priority: 0, width: getColumnWidth('Efficiency', 'efficiency', rows, footer) },
    ]
  });

  for (const row of rows) {
    table.addRow(row);
  }

  table.setFooter(footer);

  console.log();
  console.log(table.render());
  console.log();

  if (skipped.length > 0) {
    console.log('Skipped (no session.shutdown):');
    for (const sid of skipped) {
      console.log(`  - ${args.fullId ? sid : sid.slice(0, 8) + '…'}`);
    }
    console.log();
  }

  console.log(`Premium request unit price: $${PREMIUM_REQUEST_DOLLAR}`);
  console.log(`Efficiency = Total Pricing / (Cost × $${PREMIUM_REQUEST_DOLLAR})`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
