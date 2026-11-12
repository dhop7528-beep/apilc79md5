const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// Cache lịch sử
let historyCache = [];
let lastFetch = 0;
const CACHE_TTL = 5000; // 5 giây

async function fetchHistory() {
  const now = Date.now();
  if (historyCache.length && now - lastFetch < CACHE_TTL) {
    return historyCache;
  }
  try {
    const res = await axios.get(API_URL, { timeout: 8000 });
    let data = res.data;
    let list = data.list || (Array.isArray(data) ? data : []);
    // sort giảm dần theo id (mới nhất trước)
    list.sort((a, b) => b.id - a.id);
    historyCache = list;
    lastFetch = now;
    return list;
  } catch (e) {
    console.error('Fetch error:', e.message);
    return historyCache;
  }
}

// ==================== PHÂN TÍCH CẦU ====================
function analyze(list) {
  // list: mới nhất -> cũ
  const results = list.map(x => x.resultTruyenThong); // "TAI" | "XIU"

  // Đếm chuỗi liên tiếp hiện tại (bệt)
  let streakType = results[0];
  let streakLen = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLen++;
    else break;
  }

  // Pattern 1-1 (so le) gần nhất
  let zigzagLen = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) zigzagLen++;
    else break;
  }

  // Pattern 2-2
  let pattern22 = 0;
  for (let i = 0; i + 3 < results.length; i += 2) {
    if (results[i] === results[i + 1] && results[i + 2] === results[i + 3] && results[i] !== results[i + 2]) {
      pattern22++;
    } else break;
  }

  // Pattern 3-3
  let pattern33 = 0;
  for (let i = 0; i + 5 < results.length; i += 3) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2] &&
        results[i + 3] === results[i + 4] && results[i + 4] === results[i + 5] &&
        results[i] !== results[i + 3]) {
      pattern33++;
    } else break;
  }

  // Pattern 1-2 hoặc 2-1 (cầu 1-2)
  let pattern12 = 0;
  let i12 = 0;
  while (i12 + 2 < results.length) {
    const a = results[i12], b = results[i12 + 1], c = results[i12 + 2];
    if (a === b && b !== c) { pattern12++; i12 += 2; }
    else if (a !== b && b === c) { pattern12++; i12 += 2; }
    else break;
  }

  // Đếm tổng trong 20 phiên gần nhất
  const last20 = results.slice(0, 20);
  const countTai = last20.filter(x => x === 'TAI').length;
  const countXiu = last20.length - countTai;

  // Đếm tổng 10 phiên
  const last10 = results.slice(0, 10);
  const tai10 = last10.filter(x => x === 'TAI').length;

  // Tổng điểm dice gần nhất (để đo "nhiệt")
  const last5Points = list.slice(0, 5).map(x => x.point);
  const avgPoint = last5Points.reduce((a, b) => a + b, 0) / last5Points.length;

  return {
    results,
    streakType,
    streakLen,
    zigzagLen,
    pattern12,
    pattern22,
    pattern33,
    countTai,
    countXiu,
    tai10,
    xiu10: 10 - tai10,
    avgPoint,
    last20
  };
}

// ==================== DỰ ĐOÁN ====================
function predict(list) {
  if (!list || list.length < 5) {
    return {
      duDoan: 'TAI',
      doTinCay: 51,
      loaiCau: 'Không đủ dữ liệu',
      phanTich: 'Chưa đủ dữ liệu lịch sử để phân tích cầu.',
      nenTheoHayBe: 'Theo (mặc định)'
    };
  }

  const a = analyze(list);
  const last = a.results[0];

  let duDoan = 'TAI';
  let doTinCay = 60;
  let loaiCau = '';
  let phanTich = '';
  let nenTheoHayBe = 'Theo';

  // ==== Ưu tiên 1: Bệt dài ====
  if (a.streakLen >= 4) {
    if (a.streakLen >= 6) {
      // Bệt rất dài -> chuẩn bị bẻ
      duDoan = a.streakType === 'TAI' ? 'XIU' : 'TAI';
      doTinCay = 55 + Math.min(a.streakLen * 2, 20);
      loaiCau = `Cầu bệt ${a.streakType} x${a.streakLen}`;
      phanTich = `Đang có chuỗi bệt ${a.streakType} dài ${a.streakLen} phiên. Bệt quá dài thường sớm gãy, ưu tiên BẺ.`;
      nenTheoHayBe = 'Bẻ';
    } else {
      // Bệt vừa 4-5 -> còn theo
      duDoan = a.streakType;
      doTinCay = 62 + a.streakLen;
      loaiCau = `Cầu bệt ${a.streakType} x${a.streakLen}`;
      phanTich = `Chuỗi bệt ${a.streakType} mới ${a.streakLen} phiên, xu hướng còn tiếp diễn. Nên THEO.`;
      nenTheoHayBe = 'Theo';
    }
  }
  // ==== Ưu tiên 2: Cầu 1-1 (zigzag) ====
  else if (a.zigzagLen >= 4) {
    duDoan = last === 'TAI' ? 'XIU' : 'TAI';
    doTinCay = 65 + Math.min(a.zigzagLen, 12);
    loaiCau = `Cầu 1-1 (so le) x${a.zigzagLen}`;
    phanTich = `Chuỗi so le 1-1 đã ${a.zigzagLen} phiên, tiếp tục đảo chiều. Nên THEO cầu so le.`;
    nenTheoHayBe = 'Theo';
  }
  // ==== Ưu tiên 3: Cầu 2-2 ====
  else if (a.pattern22 >= 2) {
    // Đang ở nửa đầu hay nửa sau của cặp 2-2?
    // Đếm xem phiên cuối có trùng với phiên trước không
    const sameAsPrev = a.results[0] === a.results[1];
    if (sameAsPrev) {
      // đã đủ cặp -> bẻ
      duDoan = last === 'TAI' ? 'XIU' : 'TAI';
      doTinCay = 68;
      loaiCau = `Cầu 2-2 x${a.pattern22}`;
      phanTich = `Cầu 2-2 đang chạy, cặp hiện tại đã đủ 2 phiên. Dự kiến BẺ sang cửa đối diện.`;
      nenTheoHayBe = 'Bẻ';
    } else {
      // mới 1 phiên -> theo
      duDoan = last;
      doTinCay = 66;
      loaiCau = `Cầu 2-2 x${a.pattern22}`;
      phanTich = `Cầu 2-2 đang chạy, cặp hiện tại mới 1 phiên. Dự kiến lặp lại phiên nữa.`;
      nenTheoHayBe = 'Theo';
    }
  }
  // ==== Ưu tiên 4: Cầu 3-3 ====
  else if (a.pattern33 >= 1) {
    duDoan = last === 'TAI' ? 'XIU' : 'TAI';
    doTinCay = 70;
    loaiCau = `Cầu 3-3 x${a.pattern33}`;
    phanTich = `Cầu 3-3 xuất hiện, đến cuối chuỗi 3 phiên nên bẻ.`;
    nenTheoHayBe = 'Bẻ';
  }
  // ==== Ưu tiên 5: Cầu 1-2 ====
  else if (a.pattern12 >= 2) {
    duDoan = last === 'TAI' ? 'XIU' : 'TAI';
    doTinCay = 63;
    loaiCau = `Cầu 1-2 x${a.pattern12}`;
    phanTich = `Cầu 1-2 (1-2 hoặc 2-1) đang chạy, dự kiến đảo chiều theo nhịp.`;
    nenTheoHayBe = 'Bẻ';
  }
  // ==== Fallback: cân bằng âm dương ====
  else {
    // Nếu 10 phiên gần lệch nhiều -> bẻ về cân bằng
    if (a.tai10 >= 7) {
      duDoan = 'XIU';
      doTinCay = 58;
      loaiCau = 'Cầu lệch Tài';
      phanTich = `10 phiên gần có ${a.tai10} Tài - quá lệch, khả năng cân bằng về Xỉu.`;
      nenTheoHayBe = 'Bẻ';
    } else if (a.tai10 <= 3) {
      duDoan = 'TAI';
      doTinCay = 58;
      loaiCau = 'Cầu lệch Xỉu';
      phanTich = `10 phiên gần có ${a.xiu10} Xỉu - quá lệch, khả năng cân bằng về Tài.`;
      nenTheoHayBe = 'Bẻ';
    } else {
      // theo phiên trước
      duDoan = last;
      doTinCay = 52;
      loaiCau = 'Cầu ngẫu nhiên / không rõ';
      phanTich = `Không có pattern rõ ràng. Tạm theo phiên trước (${last}).`;
      nenTheoHayBe = 'Theo';
    }
  }

  // Giới hạn độ tin cậy 50-90
  doTinCay = Math.max(50, Math.min(90, Math.round(doTinCay)));

  return {
    duDoan,
    doTinCay,
    loaiCau,
    phanTich,
    nenTheoHayBe
  };
}

// ==================== API ENDPOINTS ====================

// API JSON dự đoán
app.get('/dunphi', async (req, res) => {
  try {
    const list = await fetchHistory();
    if (!list.length) {
      return res.status(503).json({ error: 'Không lấy được dữ liệu lịch sử' });
    }
    const latest = list[0];
    const nextId = latest.id + 1;
    const p = predict(list);

    // Thống kê pattern
    const a = analyze(list);

    res.json({
      phienDuDoan: nextId,
      phienGanNhat: {
        id: latest.id,
        ketQua: latest.resultTruyenThong,
        dice: latest.dices,
        point: latest.point
      },
      duDoan: p.duDoan,
      doTinCay: p.doTinCay,
      loaiCau: p.loaiCau,
      phanTich: p.phanTich,
      nenTheoHayBe: p.nenTheoHayBe,
      thongKe: {
        bbetHienTai: `${a.streakType} x${a.streakLen}`,
        soLe: `x${a.zigzagLen}`,
        cau22: a.pattern22,
        cau33: a.pattern33,
        cau12: a.pattern12,
        tai10: a.tai10,
        xiu10: a.xiu10,
        tai20: a.countTai,
        xiu20: a.countXiu,
        diemTB5: a.avgPoint.toFixed(2)
      },
      thoiGian: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API HTML check đúng/sai (lịch sử tự kiểm tra)
app.get('/dun', async (req, res) => {
  try {
    const list = await fetchHistory();
    if (!list.length) {
      return res.status(503).send('<h1>Không lấy được dữ liệu</h1>');
    }

    // Duyệt lịch sử: với mỗi phiên i (từ cũ -> mới), dự đoán dựa trên list[i+1..] rồi so với list[i]
    // list: mới nhất -> cũ. Để dự đoán phiên i, dùng list[i+1..end] (dữ liệu trước đó).
    const rows = [];
    let dung = 0, sai = 0;

    // Chỉ check 30 phiên gần nhất (bỏ phiên mới nhất vì chưa có phiên kế tiếp)
    const checkRange = Math.min(30, list.length - 1);
    for (let i = 0; i < checkRange; i++) {
      const actual = list[i]; // phiên cần dự đoán (đã có KQ)
      const past = list.slice(i + 1); // lịch sử trước phiên đó
      if (past.length < 3) continue;
      const p = predict(past);
      const isCorrect = p.duDoan === actual.resultTruyenThong;
      if (isCorrect) dung++; else sai++;
      rows.push({
        id: actual.id,
        ketQua: actual.resultTruyenThong,
        dice: actual.dices,
        point: actual.point,
        duDoan: p.duDoan,
        doTinCay: p.doTinCay,
        loaiCau: p.loaiCau,
        dungSai: isCorrect ? 'ĐÚNG' : 'SAI'
      });
    }

    const tong = dung + sai;
    const tyLe = tong ? ((dung / tong) * 100).toFixed(1) : 0;

    // Dự đoán phiên tới
    const nextPred = predict(list);
    const latest = list[0];

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="15">
<title>Dự đoán LC79 - Check Đúng/Sai</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 16px; }
  h1 { font-size: 22px; text-align: center; color: #38bdf8; }
  .card { background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
  .pred { text-align: center; }
  .pred .label { font-size: 14px; color: #94a3b8; }
  .pred .value { font-size: 42px; font-weight: 800; margin: 6px 0; }
  .tai { color: #ef4444; }
  .xiu { color: #22c55e; }
  .conf { font-size: 20px; font-weight: 700; color: #facc15; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; font-size: 14px; margin-top: 8px; color: #cbd5e1; }
  .stat { display: flex; gap: 12px; flex-wrap: wrap; font-size: 14px; }
  .stat span { background: #334155; padding: 4px 10px; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 6px; text-align: center; border-bottom: 1px solid #334155; }
  th { color: #94a3b8; font-weight: 600; }
  .dung { color: #22c55e; font-weight: 700; }
  .sai { color: #ef4444; font-weight: 700; }
  .badge { padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; }
  .badge.tai { background: rgba(239,68,68,.2); }
  .badge.xiu { background: rgba(34,197,94,.2); }
  .summary { display: flex; gap: 16px; justify-content: center; font-size: 16px; margin-top: 8px; }
  .summary b { color: #facc15; }
  .small { font-size: 12px; color: #64748b; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
  <h1>🎲 Dự đoán LC79 - Phiên ${latest.id + 1}</h1>

  <div class="card pred">
    <div class="label">Dự đoán phiên tới (${latest.id + 1})</div>
    <div class="value ${nextPred.duDoan === 'TAI' ? 'tai' : 'xiu'}">${nextPred.duDoan}</div>
    <div class="conf">Độ tin cậy: ${nextPred.doTinCay}%</div>
    <div class="row">
      <div><b>Loại cầu:</b> ${nextPred.loaiCau}</div>
      <div><b>Nên:</b> ${nextPred.nenTheoHayBe}</div>
    </div>
    <div class="small">${nextPred.phanTich}</div>
  </div>

  <div class="card">
    <div class="summary">
      <div>Tổng check: <b>${tong}</b></div>
      <div>Đúng: <b class="dung">${dung}</b></div>
      <div>Sai: <b class="sai">${sai}</b></div>
      <div>Tỷ lệ: <b>${tyLe}%</b></div>
    </div>
  </div>

  <div class="card" style="overflow-x:auto;">
    <table>
      <thead>
        <tr><th>Phiên</th><th>Dice</th><th>Điểm</th><th>KQ</th><th>Dự đoán</th><th>Tin cậy</th><th>Cầu</th><th>Check</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.id}</td>
            <td>${r.dice.join('-')}</td>
            <td>${r.point}</td>
            <td><span class="badge ${r.ketQua === 'TAI' ? 'tai' : 'xiu'}">${r.ketQua}</span></td>
            <td><span class="badge ${r.duDoan === 'TAI' ? 'tai' : 'xiu'}">${r.duDoan}</span></td>
            <td>${r.doTinCay}%</td>
            <td style="font-size:11px;color:#94a3b8;">${r.loaiCau}</td>
            <td class="${r.dungSai === 'ĐÚNG' ? 'dung' : 'sai'}">${r.dungSai}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="small">Tự động làm mới sau 15 giây • API: /dunphi (JSON) • /dun (HTML)</div>
</body>
</html>`;

    res.send(html);
  } catch (e) {
    res.status(500).send('<h1>Lỗi: ' + e.message + '</h1>');
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'LC79 Predictor API',
    endpoints: {
      '/dunphi': 'JSON dự đoán phiên tới',
      '/dun': 'HTML check đúng/sai + dự đoán'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server chạy tại port ${PORT}`);
});
