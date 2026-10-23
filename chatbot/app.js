// data-url・表示文言・APIエンドポイントは各ページのCHAT_I18N(グローバル)から受け取る
const I18N = window.CHAT_I18N || {};

const history = [];
let sending = false;

// ボットの返信内のURL([表示名](URL)形式と生のURL)をリンクにする。httpsのみ許可し、
// 親ページごと遷移できるようtarget=_topにする(埋め込みiframe内でも開けるように)。
const LINK_PATTERN = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>()（）、。]+)/g;

function appendTextWithLinks(el, text) {
  let last = 0;
  for (const m of text.matchAll(LINK_PATTERN)) {
    el.append(text.slice(last, m.index));
    const a = document.createElement('a');
    a.href = m[2] || m[3];
    a.textContent = m[1] || m[3];
    a.target = '_top';
    a.rel = 'noopener';
    el.appendChild(a);
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

function appendMessage(role, text) {
  const log = document.getElementById('chatLog');
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (role === 'bot') {
    appendTextWithLinks(el, text);
  } else {
    el.textContent = text;
  }
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

// 複数企画をカード一覧(添付ファイル風)で表示する
function appendSuggestions(items) {
  const log = document.getElementById('chatLog');
  const el = document.createElement('div');
  el.className = 'msg suggestions';

  items.forEach(item => {
    const row = document.createElement(item.url ? 'a' : 'div');
    row.className = 'suggestion-item';
    if (item.url) {
      row.href = item.url;
      row.target = '_top';
      row.rel = 'noopener';
    } else {
      row.classList.add('no-link');
    }

    const icon = document.createElement('div');
    icon.className = 'suggestion-icon';
    if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = '';
      icon.appendChild(img);
    }
    row.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'suggestion-body';

    const name = document.createElement('div');
    name.className = 'suggestion-name';
    name.textContent = item.name || '';
    body.appendChild(name);

    if (item.description) {
      const desc = document.createElement('div');
      desc.className = 'suggestion-desc';
      desc.textContent = item.description;
      body.appendChild(desc);
    }

    row.appendChild(body);
    el.appendChild(row);
  });

  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function appendLoading() {
  const log = document.getElementById('chatLog');
  const el = document.createElement('div');
  el.className = 'msg loading';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function sendMessage(text) {
  if (sending) return;
  sending = true;

  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  input.disabled = true;
  sendBtn.disabled = true;

  appendMessage('user', text);
  history.push({ role: 'user', content: text });
  const loadingEl = appendLoading();

  try {
    const res = await fetch(I18N.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        lang: I18N.lang || 'ja',
        history: history.slice(-10)
      })
    });

    const data = await res.json().catch(() => ({}));
    loadingEl.remove();

    if (!res.ok || !data.reply) {
      appendMessage('error', data?.error || I18N.errorMsg);
    } else {
      appendMessage('bot', data.reply);
      history.push({ role: 'assistant', content: data.reply });
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        appendSuggestions(data.suggestions);
      }
    }
  } catch (err) {
    // ネットワークエラーやJSON解析失敗など。詳細はコンソールに残し、UIには汎用メッセージのみ表示する。
    console.error('sendMessage failed:', err);
    loadingEl.remove();
    appendMessage('error', I18N.errorMsg);
  } finally {
    sending = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    postHeightToParent();
  }
}

function initChat() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');

  if (I18N.greeting) {
    appendMessage('bot', I18N.greeting);
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void sendMessage(text);
  });
}

// STUDIO埋め込み用: iframeの外側に実際のコンテンツ高さを伝えて、
// 埋め込み側でiframeの高さを合わせてもらう
function postHeightToParent() {
  if (window.parent === window) return;
  requestAnimationFrame(() => {
    const height = document.documentElement.scrollHeight;
    // 埋め込み先(STUDIOの各公開ドメイン)を事前に特定できないため target origin は '*' を使用。
    // 送信内容はページの高さ(数値)のみで機密情報は含まない。
    window.parent.postMessage({ type: 'mif-chatbot-resize', height: height }, '*'); // NOSONAR
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initChat();
  postHeightToParent();
  window.addEventListener('resize', postHeightToParent);
});
