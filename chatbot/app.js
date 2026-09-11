// data-url・表示文言・APIエンドポイントは各ページのCHAT_I18N(グローバル)から受け取る
const I18N = window.CHAT_I18N || {};

const history = [];
let sending = false;

function appendMessage(role, text) {
  const log = document.getElementById('chatLog');
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
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
      appendMessage('error', (data && data.error) || I18N.errorMsg);
    } else {
      appendMessage('bot', data.reply);
      history.push({ role: 'assistant', content: data.reply });
    }
  } catch (err) {
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
    sendMessage(text);
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
