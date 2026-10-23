/* =====================================================================
   LC79 MD5 PREDICTOR - FULL SYSTEM v3.0
   Single-file backend: fetch + analyze + predict + storage + API + HTML
   ===================================================================== */

const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================ CONFIG ============================ */
const CONFIG = {
  API_GOC: 'https://wtxmd52.tele68.com/v1/txmd5/sessions',
  CRON: '*/5 * * * * *',
  MAX_HISTORY: 3000,
  MAX_PREDICTIONS: 1500,
  MIN_CONFIDENCE: 55,
  WEIGHTS: {
    streakBreak: 5,
    streakFollow: 2,
    longStreakFade: 6,
    balanceRatio: 3,
    pattern222: 4,
    pattern1212: 2,
    pattern3step: 3,
    recentTrend: 3,
    diceBias: 2,
    pointBias: 2,
    bouncePattern: 3,
    clusterDensity: 2,
    alternatingFade: 3,
    doubleBreak: 4
  }
};

/* ============================ LOGGER ============================ */
const logger = {
  log: (...a) => console.log(`[${new Date().toISOString()}]`, ...a),
  info: (...a) => console.log(`[INFO ${new Date().toISOString()}]`, ...a),
  warn: (...a) => console.warn(`[WARN ${new Date().toISOString()}]`, ...a),
  error: (...a) => console.error(`[ERR  ${new Date().toISOString()}]`, ...a)
};

/* ============================ STORAGE ============================ */
const Store = {
  history: [],       // mới → cũ
  predictions: [],   // mới → cũ
  lastId: null,
  fetchCount: 0,
  errorCount: 0,
  startTime: Date.now(),
  lastFetchAt: null,
  apiLatency: 0
};

/* ============================ FETCHER ============================ */
let isFetching = false;

async function fetchSessions() {
  if (isFetching) return null;
  isFetching = true;
  const t0 = Date.now();
  try {
    const res = await axios.get(CONFIG.API_GOC, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 LC79Predictor/3.0',
        'Accept': 'application/json'
      }
    });
    Store.apiLatency = Date.now() - t0;
    Store.fetchCount++;
    Store.lastFetchAt = Date.now();

    if (!res.data || !Array.isArray(res.data.list)) {
      logger.warn('Invalid payload');
      return null;
    }
    const list = res.data.list.slice(0, CONFIG.MAX_HISTORY);
    Store.history = list;
    return { list, typeStat: res.data.typeStat || {} };
  } catch (e) {
    Store.errorCount++;
    logger.error('Fetch error:', e.message);
    return null;
  } finally {
    isFetching = false;
  }
}

/* ============================ ANALYZER ============================ */
function analyze(list) {
  if (!list || !list.length) return null;
  const results = list.map(x => x.resultTruyenThong);
  const n = results.length;
  const last = results[0];
  const opposite = last === 'TAI' ? 'XIU' : 'TAI';

  // streak
  let streak = 1;
  for (let i = 1; i < n; i++) {
    if (results[i] === last) streak++;
    else break;
  }

  // tổng
  const tai = results.filter(r => r === 'TAI').length;
  const xiu = results.filter(r => r === 'XIU').length;
  const total = tai + xiu;

  let score = 0;
  const details = [];
  const push = (name, delta, reason) => {
    if (delta === 0) return;
    score += delta;
    details.push({ name, delta, reason });
  };

  // === Rule 1: streak ===
  if (streak >= 2 && streak <= 4) {
    const d = (last === 'TAI' ? -1 : 1) * CONFIG.WEIGHTS.streakBreak;
    push('streakBreak', d, `Bẻ cầu sau ${streak} phiên ${last}`);
  } else if (streak === 1) {
    const d = (last === 'TAI' ? 1 : -1) * CONFIG.WEIGHTS.streakFollow;
    push('streakFollow', d, 'Theo cầu nhẹ');
  } else if (streak >= 5) {
    const d = (last === 'TAI' ? -1 : 1) * CONFIG.WEIGHTS.longStreakFade;
    push('longStreakFade', d, `Chuỗi ${streak} phiên → hồi`);
  }

  // === Rule 2: balance ===
  const imbalance = (tai - xiu) / total;
  if (Math.abs(imbalance) > 0.15) {
    const d = imbalance > 0 ? -CONFIG.WEIGHTS.balanceRatio : CONFIG.WEIGHTS.balanceRatio;
    push('balanceRatio', d, `Lệch ${(imbalance*100).toFixed(1)}%`);
  }

  // === Rule 3: 2-2-2 ===
  if (n >= 6) {
    const p = results.slice(0, 6);
    if (p[0]===p[1] && p[2]===p[3] && p[4]===p[5] && p[0]!==p[2] && p[2]!==p[4]) {
      const d = p[0]==='TAI' ? -CONFIG.WEIGHTS.pattern222 : CONFIG.WEIGHTS.pattern222;
      push('pattern222', d, 'Cầu 2-2-2');
    }
  }

  // === Rule 4: 1-2-1-2 ===
  if (n >= 4) {
    const p = results.slice(0, 4);
    if (p[0]!==p[1] && p[1]===p[2] && p[2]!==p[3]) {
      const d = p[0]==='TAI' ? CONFIG.WEIGHTS.pattern1212 : -CONFIG.WEIGHTS.pattern1212;
      push('pattern1212', d, 'Cầu 1-2-1-2');
    }
  }

  // === Rule 5: bệt 3 ===
  if (n >= 3) {
    const p = results.slice(0, 3);
    if (p[0]===p[1] && p[1]===p[2]) {
      const d = p[0]==='TAI' ? -CONFIG.WEIGHTS.pattern3step : CONFIG.WEIGHTS.pattern3step;
      push('pattern3step', d, 'Bệt 3');
    }
  }

  // === Rule 6: recent trend 20 ===
  const recent = results.slice(0, Math.min(20, n));
  const rt = (recent.filter(r => r==='TAI').length / recent.length) - 0.5;
  if (Math.abs(rt) > 0.1) {
    const d = rt > 0 ? -CONFIG.WEIGHTS.recentTrend : CONFIG.WEIGHTS.recentTrend;
    push('recentTrend', d, `20 phiên: ${((rt+0.5)*100).toFixed(0)}% TAI`);
  }

  // === Rule 7: dice bias ===
  const r10 = list.slice(0, Math.min(10, n));
  let td = 0, xd = 0;
  r10.forEach(s => (s.dices || []).forEach(d => d >= 4 ? td++ : xd++));
  if (td + xd > 0) {
    const r = td / (td + xd);
    if (r > 0.62) push('diceBias', -CONFIG.WEIGHTS.diceBias, `Xúc xắc thiên TAI ${(r*100).toFixed(0)}%`);
    else if (r < 0.38) push('diceBias', CONFIG.WEIGHTS.diceBias, `Xúc xắc thiên XIU ${(r*100).toFixed(0)}%`);
  }

  // === Rule 8: point bias ===
  const pts = r10.map(s => s.point || 0);
  const avg = pts.reduce((a,b)=>a+b,0) / (pts.length || 1);
  if (avg > 12) push('pointBias', -CONFIG.WEIGHTS.pointBias, `Điểm TB ${avg.toFixed(1)} cao`);
  else if (avg < 8) push('pointBias', CONFIG.WEIGHTS.pointBias, `Điểm TB ${avg.toFixed(1)} thấp`);

  // === Rule 9: bounce ===
  if (n >= 5) {
    let b = 0;
    for (let i = 0; i < 4; i++) if (results[i] !== results[i+1]) b++;
    if (b >= 3) {
      const d = last==='TAI' ? -CONFIG.WEIGHTS.bouncePattern : CONFIG.WEIGHTS.bouncePattern;
      push('bouncePattern', d, `Nhảy ${b}/4 phiên`);
    }
  }

  // === Rule 10: cluster density ===
  if (n >= 10) {
    const cluster = results.slice(0, 10);
    let maxRun = 1, cur = 1;
    for (let i = 1; i < cluster.length; i++) {
      if (cluster[i] === cluster[i-1]) { cur++; maxRun = Math.max(maxRun, cur); }
      else cur = 1;
    }
    if (maxRun >= 4) {
      const d = cluster[0]==='TAI' ? -CONFIG.WEIGHTS.clusterDensity : CONFIG.WEIGHTS.clusterDensity;
      push('clusterDensity', d, `Cụm ${maxRun} phiên`);
    }
  }

  // === Rule 11: alternating fade ===
  if (n >= 8) {
    const seg = results.slice(0, 8);
    let alt = 0;
    for (let i = 0; i < 7; i++) if (seg[i] !== seg[i+1]) alt++;
    if (alt >= 6) {
      const d = last==='TAI' ? -CONFIG.WEIGHTS.alternatingFade : CONFIG.WEIGHTS.alternatingFade;
      push('alternatingFade', d, `Đảo ${alt}/7 phiên → bẻ mạnh`);
    }
  }

  // === Rule 12: double break ===
  if (n >= 4) {
    const p = results.slice(0, 4);
    if (p[0]!==p[1] && p[1]!==p[2] && p[2]!==p[3]) {
      const d = p[0]==='TAI' ? CONFIG.WEIGHTS.doubleBreak : -CONFIG.WEIGHTS.doubleBreak;
      push('doubleBreak', d, 'Đảo liên tiếp 3 phiên');
    }
  }

  const predict = score >= 0 ? 'TAI' : 'XIU';
  const confidence = Math.max(
    CONFIG.MIN_CONFIDENCE,
    Math.min(95, 50 + Math.abs(score) * 4)
  );

  return {
    score,
    predict,
    confidence,
    streak,
    last,
    opposite,
    tai,
    xiu,
    total,
    details
  };
}

/* ============================ PREDICTOR ============================ */
function makePrediction() {
  if (!Store.history.length) return;
  const info = analyze(Store.history);
  if (!info) return;
  const latest = Store.history[0];
  const nextId = latest.id + 1;

  // check đã có dự đoán chưa
  const exists = Store.predictions.find(p => p.id === nextId);
  if (exists) return;

  const pred = {
    id: nextId,
    predict: info.predict,
    confidence: Math.round(info.confidence),
    score: info.score,
    baseId: latest.id,
    baseResult: latest.resultTruyenThong,
    basePoint: latest.point,
    baseDices: latest.dices,
    streak: info.streak,
    tai: info.tai,
    xiu: info.xiu,
    details: info.details,
    actual: null,
    correct: null,
    createdAt: Date.now()
  };
  Store.predictions.unshift(pred);
  if (Store.predictions.length > CONFIG.MAX_PREDICTIONS) Store.predictions.pop();
  logger.info(`Pred #${pred.id} → ${pred.predict} (${pred.confidence}%) | base=${pred.baseId} ${pred.baseResult}`);
}

/* ============================ CHECK RESULT ============================ */
function checkPredictions() {
  const map = {};
  Store.history.forEach(h => map[h.id] = h);
  let updated = 0;
  Store.predictions.forEach(p => {
    if (p.actual === null && map[p.id]) {
      const real = map[p.id];
      p.actual = real.resultTruyenThong;
      p.actualPoint = real.point;
      p.actualDices = real.dices;
      p.correct = (p.actual === p.predict);
      updated++;
    }
  });
  if (updated) logger.info(`Checked ${updated} predictions`);
}

/* ============================ STATS ============================ */
function computeStats() {
  const resolved = Store.predictions.filter(p => p.correct !== null);
  const ok = resolved.filter(p => p.correct).length;
  const fail = resolved.length - ok;
  const rate = resolved.length ? ((ok / resolved.length) * 100).toFixed(2) : '0.00';

  // streak đúng/sai hiện tại
  let winStreak = 0, loseStreak = 0;
  for (const p of Store.predictions) {
    if (p.correct === null) continue;
    if (p.correct) { if (loseStreak > 0) break; winStreak++; }
    else { if (winStreak > 0) break; loseStreak++; }
  }

  // theo confidence bucket
  const buckets = { '55-65': { ok: 0, total: 0 }, '65-75': { ok: 0, total: 0 }, '75-85': { ok: 0, total: 0 }, '85+': { ok: 0, total: 0 } };
  resolved.forEach(p => {
    let k = '55-65';
    if (p.confidence >= 85) k = '85+';
    else if (p.confidence >= 75) k = '75-85';
    else if (p.confidence >= 65) k = '65-75';
    buckets[k].total++;
    if (p.correct) buckets[k].ok++;
  });

  // 20 phiên gần
  const last20 = resolved.slice(0, 20);
  const ok20 = last20.filter(p => p.correct).length;

  return {
    totalPredictions: Store.predictions.length,
    resolved: resolved.length,
    ok, fail, rate,
    winStreak, loseStreak,
    last20Rate: last20.length ? ((ok20 / last20.length) * 100).toFixed(2) : '0.00',
    buckets,
    historySize: Store.history.length,
    fetchCount: Store.fetchCount,
    errorCount: Store.errorCount,
    apiLatency: Store.apiLatency,
    uptimeSec: Math.floor((Date.now() - Store.startTime) / 1000),
    lastFetchAt: Store.lastFetchAt
  };
}

/* ============================ CORE LOOP ============================ */
async function tick() {
  const data = await fetchSessions();
  if (!data) return;
  checkPredictions();
  if (Store.lastId !== data.list[0].id) {
    Store.lastId = data.list[0].id;
    makePrediction();
  }
}

/* ============================ API JSON ============================ */
app.get('/apilc79md5', (req, res) => {
  const latest = Store.predictions[0];
  const stats = computeStats();
  if (!latest) {
    return res.json({ ok: false, message: 'Chưa có dữ liệu, vui lòng chờ...' });
  }
  res.json({
    ok: true,
    session: latest.id,
    duDoan: latest.predict,
    doTinCay: latest.confidence + '%',
    score: latest.score,
    phienGoc: latest.baseId,
    ketQuaGoc: latest.baseResult,
    xucXacGoc: latest.baseDices,
    diemGoc: latest.basePoint,
    streak: latest.streak,
    thongKe: { TAI: latest.tai, XIU: latest.xiu },
    details: latest.details,
    stats,
    createdAt: latest.createdAt
  });
});

/* ============================ API DETAIL ============================ */
app.get('/apilc79md5/all', (req, res) => {
  res.json({
    ok: true,
    predictions: Store.predictions.slice(0, 200),
    stats: computeStats()
  });
});

/* ============================ API HISTORY ============================ */
app.get('/apilc79md5/history', (req, res) => {
  res.json({
    ok: true,
    history: Store.history.slice(0, 200)
  });
});

/* ============================ HTML DASHBOARD ============================ */
app.get('/data', (req, res) => {
  const stats = computeStats();
  const latest = Store.predictions[0];

  const rows = Store.predictions.map(p => {
    const cls = p.correct === true ? 'ok' : p.correct === false ? 'fail' : 'pending';
    const mark = p.correct === null ? '⏳' : p.correct ? '✅' : '❌';
    return `<tr class="${cls}">
      <td>#${p.id}</td>
      <td class="bold">${p.predict}</td>
      <td>${p.confidence}%</td>
      <td>${p.score > 0 ? '+' : ''}${p.score}</td>
      <td>${p.baseResult} (${p.basePoint})</td>
      <td>${p.actual || '...'}</td>
      <td>${p.actualPoint || '...'}</td>
      <td>${mark}</td>
      <td>${p.streak}</td>
    </tr>`;
  }).join('');

  const detailRows = latest ? latest.details.map(d =>
    `<tr><td>${d.name}</td><td>${d.delta > 0 ? '+' : ''}${d.delta}</td><td>${d.reason}</td></tr>`
  ).join('') : '';

  const histRows = Store.history.slice(0, 50).map(h =>
    `<tr><td>#${h.id}</td><td>${h.resultTruyenThong}</td><td>${h.point}</td><td>${(h.dices||[]).join('-')}</td></tr>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LC79 MD5 Predictor - Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; text-align: center; margin-bottom: 8px; font-size: 24px; }
  .sub { text-align: center; color: #8b949e; margin-bottom: 20px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  .card .label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 22px; font-weight: bold; margin-top: 6px; }
  .card.tai .value { color: #3fb950; }
  .card.xiu .value { color: #f85149; }
  .card.conf .value { color: #f0b400; }
  .card.rate .value { color: #58a6ff; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; background: #161b22; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 10px; text-align: center; border-bottom: 1px solid #21262d; font-size: 13px; }
  th { background: #21262d; color: #8b949e; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  tr.ok { background: rgba(63,185,80,0.08); }
  tr.fail { background: rgba(248,81,73,0.08); }
  tr.pending { background: rgba(240,180,0,0.06); }
  .bold { font-weight: bold; }
  h2 { color: #58a6ff; margin: 20px 0 10px; font-size: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge.tai { background: #238636; color: #fff; }
  .badge.xiu { background: #da3633; color: #fff; }
  .footer { text-align: center; color: #484f58; font-size: 11px; margin-top: 30px; }
  .live { display: inline-block; width: 8px; height: 8px; background: #3fb950; border-radius: 50%; animation: pulse 1.5s infinite; margin-right: 6px; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>
</head>
<body>
  <h1><span class="live"></span>LC79 MD5 PREDICTOR</h1>
  <div class="sub">Dự đoán dựa 100% trên data lịch sử API gốc • Cập nhật mỗi 5 giây</div>

  <div class="grid">
    <div class="card tai">
      <div class="label">Phiên dự đoán</div>
      <div class="value">#${latest ? latest.id : '---'}</div>
    </div>
    <div class="card ${latest && latest.predict === 'TAI' ? 'tai' : 'xiu'}">
      <div class="label">Dự đoán</div>
      <div class="value">${latest ? latest.predict : '---'}</div>
    </div>
    <div class="card conf">
      <div class="label">Độ tin cậy</div>
      <div class="value">${latest ? latest.confidence + '%' : '---'}</div>
    </div>
    <div class="card rate">
      <div class="label">Tỷ lệ đúng</div>
      <div class="value">${stats.rate}%</div>
    </div>
    <div class="card">
      <div class="label">Tổng dự đoán</div>
      <div class="value">${stats.resolved}</div>
    </div>
    <div class="card">
      <div class="label">Đúng / Sai</div>
      <div class="value">${stats.ok} / ${stats.fail}</div>
    </div>
    <div class="card">
      <div class="label">Win streak</div>
      <div class="value">${stats.winStreak}</div>
    </div>
    <div class="card">
      <div class="label">20 phiên gần</div>
      <div class="value">${stats.last20Rate}%</div>
    </div>
  </div>

  <h2>📊 Phân tích rule phiên hiện tại</h2>
  <table>
    <tr><th>Rule</th><th>Điểm</th><th>Lý do</th></tr>
    ${detailRows || '<tr><td colspan="3">Chưa có</td></tr>'}
  </table>

  <h2>🎯 Lịch sử dự đoán (mới nhất trên cùng)</h2>
  <table>
    <tr>
      <th>Phiên</th><th>Dự đoán</th><th>Tin cậy</th><th>Score</th>
      <th>Gốc</th><th>Thực tế</th><th>Điểm</th><th>KQ</th><th>Streak</th>
    </tr>
    ${rows || '<tr><td colspan="9">Đang chờ data...</td></tr>'}
  </table>

  <h2>📜 50 phiên lịch sử gần nhất</h2>
  <table>
    <tr><th>Phiên</th><th>KQ</th><th>Điểm</th><th>Xúc xắc</th></tr>
    ${histRows || '<tr><td colspan="4">Chưa có</td></tr>'}
  </table>

  <div class="footer">
    Uptime: ${stats.uptimeSec}s • Fetch: ${stats.fetchCount} • Errors: ${stats.errorCount} • API: ${stats.apiLatency}ms<br>
    Endpoint: /apilc79md5 • /apilc79md5/all • /apilc79md5/history • /data
  </div>
</body>
</html>`);
});

/* ============================ ROOT ============================ */
app.get('/', (req, res) => {
  res.redirect('/data');
});

/* ============================ BOOT ============================ */
cron.schedule(CONFIG.CRON, () => { tick().catch(e => logger.error(e.message)); });
tick().catch(e => logger.error(e.message));

app.listen(PORT, () => {
  logger.info(`🚀 LC79 MD5 Predictor running on port ${PORT}`);
  logger.info(`   → JSON:  http://localhost:${PORT}/apilc79md5`);
  logger.info(`   → HTML:  http://localhost:${PORT}/data`);
});
