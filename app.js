'use strict';

/**
 * ╔══════════════════════════════════════════════════╗
 * ║      LMS Auth Tester — Pro Edition v3            ║
 * ║   + Telegram xabarnoma + Windows Task Scheduler  ║
 * ╚══════════════════════════════════════════════════╝
 *
 * Ishlatish:
 *   node lms_tester.js
 *
 * Environment variables (.env yoki Task Scheduler "Environment"):
 *   TG_BOT_TOKEN=123456:ABC-your-token
 *   TG_CHAT_ID=your_chat_id
 */

const fs   = require('fs');
const path = require('path');
const { sendTelegram, buildReport } = require('./tg_notify');

// ─── .env yuklash (agar dotenv o'rnatilmagan bo'lsa, oddiy parse) ─────────────
(function loadEnv() {
  const envFile = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  usersFile   : path.resolve(__dirname, 'nimadir.json'),
  baseUrl     : 'https://dev.api.lms.itechacademy.uz/api/auth/login',
  timeout     : 10_000,
  retries     : 3,
  retryDelay  : 1_500,
  concurrency : 3,

  logFile     : path.resolve(__dirname, 'lms_auth.log'),

  logoutCandidates: [
    'https://dev.api.lms.itechacademy.uz/api/auth/logout',
    'https://dev.api.lms.itechacademy.uz/api/auth/sign-out',
    'https://dev.api.lms.itechacademy.uz/api/auth/signout',
    'https://dev.api.lms.itechacademy.uz/api/logout',
    'https://dev.api.lms.itechacademy.uz/api/user/logout',
  ],
  resolvedLogoutUrl  : null,
  resolvedLogoutHttp : null,
};

// ─── Terminal colors ──────────────────────────────────────────────────────────
const C = {
  reset : '\x1b[0m',  bold  : '\x1b[1m',  dim   : '\x1b[2m',
  green : '\x1b[32m', red   : '\x1b[31m', yellow: '\x1b[33m',
  cyan  : '\x1b[36m', white : '\x1b[37m', gray  : '\x1b[90m',
};

const ICONS = {
  info  : `${C.cyan}i${C.reset}`,
  ok    : `${C.green}+${C.reset}`,
  fail  : `${C.red}x${C.reset}`,
  warn  : `${C.yellow}!${C.reset}`,
  token : `${C.cyan}*${C.reset}`,
  logout: `${C.green}>${C.reset}`,
  net   : `${C.red}~${C.reset}`,
};

const ts  = () => `${C.gray}[${new Date().toTimeString().slice(0, 8)}]${C.reset}`;
const log = (level, msg) => {
  const line = `${ts()} ${ICONS[level] ?? '-'}  ${msg}`;
  console.log(line);
  // Log faylga ham yozish (ANSI kodlarsiz)
  const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
  fs.appendFileSync(CONFIG.logFile, plain + '\n');
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = CONFIG.timeout) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, retries = CONFIG.retries, delay = CONFIG.retryDelay) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try   { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < retries) {
        log('warn', `Urinish ${i}/${retries} xato — ${delay * i}ms kutilmoqda...`);
        await sleep(delay * i);
      }
    }
  }
  throw lastErr;
}

async function poolAll(tasks, limit) {
  const results   = [];
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(task).then(r => {
      executing.splice(executing.indexOf(p), 1);
      return r;
    });
    results.push(p);
    executing.push(p);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function extractToken(data) {
  return (data && (
    data.access_token ||
    data.token ||
    (data.data && (data.data.token || data.data.access_token))
  )) || null;
}

// ─── Auto-discover logout URL ─────────────────────────────────────────────────
async function discoverLogoutUrl(token) {
  if (CONFIG.resolvedLogoutUrl) {
    return { url: CONFIG.resolvedLogoutUrl, status: CONFIG.resolvedLogoutHttp };
  }

  log('info', 'Logout URL aniqlanmoqda...');

  for (const url of CONFIG.logoutCandidates) {
    try {
      const res = await fetchWithTimeout(url, {
        method  : 'POST',
        headers : {
          'Authorization' : `Bearer ${token}`,
          'Content-Type'  : 'application/json',
        },
      }, 6_000);

      if (res.status === 404 || res.status === 405) {
        log('warn', `${url} -> HTTP ${res.status} (yo'q)`);
        continue;
      }

      CONFIG.resolvedLogoutUrl  = url;
      CONFIG.resolvedLogoutHttp = res.status;
      log('ok', `Logout URL topildi: ${url}  (HTTP ${res.status})`);
      return { url, status: res.status };
    } catch (err) {
      log('warn', `${url} -> ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    }
  }

  log('fail', 'Hech bir logout endpoint ishlamadi.');
  return null;
}

// ─── Test one user ────────────────────────────────────────────────────────────
async function testUser(role, user) {
  const loginUrl = CONFIG.baseUrl + '/login';
  const startMs  = Date.now();
  const result   = {
    role, status: 'error', httpStatus: null,
    token: null, logoutUrl: null, logoutStatus: null,
    durationMs: 0, error: null,
  };

  console.log(`\n${C.bold}${C.white}-- [${role.toUpperCase()}] ${'-'.repeat(Math.max(0, 38 - role.length))}${C.reset}`);

  try {
    const loginData = await withRetry(async () => {
      const res = await fetchWithTimeout(loginUrl, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ phone: user.phone, password: user.password }),
      });

      result.httpStatus = res.status;

      let body;
      try   { body = await res.json(); }
      catch { throw new Error(`Server noto'g'ri JSON qaytardi (HTTP ${res.status})`); }

      if (!res.ok) {
        const msg = (body && (body.message || body.error)) || `HTTP ${res.status}`;
        const err = Object.assign(new Error(msg), { httpStatus: res.status });
        throw err;
      }
      return body;
    });

    log('ok', `Login muvaffaqiyatli! (HTTP ${result.httpStatus})`);

    const token = extractToken(loginData);
    result.token = token ? token.slice(0, 14) + '...' : null;

    if (!token) {
      log('warn', 'Token topilmadi — logout o\'tkazib yuboriladi.');
    } else {
      log('token', `Token: ${result.token}`);
      const found = await discoverLogoutUrl(token);
      if (!found) {
        result.logoutStatus = 'not_found';
        log('warn', 'Logout endpoint topilmadi.');
      } else {
        result.logoutUrl    = found.url;
        result.logoutStatus = found.status;
        if (found.status >= 200 && found.status < 300) {
          log('logout', `Logout muvaffaqiyatli (HTTP ${found.status})`);
        } else {
          log('warn', `Logout endpoint ishlaydi, lekin ${found.status} qaytardi.`);
        }
      }
    }

    result.status = 'ok';

  } catch (err) {
    result.error = err.message;
    if (err.httpStatus) result.httpStatus = err.httpStatus;

    if (err.name === 'AbortError') {
      log('net', `Timeout (${CONFIG.timeout}ms)`);
      result.error = 'Timeout';
    } else if (err.httpStatus) {
      log('fail', `Login rad etildi — HTTP ${err.httpStatus}: ${err.message}`);
    } else {
      log('net', `Serverga ulanib bo'lmadi: ${err.message}`);
    }
  }

  result.durationMs = Date.now() - startMs;
  log('info', `${C.dim}Davomiyligi: ${result.durationMs}ms${C.reset}`);
  return result;
}

// ─── Report ───────────────────────────────────────────────────────────────────
function printReport(results) {
  const ok    = results.filter(r => r.status === 'ok');
  const fail  = results.filter(r => r.status !== 'ok');
  const avgMs = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);
  const line  = `${C.dim}${'-'.repeat(60)}${C.reset}`;

  console.log('\n' + line);
  console.log(`${C.bold}${C.white}  TEST NATIJASI${C.reset}`);
  console.log(line);

  for (const r of results) {
    const statusTxt = r.status === 'ok' ? `${C.green}[OK]   ${C.reset}` : `${C.red}[XATO] ${C.reset}`;
    const errNote   = r.error ? `  ${C.dim}(${r.error})${C.reset}` : '';
    console.log(
      `  ${r.role.padEnd(18)}  ${statusTxt}  login:${(r.httpStatus || '-').toString().padEnd(5)}  logout:${(r.logoutStatus || '-').toString().padEnd(5)}  ${r.durationMs}ms${errNote}`
    );
  }

  console.log(line);
  console.log(`  ${C.green}Muvaffaqiyatli : ${ok.length} / ${results.length}${C.reset}`);
  if (fail.length) console.log(`  ${C.red}Xatolik        : ${fail.length} / ${results.length}${C.reset}`);
  console.log(`  ${C.cyan}O'rtacha vaqt  : ${avgMs}ms${C.reset}`);
  if (CONFIG.resolvedLogoutUrl) {
    console.log(`  ${C.cyan}Logout URL     : ${CONFIG.resolvedLogoutUrl}${C.reset}`);
  } else {
    console.log(`  ${C.yellow}Logout URL topilmadi${C.reset}`);
  }
  console.log(line);

  if (fail.length === 0) {
    console.log(`\n  ${C.bold}${C.green}Barcha foydalanuvchilar muvaffaqiyatli!${C.reset}\n`);
  } else {
    console.log(`\n  ${C.bold}${C.yellow}Ba'zi rollar xato qaytardi.${C.reset}\n`);
  }

  return { ok: ok.length, fail: fail.length, avgMs };
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main() {
  const runTime = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });

  console.log(`\n${C.bold}${C.cyan}==========================================`);
  console.log('    LMS Auth Tester  --  Pro Edition v3   ');
  console.log(`==========================================${C.reset}\n`);
  log('info', `Tekshiruv boshlandi: ${runTime}`);

  // Log separator
  fs.appendFileSync(CONFIG.logFile, `\n${'='.repeat(60)}\nRun: ${runTime}\n${'='.repeat(60)}\n`);

  let users;
  try {
    users = JSON.parse(fs.readFileSync(CONFIG.usersFile, 'utf8'));
    log('info', `${Object.keys(users).length} ta rol: ${Object.keys(users).join(', ')}`);
  } catch (err) {
    const msg = `nimadir.json o'qilmadi: ${err.message}`;
    console.error(C.red + msg + C.reset);
    await sendTelegram(`🚨 <b>LMS Tester Xato</b>\n\n${msg}`);
    process.exit(1);
  }

  const valid = Object.entries(users).filter(([role, u]) => {
    if (!u || !u.phone || !u.password) {
      log('warn', `[${role}] phone yoki password yo'q — o'tkazildi.`);
      return false;
    }
    return true;
  });

  if (!valid.length) {
    const msg = 'Tekshiriladigan foydalanuvchi topilmadi.';
    console.error(C.red + msg + C.reset);
    await sendTelegram(`🚨 <b>LMS Tester Xato</b>\n\n${msg}`);
    process.exit(1);
  }

  log('info', `Concurrency: ${CONFIG.concurrency} | Timeout: ${CONFIG.timeout}ms | Retries: ${CONFIG.retries}`);

  const tasks   = valid.map(([role, user]) => () => testUser(role, user));
  const results = await poolAll(tasks, CONFIG.concurrency);

  const { ok, fail, avgMs } = printReport(results);

  // ── Telegram xabar ────────────────────────────────────────────────────────
  const tgText = buildReport(results, CONFIG.resolvedLogoutUrl, avgMs, runTime);
  const sent   = await sendTelegram(tgText);
  log(sent ? 'ok' : 'warn', sent ? 'Telegram xabar yuborildi ✓' : 'Telegram xabar yuborilmadi');

  process.exit(results.every(r => r.status === 'ok') ? 0 : 1);
}

main().catch(async (err) => {
  console.error(C.red + 'Kutilmagan xatolik: ' + err.message + C.reset);
  await sendTelegram(`🚨 <b>LMS Tester — Kutilmagan xatolik</b>\n\n<code>${err.message}</code>`);
  process.exit(1);
});