const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const CACHE_TTL = 4000;
let cache = { list: [], t: 0 };

async function fetchHistory() {
  const now = Date.now();
  if (cache.list.length && now - cache.t < CACHE_TTL) return cache.list;
  try {
    const res = await axios.get(API_URL, { timeout: 8000 });
    let list = res.data.list || (Array.isArray(res.data) ? res.data : []);
    list.sort((a, b) => b.id - a.id); // mới nhất trước
    cache = { list, t: now };
    return list;
  } catch (e) {
    console.error('fetch err', e.message);
    return cache.list;
  }
}

/* =========================================================
   HELPERS
   ========================================================= */
// results: mảng "TAI"/"XIU", index 0 = mới nhất
const flip = s => (s === 'TAI' ? 'XIU' : 'TAI');

// Đếm chuỗi giống nhau từ đầu
function runLength(results, idx = 0) {
  const t = results[idx];
  let n = 1;
  for (let i = idx + 1; i < results.length; i++) {
    if (results[i] === t) n++; else break;
  }
  return { type: t, len: n };
}

// So le (zigzag) từ đầu: a,b,a,b,...
function zigzagLength(results) {
  if (results.length < 2) return 1;
  let n = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) n++; else break;
  }
  return n;
}

// Pattern lặp khối độ dài k: vd k=2 => ABAB / AABB? -> chỉ ABAB kiểu khối. Ta xét khối "AABB"
function repeatBlock(results, blockLen) {
  // trả về số khối lặp liên tiếp từ đầu (mỗi khối blockLen phần tử giống nhau, xen kẽ khối)
  if (results.length < blockLen * 2) return 0;
  let blocks = 0;
  let prevBlockType = null;
  for (let i = 0; i + blockLen <= results.length; i += blockLen) {
    const block = results.slice(i, i + blockLen);
    const uniform = block.every(x => x === block[0]);
    if (!uniform) break;
    if (prevBlockType && block[0] === prevBlockType) break;
    prevBlockType = block[0];
    blocks++;
  }
  return blocks; // số khối uniform xen kẽ
}

// Pattern "kép" kiểu 1-2 (A BB A BB...) hoặc 2-1 (AA B AA B...)
function repeatPattern(results, p1, p2) {
  // p1, p2 độ dài 2 khối xen kẽ. Trả về số chu kỳ hoàn chỉnh + vị trí
  let cycles = 0;
  let i = 0;
  let phase = 0; // 0 -> p1, 1 -> p2
  while (i + (phase === 0 ? p1 : p2) <= results.length) {
    const len = phase === 0 ? p1 : p2;
    const block = results.slice(i, i + len);
    if (!block.every(x => x === block[0])) break;
    i += len;
    if (phase === 1) cycles++;
    phase = 1 - phase;
  }
  return { cycles, consumed: i, nextLen: phase === 0 ? p1 : p2, nextType: null };
}

// Đếm tổng trong n phiên
function count(results, n) {
  const arr = results.slice(0, n);
  const t = arr.filter(x => x === 'TAI').length;
  return { TAI: t, XIU: arr.length - t, total: arr.length };
}

/* =========================================================
   NHẬN DIỆN CẦU — trả về mô tả + dự đoán từng cầu
   ========================================================= */
function detectPatterns(list) {
  const R = list.map(x => x.resultTruyenThong); // mới nhất trước
  const patterns = []; // {name, duDoan, doTinCay, ghiChu, doDai, trangThai}

  // ---------- 1. BỆT ----------
  const b = runLength(R);
  if (b.len >= 2) {
    patterns.push({
      name: `Bệt ${b.type}`,
      doDai: b.len,
      loai: 'bet',
      // bệt 2-3: theo; bệt 4-5: theo; bệt >=6: bẻ
      duDoan: b.len >= 6 ? flip(b.type) : b.type,
      doTinCay: b.len >= 6 ? 68 + Math.min(b.len - 6, 6) * 3 : 60 + b.len * 4,
      ghiChu: b.len >= 6
        ? `Bệt ${b.type} đã ${b.len} phiên — quá dài, ưu tiên BẺ.`
        : `Bệt ${b.type} mới ${b.len} phiên — còn THEO.`
    });
  }

  // ---------- 2. SO LE 1-1 ----------
  const z = zigzagLength(R);
  if (z >= 3) {
    patterns.push({
      name: `So le 1-1`,
      doDai: z,
      loai: 'zigzag',
      duDoan: flip(R[0]), // phiên sau đảo
      doTinCay: 58 + Math.min(z, 8) * 3,
      ghiChu: `So le ${z} phiên — phiên tới đảo chiều.`
    });
  }

  // ---------- 3. KÉP 2-2 ----------
  const k2 = repeatBlock(R, 2);
  if (k2 >= 2) {
    const idx = (k2) * 2; // phiên đầu tiên chưa thuộc khối hoàn chỉnh tính từ mới nhất
    // Đang ở giữa khối? Phiên mới nhất thuộc khối k2-1 (index 0..1). Nếu R[0]===R[1] => đủ cặp => bẻ. Ngược lại theo.
    const same = R[0] === R[1];
    patterns.push({
      name: `Kép 2-2`,
      doDai: k2,
      loai: 'kep22',
      duDoan: same ? flip(R[0]) : R[0],
      doTinCay: 62 + Math.min(k2, 4) * 4,
      ghiChu: same
        ? `Cầu 2-2 (${k2} nhịp) — cặp hiện tại đủ 2 phiên, dự kiến BẺ.`
        : `Cầu 2-2 (${k2} nhịp) — cặp hiện tại mới 1 phiên, dự kiến lặp.`
    });
  }

  // ---------- 4. KÉP 3-3 ----------
  const k3 = repeatBlock(R, 3);
  if (k3 >= 2) {
    const runNow = runLength(R);
    const duDoan = runNow.len >= 3 ? flip(R[0]) : R[0];
    patterns.push({
      name: `Kép 3-3`,
      doDai: k3,
      loai: 'kep33',
      duDoan,
      doTinCay: 66 + Math.min(k3, 3) * 4,
      ghiChu: runNow.len >= 3
        ? `Cầu 3-3 — đủ 3 phiên, dự kiến BẺ.`
        : `Cầu 3-3 — mới ${runNow.len} phiên, dự kiến lặp.`
    });
  }

  // ---------- 5. KÉP 1-2 / 2-1 ----------
  for (const [p1, p2, ten] of [[1, 2, '1-2'], [2, 1, '2-1']]) {
    const pat = repeatPattern(R, p1, p2);
    if (pat.cycles >= 2) {
      // dự đoán phần tử tiếp theo: dựa vào phase hiện tại
      // Xác định phase tiếp: consumed chia dư
      // Ta mô phỏng lại để biết next phase
      let i = 0, phase = 0;
      while (i < R.length) {
        const len = phase === 0 ? p1 : p2;
        if (i + len > R.length) break;
        const block = R.slice(i, i + len);
        if (!block.every(x => x === block[0])) break;
        i += len;
        phase = 1 - phase;
      }
      const nextLen = phase === 0 ? p1 : p2;
      // phần tử tiếp theo phải giống phần tử cuối của block trước (cùng phase)
      const lastSame = R.find((x, idx) => idx < i && x === R[i - 1]);
      patterns.push({
        name: `Cầu ${ten}`,
        doDai: pat.cycles,
        loai: 'kep12',
        duDoan: R[i - 1],
        doTinCay: 60 + Math.min(pat.cycles, 4) * 3,
        ghiChu: `Cầu ${ten} (${pat.cycles} chu kỳ) — phiên tới theo nhịp ${nextLen} phiên ${R[i - 1]}.`
      });
    }
  }

  // ---------- 6. CẦU NGHIÊNG (lệch 20 phiên) ----------
  const c20 = count(R, 20);
  if (c20.total >= 15) {
    const lech = Math.abs(c20.TAI - c20.XIU);
    if (lech >= 6) {
      const thieu = c20.TAI < c20.XIU ? 'TAI' : 'XIU';
      patterns.push({
        name: `Nghiêng 20 phiên`,
        doDai: 20,
        loai: 'nghieng',
        duDoan: thieu,
        doTinCay: 55 + Math.min(lech, 10) * 2,
        ghiChu: `20 phiên lệch ${lech} (${c20.TAI}T/${c20.XIU}X) — cân bằng về ${thieu}.`
      });
    }
  }

  // ---------- 7. CẦU NGẮN (2 phiên gần đây đổi liên tục) ----------
  // nếu 6 phiên gần nhất có >=4 lần đổi -> cầu ngắn đang chạy
  let changes = 0;
  for (let i = 1; i < Math.min(8, R.length); i++) if (R[i] !== R[i - 1]) changes++;
  if (changes >= 4) {
    patterns.push({
      name: `Cầu ngắn (đảo liên tục)`,
      doDai: changes,
      loai: 'ngan',
      duDoan: flip(R[0]),
      doTinCay: 57 + Math.min(changes, 6) * 2,
      ghiChu: `${changes}/7 phiên đổi — cầu ngắn, ưu tiên đảo.`
    });
  }

  // ---------- 8. CẦU GÃY (bệt vừa gãy) ----------
  // Nếu 3 phiên đầu: A A B (bệt 2 vừa gãy) -> dự đoán tiếp B (theo cầu mới) hoặc bẻ?
  if (R.length >= 4 && R[0] === R[1] && R[1] !== R[2] && R[2] !== R[3]) {
    patterns.push({
      name: `Cầu gãy (bệt→so le)`,
      doDai: 4,
      loai: 'gay',
      duDoan: R[0],
      doTinCay: 58,
      ghiChu: `Bệt vừa gãy chuyển so le — dự kiến tiếp ${R[0]}.`
    });
  }

  return patterns;
}

/* =========================================================
   BACKTEST TỪNG CẦU trên lịch sử để chấm uy tín
   ========================================================= */
function backtestPatterns(list) {
  // với mỗi loại cầu, xem thử nếu áp dụng trên 30 phiên gần nhất thì đúng bao nhiêu
  const R = list.map(x => x.resultTruyenThong);
  const ranges = [5, 10, 15, 20, 25, 30];
  const stats = {}; // loai -> {dung, sai}
  const maxCheck = Math.min(30, list.length - 1);
  for (let i = 0; i < maxCheck; i++) {
    const past = list.slice(i + 1);
    if (past.length < 5) continue;
    const pats = detectPatterns(past);
    const actual = list[i].resultTruyenThong;
    pats.forEach(p => {
      const key = p.loai;
      if (!stats[key]) stats[key] = { dung: 0, sai: 0 };
      if (p.duDoan === actual) stats[key].dung++; else stats[key].sai++;
    });
  }
  // tính winrate & weight
  Object.keys(stats).forEach(k => {
    const s = stats[k];
    const total = s.dung + s.sai;
    s.total = total;
    s.winrate = total ? +(s.dung / total * 100).toFixed(1) : 50;
  });
  return stats;
}

/* =========================================================
   TỔNG HỢP DỰ ĐOÁN — vote có trọng số
   ========================================================= */
function predict(list) {
  if (!list || list.length < 5) {
    return { duDoan: 'TAI', doTinCay: 51, loaiCau: 'Chưa đủ dữ liệu', phanTich: 'Cần thêm phiên.', nenTheoHayBe: 'Theo', chiTietCau: [] };
  }
  const patterns = detectPatterns(list);
  const backtest = backtestPatterns(list);

  // Gán trọng số: độ dài pattern + winrate backtest + base confidence
  let voteTAI = 0, voteXIU = 0;
  const chiTietCau = patterns.map(p => {
    const bt = backtest[p.loai] || { winrate: 50, total: 0, dung: 0, sai: 0 };
    // weight = base * (winrate/100) * (1 + log độ dài)
    const base = p.doTinCay / 100;
    const wr = bt.total >= 3 ? (bt.winrate / 100) : 0.5; // nếu ít mẫu -> 50%
    const lenBoost = 1 + Math.min(p.doDai, 10) / 20;
    const weight = base * wr * lenBoost * 10;
    if (p.duDoan === 'TAI') voteTAI += weight; else voteXIU += weight;
    return {
      cau: p.name,
      duDoan: p.duDoan,
      doTinCayGoc: p.doTinCay,
      doDai: p.doDai,
      ghiChu: p.ghiChu,
      backtest: {
        mau: bt.total,
        dung: bt.dung,
        sai: bt.sai,
        winrate: bt.winrate
      }
    };
  });

  const duDoan = voteTAI >= voteXIU ? 'TAI' : 'XIU';
  const tong = voteTAI + voteXIU || 1;
  const lech = Math.abs(voteTAI - voteXIU) / tong; // 0..1

  // Độ tin cậy = 50 + lech * 40 (tối đa 90)
  let doTinCay = Math.round(50 + lech * 40);
  doTinCay = Math.max(50, Math.min(90, doTinCay));

  // Nếu các cầu mâu thuẫn nhiều -> giảm tin cậy, cảnh báo
  const soCauTheo = patterns.filter(p => p.duDoan === duDoan).length;
  const soCauNguoc = patterns.length - soCauTheo;
  if (soCauNguoc > soCauTheo) doTinCay -= 5;
  doTinCay = Math.max(50, Math.min(90, doTinCay));

  // Chọn cầu mạnh nhất (weight lớn) làm "loaiCau" hiển thị
  const sorted = patterns
    .map((p, i) => ({ ...p, w: (chiTietCau[i].backtest.winrate / 100) * p.doTinCay * (1 + p.doDai / 20) }))
    .sort((a, b) => b.w - a.w);
  const strongest = sorted[0];

  const nen = strongest && strongest.duDoan === duDoan ? 'Theo' :
    (strongest && strongest.duDoan !== duDoan ? 'Bẻ (cầu mạnh nhất ngược)' : 'Theo');

  return {
    duDoan,
    doTinCay,
    loaiCau: strongest ? strongest.name : 'Không rõ',
    phanTich: strongest ? strongest.ghiChu : 'Không có pattern rõ.',
    nenTheoHayBe: nen,
    chiTietCau,
    vote: { TAI: +voteTAI.toFixed(2), XIU: +voteXIU.toFixed(2) },
    backtestSummary: backtest
  };
}

/* =========================================================
   API ENDPOINTS
   ========================================================= */

// JSON chi tiết
app.get('/dunphi', async (req, res) => {
  try {
    const list = await fetchHistory();
    if (!list.length) return res.status(503).json({ error: 'Không có dữ liệu' });
    const latest = list[0];
    const nextId = latest.id + 1;
    const p = predict(list);
    const R = list.map(x => x.resultTruyenThong);
    const rl = runLength(R);
    const zz = zigzagLength(R);

    res.json({
      phienTruoc: {
        id: latest.id,
        ketQua: latest.resultTruyenThong,
        dice: latest.dices,
        point: latest.point
      },
      phienDuDoan: nextId,
      duDoan: p.duDoan,
      doTinCay: p.doTinCay,
      loaiCauChinh: p.loaiCau,
      phanTich: p.phanTich,
      nenTheoHayBe: p.nenTheoHayBe,
      chiTietCau: p.chiTietCau,
      vote: p.vote,
      thongKe: {
        betHienTai: `${rl.type} x${rl.len}`,
        soLe: `x${zz}`,
        tai10: count(R, 10).TAI,
        xiu10: count(R, 10).XIU,
        tai20: count(R, 20).TAI,
        xiu20: count(R, 20).XIU,
        tai30: count(R, 30).TAI,
        xiu30: count(R, 30).XIU
      },
      backtestTheoLoaiCau: p.backtestSummary,
      lichSuGanNhat: list.slice(0, 20).map(x => ({
        id: x.id,
        ketQua: x.resultTruyenThong,
        point: x.point,
        dice: x.dices
      })),
      thoiGian: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HTML check đúng/sai
app.get('/dun', async (req, res) => {
  try {
    const list = await fetchHistory();
    if (!list.length) return res.status(503).send('<h1>Không có dữ liệu</h1>');

    const rows = [];
    let dung = 0, sai = 0;
    const maxCheck = Math.min(40, list.length - 1);
    for (let i = 0; i < maxCheck; i++) {
      const actual = list[i];
      const past = list.slice(i + 1);
      if (past.length < 6) continue;
      const p = predict(past);
      const ok = p.duDoan === actual.resultTruyenThong;
      if (ok) dung++; else sai++;
      rows.push({
        id: actual.id,
        dice: actual.dices.join('-'),
        point: actual.point,
        ketQua: actual.resultTruyenThong,
        duDoan: p.duDoan,
        doTinCay: p.doTinCay,
        loaiCau: p.loaiCau,
        check: ok ? 'ĐÚNG' : 'SAI'
      });
    }

    const tong = dung + sai;
    const tyLe = tong ? ((dung / tong) * 100).toFixed(1) : 0;
    const next = predict(list);
    const latest = list[0];

    const html = `<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Dự đoán LC79 v2</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:16px}
h1{font-size:20px;text-align:center;color:#38bdf8;margin:4px 0 16px}
.card{background:#16213a;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 12px rgba(0,0,0,.35)}
.pred{text-align:center}.pred .lbl{font-size:13px;color:#94a3b8}
.pred .val{font-size:44px;font-weight:800;margin:6px 0}
.tai{color:#ef4444}.xiu{color:#22c55e}
.conf{font-size:19px;font-weight:700;color:#facc15}
.row{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;font-size:13px;margin-top:8px;color:#cbd5e1}
.stat{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;margin-top:8px}
.stat span{background:#243354;padding:4px 9px;border-radius:7px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:7px 5px;text-align:center;border-bottom:1px solid #243354}
th{color:#94a3b8;font-weight:600}
.dung{color:#22c55e;font-weight:700}.sai{color:#ef4444;font-weight:700}
.badge{padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px}
.badge.tai{background:rgba(239,68,68,.22)}.badge.xiu{background:rgba(34,197,94,.22)}
.summary{display:flex;gap:14px;justify-content:center;font-size:15px;flex-wrap:wrap}
.summary b{color:#facc15}
.small{font-size:11px;color:#64748b;text-align:center;margin-top:6px}
.detail{font-size:12px;color:#cbd5e1;line-height:1.55}
.detail b{color:#38bdf8}
</style></head><body>
<h1>🎲 Dự đoán LC79 — Phiên ${latest.id + 1}</h1>
<div class="card pred">
  <div class="lbl">Dự đoán phiên tới (${latest.id + 1})</div>
  <div class="val ${next.duDoan === 'TAI' ? 'tai' : 'xiu'}">${next.duDoan}</div>
  <div class="conf">Độ tin cậy: ${next.doTinCay}%</div>
  <div class="row">
    <div><b>Cầu chính:</b> ${next.loaiCau}</div>
    <div><b>Nên:</b> ${next.nenTheoHayBe}</div>
  </div>
  <div class="small">${next.phanTich}</div>
</div>

<div class="card">
  <div class="summary">
    <div>Tổng check: <b>${tong}</b></div>
    <div>Đúng: <b class="dung">${dung}</b></div>
    <div>Sai: <b class="sai">${sai}</b></div>
    <div>Tỷ lệ: <b>${tyLe}%</b></div>
  </div>
</div>

<div class="card">
  <div class="detail">
    ${next.chiTietCau.map(c => `<div>• <b>${c.cau}</b> → ${c.duDoan} (${c.doTinCayGoc}%) | backtest: ${c.backtest.dung}/${c.backtest.mau} = ${c.backtest.winrate}% — <i>${c.ghiChu}</i></div>`).join('')}
  </div>
</div>

<div class="card" style="overflow-x:auto">
<table>
<thead><tr><th>Phiên</th><th>Dice</th><th>Điểm</th><th>KQ</th><th>Dự đoán</th><th>Tin cậy</th><th>Cầu</th><th>Check</th></tr></thead>
<tbody>
${rows.map(r => `<tr>
<td>${r.id}</td><td>${r.dice}</td><td>${r.point}</td>
<td><span class="badge ${r.ketQua === 'TAI' ? 'tai' : 'xiu'}">${r.ketQua}</span></td>
<td><span class="badge ${r.duDoan === 'TAI' ? 'tai' : 'xiu'}">${r.duDoan}</span></td>
<td>${r.doTinCay}%</td>
<td style="font-size:10px;color:#94a3b8">${r.loaiCau}</td>
<td class="${r.check === 'ĐÚNG' ? 'dung' : 'sai'}">${r.check}</td>
</tr>`).join('')}
</tbody></table></div>
<div class="small">Tự làm mới 15s • /dunphi (JSON) • /dun (HTML)</div>
</body></html>`;
    res.send(html);
  } catch (e) {
    res.status(500).send('<h1>Lỗi: ' + e.message + '</h1>');
  }
});

app.get('/', (req, res) => res.json({
  api: 'LC79 Predictor v2',
  endpoints: { '/dunphi': 'JSON chi tiết', '/dun': 'HTML check' }
}));

app.listen(PORT, () => console.log('Server port ' + PORT));
