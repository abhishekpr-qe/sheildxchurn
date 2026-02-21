const { CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('gemini');

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

/**
 * Call Gemini Flash for bulk risk enrichment.
 * Tries direct Gemini API first, falls back to OpenRouter.
 * Respects ENABLE_GEMINI kill switch — returns null when disabled.
 */
async function callGemini(prompt, { reqId, maxTokens = 600 } = {}) {
  if (!CFG.ENABLE_GEMINI) return null;

  const rlog = reqId ? createLogger('gemini', { req_id: reqId }) : log;

  // Try direct Gemini API
  if (CFG.GEMINI_API_KEY) {
    const result = await callGeminiDirect(prompt, maxTokens, rlog);
    if (result) return result;
  }

  // Fallback: OpenRouter
  if (CFG.OPENROUTER_KEY) {
    return callViaOpenRouter(prompt, OPENROUTER_MODEL, maxTokens, rlog);
  }

  return null;
}

async function callGeminiDirect(prompt, maxTokens, rlog) {
  const startMs = Date.now();
  try {
    const resp = await fetch(`${GEMINI_URL}?key=${CFG.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      rlog.warn('Gemini direct error', { status: resp.status, body: body.slice(0, 200) });
      return null;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const cost = (inputTokens * 0.10 + outputTokens * 0.40) / 1_000_000;

    rlog.info('Gemini direct call', {
      input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: cost.toFixed(6), duration_ms: Date.now() - startMs,
    });

    return { text, tokens: { input: inputTokens, output: outputTokens }, cost };
  } catch (e) {
    rlog.warn('Gemini direct failed', { error: e.message?.slice(0, 80) });
    return null;
  }
}

/**
 * Call any model via OpenRouter (OpenAI-compatible API).
 * Used as fallback when direct API keys fail.
 */
async function callViaOpenRouter(prompt, model, maxTokens, rlog) {
  const startMs = Date.now();
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CFG.OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      rlog.warn('OpenRouter error', { model, status: resp.status, body: body.slice(0, 200) });
      return null;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const cost = (inputTokens * 0.10 + outputTokens * 0.40) / 1_000_000;

    rlog.info('OpenRouter call', {
      model, input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: cost.toFixed(6), duration_ms: Date.now() - startMs,
    });

    return { text, tokens: { input: inputTokens, output: outputTokens }, cost };
  } catch (e) {
    rlog.warn('OpenRouter failed', { model, error: e.message?.slice(0, 80) });
    return null;
  }
}

module.exports = { callGemini, callViaOpenRouter };
