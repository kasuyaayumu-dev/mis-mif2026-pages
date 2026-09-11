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
const ICON_BASE_URL = process.env.ICON_BASE_URL || 'https://cdn.jsdelivr.net/gh/kasuyaayumu-dev/mis-mif2026-pages@main/image/icon/';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY が設定されていません。.env を確認してください。');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
// Cloudflare Tunnel/nginxなど1段階のリバースプロキシ経由での運用を想定し、
// X-Forwarded-Forの最も右側(直前のプロキシが追記した値)を信頼してクライアントIPとする。
// これを設定しないとexpress-rate-limitがX-Forwarded-Forを検出した際にエラーで落ちる。
app.set('trust proxy', 1);
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
      'If nothing matches, say so honestly. Do not invent projects that are not in the list.',
      '',
      'Interpret the visitor\'s intent broadly and generously: handle typos, casual wording, synonyms,',
      'and category-level requests (e.g. "any dance projects?", "what food is sold?", or even a typo like',
      '"tasty projecs") by reading through the ENTIRE project list above yourself and judging which',
      'projects plausibly match, using your own understanding of meaning (not literal keyword matching).',
      '',
      'Whenever ONE OR MORE projects match, you MUST call the suggest_projects tool — this is an absolute',
      'rule, never skip it. Pass the "names" argument as an array of the EXACT project names, copied',
      'character-for-character from the list above (not paraphrased), for every project you judged as a',
      'match — include ALL of them, not just one. The matching projects are shown to the user as cards',
      'automatically, so your text reply must be ONLY one short friendly sentence (e.g. "Here are some',
      'projects you might like!") and must NOT repeat the project names or details in text.',
      'Only skip the tool call if truly nothing in the list matches, in which case say so honestly.',
      '',
      'When the visitor shows interest in ONE specific project and wants to know more or go to its page,',
      'call the find_project_link tool with that project\'s exact name (copied from the list) to look up',
      'its page link, then share the result naturally (if found, guide them to it; if not ready yet, say',
      'so honestly).',
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
    '該当がなければ正直にその旨を伝えてください。リストにない企画を創作しないでください。',
    '',
    '来場者の意図は誤字・言い換え・カジュアルな表現も含めて広く柔軟に解釈してください',
    '(例:「おいちいたんな企画」→「美味しい企画」の誤字と解釈する、「ダンス系」→ダンスに関連する',
    '企画全般、など)。単純なキーワードの文字列一致ではなく、上の企画リストを実際に読んで、',
    'あなた自身の意味理解で「当てはまりそうな企画」を判断してください。',
    '',
    '1件でも当てはまる企画があれば、必ず suggest_projects ツールを呼び出してください。これは',
    '絶対的なルールで、例外はありません。names引数には、あなたが当てはまると判断した企画の',
    '「企画名」を、上のリストに書かれている表記のまま一字一句コピーして、該当する分すべて配列で',
    '渡してください(1件だけに絞らず、当てはまる企画は全部含める)。該当企画はカード形式で',
    'ユーザーに自動的に表示されるので、あなたの文章での返答は「おすすめの企画はこちらです」の',
    'ような一言だけにし、企画名や説明を文章中で繰り返さないでください。',
    'ツールを呼ばずに「見つかりませんでした」と答えて良いのは、リストを見ても本当に何も',
    '当てはまらない場合のみです。',
    '',
    '来場者が特定の1つの企画に興味を示し、詳しく知りたい・そのページに行きたいと言った場合は、',
    'find_project_link ツールを、その企画のリスト表記そのままの企画名で呼び出してリンクを調べ、',
    '見つかればそのリンクへ誘導し、まだ用意されていない場合は正直にその旨を伝えてください。',
    '回答は日本語で、なるべく簡潔にしてください。',
    '',
    '## 企画リスト',
    ...lines
  ].join('\n');
}

// ---- ツール(Function Calling)定義 ----
// 「この企画についてもっと知りたい/ページに行きたい」と言われた時に、
// 該当企画の詳細ページリンクを検索してモデルに返すためのツール。
// data/groups.json の各アイテムに url フィールド(現状は未設定のためnull)を
// 用意してあり、URLが整い次第このツールがそのまま使えるようになる。
const chatTools = [
  {
    type: 'function',
    function: {
      name: 'find_project_link',
      description:
        '来場者が興味を持った特定の企画・団体のページリンクを検索する。' +
        'ユーザーが特定の企画についてもっと知りたい・そのページに行きたいと言った時に使う。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '企画リストに書かれている表記そのままの企画名(一字一句コピー)'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'suggest_projects',
      description:
        'あなたが企画リストを読んで「来場者の質問に当てはまる」と判断した企画を、カード形式で' +
        '提示するためのもの。検索はしない(あなたが既に選んだ企画名をそのまま渡すだけ)。' +
        '複数の企画が当てはまりうる質問に答える時はこれを使い、文章中で企画名を列挙しないこと' +
        '(カードが自動表示されるため)。',
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description:
              '当てはまると判断した企画の名前を、企画リストに書かれている表記のまま一字一句' +
              'コピーして配列で渡す(該当するもの全部。最大8件まで)'
          }
        },
        required: ['names']
      }
    }
  }
];

// 完全一致 → 前方一致/部分一致 → ゆるい正規化一致、の順で1件だけ探す
function findItemByName(items, rawName) {
  const name = (rawName || '').trim();
  if (!name) return null;

  let match = items.find(it => it.name === name);
  if (match) return match;

  const lower = name.toLowerCase();
  match = items.find(it => it.name && it.name.toLowerCase() === lower);
  if (match) return match;

  match = items.find(it => it.name && it.name.toLowerCase().includes(lower));
  if (match) return match;

  // 空白・記号を除いたゆるい一致(モデルが微妙に表記を変えてしまった場合の保険)
  const normalize = s => (s || '').toLowerCase().replace(/[\s　・()（）\-~〜!！?？.,、。]/g, '');
  const normName = normalize(name);
  if (normName) {
    match = items.find(it => normalize(it.name).includes(normName) || normName.includes(normalize(it.name)));
    if (match) return match;
  }

  return null;
}

function findProjectLink(groupsData, name) {
  const items = groupsData.items || [];
  const match = findItemByName(items, name);

  if (!match) return { found: false, reason: 'not_found' };
  if (!match.url) {
    return { found: true, name: match.name, group: match.group, url: null, reason: 'link_not_ready' };
  }
  return { found: true, name: match.name, group: match.group, url: match.url };
}

function toCard(it) {
  return {
    name: it.name || '',
    group: it.group || '',
    description: it.description || '',
    icon: it.icon ? ICON_BASE_URL + it.icon : null,
    url: it.url || null
  };
}

function suggestProjects(groupsData, names) {
  const items = groupsData.items || [];
  const list = Array.isArray(names) ? names : [];

  const matched = [];
  const seenIds = new Set();
  for (const n of list.slice(0, 8)) {
    const item = findItemByName(items, n);
    if (item && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      matched.push(item);
    }
  }

  return { count: matched.length, items: matched.map(toCard) };
}

async function callOpenAI(messages) {
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      tools: chatTools,
      tool_choice: 'auto',
      // gpt-5.6-luna等の新しいモデルはtemperatureをdefault(1)以外受け付けず、
      // max_tokensではなくmax_completion_tokensを使う仕様のため合わせている。
      // またFunction ToolsはChat Completions APIではreasoning_effort:'none'を
      // 指定しないと使えない仕様(それ以外だと/v1/responsesの利用が必須)。
      reasoning_effort: 'none',
      max_completion_tokens: 600
    })
  });

  if (!openaiRes.ok) {
    // レスポンス本文はユーザー入力に由来しうるため、ログにはステータスコードのみ出力する
    console.error('OpenAI API error: status =', openaiRes.status);
    const err = new Error('openai_error');
    err.isOpenAIError = true;
    throw err;
  }

  return openaiRes.json();
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

    let reply = null;
    let suggestions = null; // suggest_projects が呼ばれた場合、カード表示用データをここに保持する
    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const openaiJson = await callOpenAI(messages);
      const assistantMsg = openaiJson.choices?.[0]?.message;

      if (!assistantMsg) break;

      if (Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0) {
        // モデルがツール呼び出しを要求してきた場合、サーバー側で実行して結果を返し、
        // もう一度モデルに問い合わせて自然な文章の最終回答を得る
        messages.push(assistantMsg);
        for (const toolCall of assistantMsg.tool_calls) {
          let args = {};
          try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* 不正なJSONは空引数扱い */ }

          let toolResult;
          if (toolCall.function?.name === 'find_project_link') {
            toolResult = findProjectLink(groupsData, args.name);
          } else if (toolCall.function?.name === 'suggest_projects') {
            toolResult = suggestProjects(groupsData, args.names);
            if (toolResult.items.length > 0) suggestions = toolResult.items;
          } else {
            toolResult = { error: 'unknown_tool' };
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }
        continue;
      }

      reply = assistantMsg.content?.trim();
      break;
    }

    if (!reply) {
      return res.status(502).json({ error: 'AIから有効な回答が得られませんでした。' });
    }

    const responseBody = { reply };
    if (suggestions) responseBody.suggestions = suggestions;
    res.json(responseBody);
  } catch (err) {
    if (err && err.isOpenAIError) {
      return res.status(502).json({ error: 'AIサーバーへの問い合わせに失敗しました。' });
    }
    console.error('chat handler error:', err);
    res.status(500).json({ error: 'サーバー内部エラーが発生しました。' });
  }
});

app.listen(PORT, () => {
  console.log(`MIF chatbot server listening on port ${PORT}`);
});
