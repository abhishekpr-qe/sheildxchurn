const fs = require('fs');
const path = require('path');
const { CFG } = require('../config');
const { data, userIndex, liveData, sentimentCache } = require('./cache');
const { parseCSV } = require('../lib/csv-parser');
const { createLogger } = require('../lib/logger');
const log = createLogger('sentiment');

const ROOT = path.join(__dirname, '..', '..');

// Decagon conversation data (loaded from CSV)
const decagonData = {};
try {
  const csvPath = path.join(ROOT, 'data', 'decagon_conversations.csv');
  if (fs.existsSync(csvPath)) {
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const parsed = parseCSV(csvText);
    const headers = parsed[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h.trim()] = i; });

    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      const userId = (r[colIdx['user_id']] || '').trim();
      if (!userId) continue;

      const conv = {
        conversation_id: r[colIdx['conversation_id']] || '',
        user_id: userId,
        destination: r[colIdx['destination']] || '',
        created_at: r[colIdx['created_at']] || '',
        summary: (r[colIdx['summary']] || '').trim(),
        resolution: (r[colIdx['resolution']] || '').trim(),
        flow_type: r[colIdx['flow_type']] || '',
        csat_rating: r[colIdx['csat_rating']] || '',
        meta_country: r[colIdx['meta_country']] || '',
        meta_order_id: r[colIdx['meta_order_id']] || '',
        meta_first_name: r[colIdx['meta_first_name']] || '',
        meta_last_name: r[colIdx['meta_last_name']] || '',
      };

      const msgsRaw = r[colIdx['messages']] || '';
      try {
        const msgs = JSON.parse(msgsRaw);
        conv.user_messages = msgs
          .filter(m => m.role === 'USER' && m.text && !m.text.startsWith('Uploaded file'))
          .map(m => m.text)
          .slice(0, 10);
        conv.ai_messages = msgs
          .filter(m => m.role === 'AI' && m.text)
          .map(m => m.text)
          .slice(0, 5);
        conv.message_count = msgs.length;
      } catch (e) {
        conv.user_messages = [];
        conv.ai_messages = [];
        conv.message_count = 0;
      }

      if (!conv.summary && conv.user_messages.length) {
        conv.summary = 'User wrote: ' + conv.user_messages.slice(0, 3).join(' | ');
      }

      if (!decagonData[userId]) decagonData[userId] = [];
      decagonData[userId].push(conv);
    }

    for (const uid of Object.keys(decagonData)) {
      decagonData[uid].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    log.info('Decagon CSV loaded', { users: Object.keys(decagonData).length, conversations: parsed.length - 1 });
  }
} catch (e) {
  log.warn('Decagon CSV load skipped', { error: e.message });
}

function getDecagonConversations(userId) {
  if (decagonData[userId]?.length) return decagonData[userId];
  if (liveData.decagon_conversations?.rows?.length) {
    return liveData.decagon_conversations.rows.filter(r => r.user_id === userId);
  }
  return (data.user_sentiment || {})[userId]?.conversations || [];
}

const PAIN_KEYWORDS = {
  'transaction failed': 'Transaction failures',
  'failed': 'Transaction failures',
  'stuck': 'Stuck transactions',
  'slow': 'Slow delivery',
  'delay': 'Delivery delays',
  'taking longer': 'Delivery delays',
  'not received': 'Money not received',
  'not credited': 'Not credited to beneficiary',
  'not been credited': 'Not credited to beneficiary',
  'pending': 'Pending transfer',
  'processing': 'Still processing',
  'still processing': 'Long processing time',
  'error': 'System errors',
  'fee': 'Fee concerns',
  'rate': 'Exchange rate issues',
  'expensive': 'Pricing concerns',
  'refund': 'Refund requests',
  'cancel': 'Cancellation requests',
  'kyc': 'KYC/verification issues',
  'verification': 'Verification difficulties',
  'phone number': 'Account issues',
  'cannot': 'Access issues',
  "can't": 'Access issues',
  'support': 'Support experience issues',
  'wait': 'Long wait times',
  'waiting': 'Long wait times',
  'frustrat': 'User frustration',
  'urgent': 'Urgency expressed',
  'not working': 'App functionality issues',
  'wrong': 'Incorrect transaction details',
  'lost': 'Lost funds concern',
  'where is my money': 'Money whereabouts unknown',
  'not gon': 'Money not received',
  'escalat': 'Issue escalated',
};

const NEGATIVE_WORDS = ['frustrated', 'angry', 'upset', 'disappointed', 'terrible', 'worst', 'never', 'refund', 'cancel', 'lost', 'fail', 'error', 'stuck', 'broken', 'pending', 'delay', 'not received', 'not credited', 'taking longer', 'waiting', 'urgent', 'escalat', 'where is my money', 'not gon', 'why my money'];

function ruleBasedSentiment(userId, conversations) {
  const allText = conversations.map(c => {
    const parts = [c.conversation_summary || c.summary || '', c.resolution || ''];
    if (c.user_messages) parts.push(c.user_messages.join(' '));
    return parts.join(' ');
  }).join(' ').toLowerCase();

  const painPoints = [];
  for (const [keyword, label] of Object.entries(PAIN_KEYWORDS)) {
    if (allText.includes(keyword) && !painPoints.includes(label)) painPoints.push(label);
  }

  const negCount = NEGATIVE_WORDS.filter(w => allText.includes(w)).length;
  const sentiment = negCount >= 4 ? 'frustrated' : negCount >= 2 ? 'negative' : negCount >= 1 ? 'concerned' : 'neutral';

  return {
    user_id: userId,
    has_conversations: true,
    conversation_count: conversations.length,
    last_interaction: conversations[0]?.created_at || conversations[0]?.date || null,
    sentiment,
    pain_points: painPoints.slice(0, 5),
    summary: `User had ${conversations.length} support interaction(s). ${painPoints.length ? 'Key concerns: ' + painPoints.slice(0, 3).join(', ') + '.' : 'No major pain points detected.'}`,
    churn_signal: negCount >= 2 ? 'yes' : negCount >= 1 ? 'maybe' : 'no',
    urgency: negCount >= 3 ? 'immediate' : negCount >= 1 ? 'soon' : 'monitor',
    conversations: conversations.slice(0, 3).map(c => ({
      date: c.created_at || c.date,
      channel: c.channel || c.flow_type || c.destination,
      status: c.resolution ? 'resolved' : (c.resolution_status || c.status || 'open'),
      summary: c.conversation_summary || c.summary || (c.user_messages ? c.user_messages.join(' | ') : ''),
      resolution: c.resolution || null,
      rating: c.csat_rating || c.rating || null,
      order_id: c.meta_order_id || null,
      user_messages: c.user_messages || [],
    })),
  };
}

/**
 * Build sentiment analysis prompt from conversations and user context.
 * @param {Array} conversations - User support conversations
 * @param {Object|null} user - User data (may be null)
 * @returns {string} Prompt for LLM sentiment analysis
 */
function buildSentimentPrompt(conversations, user) {
  const convContext = conversations.slice(0, 3).map((c, i) => {
    const summaryText = c.conversation_summary || c.summary || '';
    const userMsgs = c.user_messages ? c.user_messages.join(' | ') : '';
    const resText = c.resolution || '';
    const rating = c.csat_rating || c.rating || '';
    return `Conversation ${i + 1} (${c.created_at || c.date || 'recent'}, ${c.channel || c.flow_type || c.destination || 'unknown'}, order: ${c.meta_order_id || 'N/A'}):\nSummary: ${summaryText || 'N/A'}\nUser messages: ${userMsgs || 'N/A'}\nResolution: ${resText || 'N/A'}\nCSAT: ${rating || 'N/A'}`;
  }).join('\n\n');

  return `Analyze these customer support conversations for a cross-border remittance user. Extract:\n1. Overall sentiment (positive/neutral/negative/frustrated)\n2. Pain points (list each specific issue)\n3. A 2-sentence summary of customer experience\n4. Risk signal: does this suggest the user is likely to churn? (yes/maybe/no)\n5. Urgency: how urgently should retention team act? (immediate/soon/monitor)\n\nUser context: ${user ? `${user.corridor} corridor, ${user.tenure_days}d tenure, ${user.total_txns} transactions, risk tier: ${user.risk_tier}` : 'unknown'}\n\nConversations:\n${convContext}\n\nRespond in JSON format: {"sentiment":"...","pain_points":["..."],"summary":"...","churn_signal":"...","urgency":"..."}`;
}

/**
 * Parse LLM sentiment response into structured result.
 * @param {string} text - Raw LLM response text
 * @param {string} userId - User ID
 * @param {Array} conversations - User conversations
 * @returns {Object} Parsed sentiment result
 */
function parseSentimentResponse(text, userId, conversations) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let analysis = {};
  if (jsonMatch) {
    try { analysis = JSON.parse(jsonMatch[0]); } catch (e) { /* fallback below */ }
  }
  return {
    user_id: userId,
    has_conversations: true,
    conversation_count: conversations.length,
    last_interaction: conversations[0]?.created_at || conversations[0]?.date || null,
    last_channel: conversations[0]?.channel || conversations[0]?.flow_type || conversations[0]?.destination || null,
    last_rating: conversations[0]?.csat_rating || conversations[0]?.rating || null,
    sentiment: analysis.sentiment || 'unknown',
    pain_points: analysis.pain_points || [],
    summary: analysis.summary || text.slice(0, 300),
    churn_signal: analysis.churn_signal || 'unknown',
    urgency: analysis.urgency || 'monitor',
    conversations: conversations.slice(0, 3).map(c => ({
      date: c.created_at || c.date,
      channel: c.channel || c.flow_type || c.destination,
      status: c.resolution ? 'resolved' : (c.resolution_status || c.status || 'open'),
      summary: c.conversation_summary || c.summary || (c.user_messages ? c.user_messages.join(' | ') : ''),
      resolution: c.resolution || null,
      rating: c.csat_rating || c.rating || null,
      order_id: c.meta_order_id || null,
      user_messages: c.user_messages || [],
    })),
  };
}

async function analyzeSentiment(userId, { reqId } = {}) {
  const rlog = reqId ? createLogger('sentiment', { req_id: reqId }) : log;
  if (sentimentCache[userId]) return sentimentCache[userId];

  const conversations = getDecagonConversations(userId);
  const user = userIndex[userId];

  if ((data.user_sentiment || {})[userId]) {
    sentimentCache[userId] = data.user_sentiment[userId];
    return sentimentCache[userId];
  }

  if (!conversations.length) {
    return { user_id: userId, has_conversations: false, sentiment: 'unknown', pain_points: [], summary: 'No support conversations found.' };
  }

  if (CFG.AI_KEY) {
    try {
      const prompt = buildSentimentPrompt(conversations, user);
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.AI_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await resp.json();
      const result = parseSentimentResponse(d.content?.[0]?.text || '', userId, conversations);
      sentimentCache[userId] = result;
      return result;
    } catch (e) {
      rlog.error('Sentiment analysis error', { userId, error: e.message });
    }
  }

  const result = ruleBasedSentiment(userId, conversations);
  sentimentCache[userId] = result;
  return result;
}

module.exports = {
  decagonData,
  getDecagonConversations,
  analyzeSentiment,
  ruleBasedSentiment,
  buildSentimentPrompt,
  parseSentimentResponse,
  PAIN_KEYWORDS,
  NEGATIVE_WORDS,
};
