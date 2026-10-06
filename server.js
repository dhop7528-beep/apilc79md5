const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// ================== CACHE ==================
let cache = { data: null, time: 0 };
const CACHE_TTL = 3000;

async function layLichSu() {
  const now = Date.now();
  if (cache.data && now - cache.time < CACHE_TTL) return cache.data;
  const res = await axios.get(API_URL, { timeout: 10000 });
  cache.data = res.data;
  cache.time = now;
  return res.data;
}

// ================== NHẬN DIỆN PATTEN ==================
/**
 * Trả về:
 *  - tenPatten: tên patten đang chạy
 *  - moTa: mô tả
 *  - duDoan: TAI / XIU (phiên kế tiếp theo patten)
 *  - doTinCay: 0-100
 */
function nhanDienPatten(list) {
  // list[0] là mới nhất -> đảo lại thành chuỗi cũ -> mới để dễ đọc
  const chuoiMoi = list.slice(0, 30).map(r => r.resultTruyenThong === 'TAI' ? 'T' : 'X');
  // chuoiMoi[0] = mới nhất
  const c = chuoiMoi; // ví dụ: ['T','X','X','T','X','X',...]

  // Hàm đối chiếu 1 mẫu (pattern) với chuỗi, trả về số lần khớp liên tiếp từ đầu
  function khop(mau) {
    let dem = 0;
    for (let i = 0; i < mau.length && i < c.length; i++) {
      if (c[i] === mau[i]) dem++;
      else break;
    }
    return dem;
  }

  // ===== 1. Bệt cầu (streak) =====
  let bet = 1;
  for (let i = 1; i < c.length; i++) {
    if (c[i] === c[0]) bet++;
    else break;
  }

  // ===== 2. Cầu 1-1 (T X T X T X) =====
  const mau1_1 = ['T','X','T','X','T','X'];
  const mau1_1_dao = ['X','T','X','T','X','T'];
  const khop1_1 = Math.max(khop(mau1_1), khop(mau1_1_dao));

  // ===== 3. Cầu 2-2 (T T X X T T) =====
  const mau2_2 = ['T','T','X','X','T','T'];
  const mau2_2_dao = ['X','X','T','T','X','X'];
  const khop2_2 = Math.max(khop(mau2_2), khop(mau2_2_dao));

  // ===== 4. Cầu 3-3 (T T T X X X) =====
  const mau3_3 = ['T','T','T','X','X','X'];
  const mau3_3_dao = ['X','X','X','T','T','T'];
  const khop3_3 = Math.max(khop(mau3_3), khop(mau3_3_dao));

  // ===== 5. Patten TXXTXX (1 T - 2 X lặp) =====
  const mauTXX = ['T','X','X','T','X','X'];
  const mauTXX_dao = ['X','T','T','X','T','T'];
  const khopTXX = Math.max(khop(mauTXX), khop(mauTXX_dao));

  // ===== 6. Patten TTXXTTXX (2-2 lặp) đã bao ở 2-2 =====
  // ===== 7. Patten TTTXXX (3-3 lặp) đã bao ở 3-3 =====

  // ===== 8. Cầu lẻ 1-2-1-2 =====
  const mauLe = ['T','X','X','T','X','X']; // giống TXX
  // ===== 9. Cầu đối xứng T X X T =====
  const mauDoiXung = ['T','X','X','T','X','X'];

  // ===== Chọn patten khớp dài nhất =====
  let pattenTotNhat = { ten: 'Không rõ', moTa: 'Chưa khớp patten nào', duDoan: null, doTinCay: 0, khop: 0 };

  const dsPatten = [
    {
      ten: 'Bệt cầu',
      moTa: `Bệt ${c[0] === 'T' ? 'TAI' : 'XIU'} ${bet} phiên`,
      khop: bet,
      duDoan: bet >= 6 ? c[0] : (c[0] === 'T' ? 'X' : 'T'),
      doTinCay: bet >= 6 ? 75 : bet >= 4 ? 70 : 55,
    },
    {
      ten: 'Cầu 1-1 (T-X-T-X)',
      moTa: 'Cầu đảo liên tục 1 TAI 1 XIU',
      khop: khop1_1,
      duDoan: c[0] === 'T' ? 'X' : 'T',
      doTinCay: 80,
    },
    {
      ten: 'Cầu 2-2 (TT-XX-TT-XX)',
      moTa: 'Cầu 2 TAI 2 XIU lặp lại',
      khop: khop2_2,
      duDoan: (() => {
        // Nếu 2 phiên gần nhất giống nhau -> sắp đảo
        if (c[0] === c[1]) return c[0] === 'T' ? 'X' : 'T';
        return c[0]; // còn trong cặp thì giữ
      })(),
      doTinCay: 78,
    },
    {
      ten: 'Cầu 3-3 (TTT-XXX)',
      moTa: 'Cầu 3 TAI 3 XIU lặp lại',
      khop: khop3_3,
      duDoan: (() => {
        let dem = 1;
        for (let i = 1; i < 3; i++) if (c[i] === c[0]) dem++; else break;
        return dem >= 3 ? (c[0] === 'T' ? 'X' : 'T') : c[0];
      })(),
      doTinCay: 75,
    },
    {
      ten: 'Patten TXX-TXX (1T-2X)',
      moTa: 'Cầu 1 TAI 2 XIU lặp lại (T X X T X X)',
      khop: khopTXX,
      duDoan: (() => {
        // Chu kỳ 3: T X X | T X X | ...
        const viTri = c.length >= 3 ? (khopTXX % 3) : 0;
        // vị trí kế tiếp trong chu kỳ
        const chuKy = c[0] === 'T' ? ['T','X','X'] : ['X','T','T'];
        const idxTiep = khopTXX % 3;
        return chuKy[idxTiep];
      })(),
      doTinCay: 82,
    },
  ];

  // Tìm patten khớp >= 4 phần tử
  dsPatten.forEach(p => {
    if (p.khop >= 4 && p.khop > pattenTotNhat.khop) {
      pattenTotNhat = p;
    }
  });

  // Nếu không có patten nào khớp >=4, dùng bệt nếu >=3
  if (pattenTotNhat.khop < 4 && bet >= 3) {
    pattenTotNhat = dsPatten[0];
  }

  return pattenTotNhat;
}

// ================== THUẬT TOÁN DỰ ĐOÁN TỔNG HỢP ==================
function duDoan(list) {
  const recent20 = list.slice(0, 20);
  const last10 = list.slice(0, 10);
  const last5 = list.slice(0, 5);

  const diem = { TAI: 0, XIU: 0 };
  const lyDo = [];

  // 1. Patten
  const patten = nhanDienPatten(list);
  if (patten.duDoan) {
    diem[patten.duDoan === 'T' ? 'TAI' : 'XIU'] += 3;
    lyDo.push(`Patten "${patten.ten}": ${patten.moTa} → dự đoán ${patten.duDoan === 'T' ? 'TAI' : 'XIU'}`);
  }

  // 2. Bệt cầu
  let bet = 1;
  for (let i = 1; i < recent20.length; i++) {
    if (recent20[i].resultTruyenThong === recent20[0].resultTruyenThong) bet++;
    else break;
  }
  if (bet >= 6) {
    diem[recent20[0].resultTruyenThong] += 2;
    lyDo.push(`Bệt ${recent20[0].resultTruyenThong} dài ${bet} phiên, khả năng tiếp tục`);
  } else if (bet >= 4) {
    const nguoc = recent20[0].resultTruyenThong === 'TAI' ? 'XIU' : 'TAI';
    diem[nguoc] += 2;
    lyDo.push(`Bệt ${recent20[0].resultTruyenThong} ${bet} phiên, có dấu hiệu đảo`);
  }

  // 3. Tần suất 20 phiên
  const dem20 = { TAI: 0, XIU: 0 };
  recent20.forEach(r => dem20[r.resultTruyenThong]++);
  if (dem20.TAI > dem20.XIU + 5) {
    diem.XIU += 1;
    lyDo.push(`20 phiên TAI áp đảo (${dem20.TAI}/${dem20.XIU}), nghiêng XIU`);
  } else if (dem20.XIU > dem20.TAI + 5) {
    diem.TAI += 1;
    lyDo.push(`20 phiên XIU áp đảo (${dem20.XIU}/${dem20.TAI}), nghiêng TAI`);
  }

  // 4. Điểm trung bình 10 phiên
  const diemTB = last10.reduce((s, r) => s + r.point, 0) / last10.length;
  if (diemTB >= 13) {
    diem.XIU += 1;
    lyDo.push(`Điểm TB 10 phiên cao (${diemTB.toFixed(1)}) → nghiêng XIU`);
  } else if (diemTB <= 9) {
    diem.TAI += 1;
    lyDo.push(`Điểm TB 10 phiên thấp (${diemTB.toFixed(1)}) → nghiêng TAI`);
  }

  // 5. Xu hướng 5 phiên
  const dem5 = { TAI: 0, XIU: 0 };
  last5.forEach(r => dem5[r.resultTruyenThong]++);
  if (dem5.TAI >= 4) {
    diem.XIU += 1;
    lyDo.push('5 phiên gần nhất TAI áp đảo');
  } else if (dem5.XIU >= 4) {
    diem.TAI += 1;
    lyDo.push('5 phiên gần nhất XIU áp đảo');
  }

  // Tổng kết
  let ketQua;
  if (diem.TAI > diem.XIU) ketQua = 'TAI';
  else if (diem.XIU > diem.TAI) ketQua = 'XIU';
  else ketQua = recent20[0].resultTruyenThong === 'TAI' ? 'XIU' : 'TAI';

  const tong = diem.TAI + diem.XIU || 1;
  const doTinCay = Math.round((Math.max(diem.TAI, diem.XIU) / tong) * 100);

  return { ketQua, doTinCay, diem, lyDo, patten };
}

// ================== API ==================
app.get('/dudoan', async (req, res) => {
  try {
    const data = await layLichSu();
    const list = data.list;
    if (!list || list.length === 0) return res.status(500).json({ loi: 'Không có dữ liệu' });

    const phienTruoc = list[0];
    const duDoanKQ = duDoan(list);

    // Vẽ chuỗi patten 20 phiên gần nhất (cũ -> mới)
    const chuoiPatten = list.slice(0, 20).reverse().map(r => r.resultTruyenThong === 'TAI' ? 'T' : 'X');
    const chuoiPattenStr = chuoiPatten.join('');

    res.json({
      thanhCong: true,
      capNhatLuc: new Date().toISOString(),
      thongKe: data.typeStat,

      phienTruoc: {
        id: phienTruoc.id,
        ma: phienTruoc._id,
        ketQua: phienTruoc.resultTruyenThong,
        xucXac: phienTruoc.dices,
        diem: phienTruoc.point,
      },

      phienDuDoan: {
        id: phienTruoc.id + 1,
        duDoan: duDoanKQ.ketQua,
        doTinCay: duDoanKQ.doTinCay + '%',
        diem: duDoanKQ.diem,
        lyDo: duDoanKQ.lyDo,
      },

      patten: {
        dangChay: duDoanKQ.patten.ten,
        moTa: duDoanKQ.patten.moTa,
        soPhienKhop: duDoanKQ.patten.khop,
        doTinCay: duDoanKQ.patten.doTinCay + '%',
      },

      chuoiPatten20Phien: chuoiPattenStr,
      chuoiPattenMoiNhat: chuoiPatten.slice().reverse().join(''),

      muoiPhienGanNhat: list.slice(0, 10).map(r => ({
        id: r.id,
        ketQua: r.resultTruyenThong,
        xucXac: r.dices,
        diem: r.point,
      })),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ thanhCong: false, loi: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ trangThai: 'ok', api: '/dudoan' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy: http://localhost:${PORT}`);
  console.log(`📊 API dự đoán: http://localhost:${PORT}/dudoan`);
});
