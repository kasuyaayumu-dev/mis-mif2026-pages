// MIF イベントページ用アシスタントチャットボットの中継サーバー
//
// 役割:
//  - OpenAI APIキーをフロント(STUDIO埋め込み)に露出させずに中継する
//  - data/groups.json (日本語) / groups.en.json (英語) の企画情報を定期的に
//    取得してキャッシュし、システムプロンプトとしてLLMに渡す
//  - 「〇〇な企画は？」のような質問にチャット形式で回答するAPIを提供する
//
// 起動: npm install && npm start (事前に .env を用意すること。.env.example参照)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 9877;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const DATA_BASE_URL = process.env.DATA_BASE_URL || 'https://kasuyaayumu-dev.github.io/mis-mif2026-pages/data';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY が設定されていません。.env を確認してください。');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '32kb' }));

// CORS: STUDIOの公開ドメインのみ許可(ALLOWED_ORIGINSが空の場合は開発用に全許可)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  }
}));

// 乱用防止: 1分あたりのリクエスト数を制限
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらくしてから再度お試しください。' }
});

// ---- 企画データのキャッシュ ----
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分
const cache = { ja: { data: null, fetchedAt: 0 }, en: { data: null, fetchedAt: 0 } };

async function fetchGroups(lang) {
  const entry = cache[lang];
  const now = Date.now();
  if (entry.data && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.data;
  }
  const url = lang === 'en' ? `${DATA_BASE_URL}/groups.en.json` : `${DATA_BASE_URL}/groups.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`企画データの取得に失敗しました (${res.status})`);
  const json = await res.json();
  entry.data = json;
  entry.fetchedAt = now;
  return json;
}

function buildSystemPrompt(groupsData, lang) {
  const items = groupsData.items || [];
  const lines = items.map(it => {
    const name = it.name || '';
    const group = it.group || '';
    const category = it.category || '';
    const format = it.format || '';
    const desc = it.description || '';
    return `- ${name} | ${group} | ${category} | ${format} | ${desc}`;
  });

  if (lang === 'en') {
    return [
      'You are a friendly assistant for MIF (Mita International Science Academy school festival) 2026.',
      'Answer visitor questions about projects/booths using ONLY the list below. Each line is:',
      '"Project name | Group/Club | Category | Format | Short description".',
      'If asked things like "any dance projects?" or "what food is sold?", search the list and reply',
      'concisely in a friendly tone, listing matching project names and a one-line reason for each.',
      'If nothing matches, say so honestly. Do not invent projects that are not in the list.',
      'Keep answers reasonably short and in English.',
      '',
      '## Project list',
      ...lines
    ].join('\n');
  }

  return [
    'あなたはMIF(三田国際科学学園 文化祭)2026のイベントページに設置された案内アシスタントです。',
    '以下の企画リストの情報「のみ」を使って、来場者からの質問に答えてください。各行の形式は',
    '「企画名 | 団体名 | カテゴリ | 形式 | 短い説明」です。',
    '「ダンス系の企画ある？」「食べ物を売ってる企画は？」のような質問には、リストの中から',
    '当てはまりそうな企画を探し、企画名と一言理由を添えて親しみやすい口調で簡潔に答えてください。',
    '該当がなければ正直にその旨を伝えてください。リストにない企画を創作しないでください。',
    '回答は日本語で、なるべく簡潔にしてください。',
    '',
    '## 企画リスト',
    ...lines
  ].join('\n');
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { message, lang, history } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message は必須です。' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'メッセージが長すぎます(1000文字以内)。' });
    }

    const safeLang = lang === 'en' ? 'en' : 'ja';
    const safeHistory = Array.isArray(history) ? history.slice(-10) : [];

    const groupsData = await fetchGroups(safeLang);
    const systemPrompt = buildSystemPrompt(groupsData, safeLang);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...safeHistory
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content.slice(0, 1000) })),
      { role: 'user', content: message }
    ];

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 600
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI API error:', openaiRes.status, errText);
      return res.status(502).json({ error: 'AIサーバーへの問い合わせに失敗しました。' });
    }

    const openaiJson = await openaiRes.json();
    const reply = openaiJson.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({ error: 'AIから有効な回答が得られませんでした。' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(500).json({ error: 'サーバー内部エラーが発生しました。' });
  }
});

app.listen(PORT, () => {
  console.log(`MIF chatbot server listening on port ${PORT}`);
});
