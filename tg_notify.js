'use strict';

/**
 * Telegram Notification Module
 * BOT_TOKEN va CHAT_ID ni .env yoki environment variable orqali bering
 */

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID   = process.env.TG_CHAT_ID   || '';

async function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.warn('[TG] TG_BOT_TOKEN yoki TG_CHAT_ID yo\'q — xabar yuborilmadi.');
    return false;
  }

  const url  = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id    : TG_CHAT_ID,
    text       : text,
    parse_mode : 'HTML',
  });

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res   = await fetch(url, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body,
      signal  : ctrl.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!data.ok) {
      console.warn('[TG] Telegram xato:', data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[TG] Telegram ulanish xato:', err.message);
    return false;
  }
}

function buildReport(results, logoutUrl, avgMs, runTime) {
  const ok   = results.filter(r => r.status === 'ok');
  const fail = results.filter(r => r.status !== 'ok');
  const allOk = fail.length === 0;

  const header = allOk
    ? '✅ <b>LMS Auth — Hammasi Yaxshi</b>'
    : '❌ <b>LMS Auth — Xatolik Bor!</b>';

  const rows = results.map(r => {
    const icon   = r.status === 'ok' ? '🟢' : '🔴';
    const login  = r.httpStatus   ? `HTTP ${r.httpStatus}`   : '—';
    const logout = r.logoutStatus ? `${r.logoutStatus}`      : '—';
    const err    = r.error        ? `\n     ⚠️ ${r.error}`   : '';
    return `${icon} <code>${r.role.padEnd(16)}</code> login:<b>${login}</b>  logout:<b>${logout}</b>  ${r.durationMs}ms${err}`;
  }).join('\n');

  const summary = [
    ``,
    `📊 <b>Natija:</b> ${ok.length}✅ / ${fail.length > 0 ? fail.length + '❌' : '0❌'}  (jami ${results.length})`,
    `⏱ O'rtacha vaqt: <b>${avgMs}ms</b>`,
    logoutUrl
      ? `🔗 Logout URL: <code>${logoutUrl}</code>`
      : `⚠️ Logout URL topilmadi`,
    `🕐 Tekshiruv vaqti: ${runTime}`,
  ].join('\n');

  return `${header}\n\n${rows}${summary}`;
}

module.exports = { sendTelegram, buildReport };