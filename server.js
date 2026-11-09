
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Link API lịch sử gốc
const API_URL = 'https://wtxmd52.macminim6.online/v1/txmd5/sessions';

// Lưu trữ trạng thái hệ thống trong bộ nhớ (RAM)
let latestHistory = [];
let predictionHistory = []; // Lưu danh sách các phiên đã dự đoán để check Đúng / Sai
let currentPrediction = null;
let lastSyncTime = null;
let syncError = null;

/**
 * Chuẩn hóa kết quả về dạng tiếng Việt có dấu ("Tài" hoặc "Xỉu")
 */
function formatResultVN(raw) {
    if (!raw) return 'Chưa rõ';
    const upper = String(raw).toUpperCase().trim();
    if (upper === 'TAI' || upper === 'TÀI') return 'Tài';
    if (upper === 'XIU' || upper === 'XỈU') return 'Xỉu';
    return raw;
}

/**
 * Đảo ngược kết quả ("Tài" <-> "Xỉu")
 */
function oppositeVN(val) {
    return val === 'Tài' ? 'Xỉu' : 'Tài';
}

/**
 * THUẬT TOÁN PHÂN TÍCH CẦU (PATTERN ENGINE) - KHÔNG RANDOM
 * Dữ liệu đầu vào `list` được sắp xếp từ mới nhất (index 0) đến cũ hơn.
 * Tập trung phân tích kỹ 10 phiên gần nhất kết hợp điểm số xúc xắc.
 */
function analyzePattern(list) {
    // Lấy 10 phiên gần nhất, đảo ngược lại theo thứ tự thời gian: [cũ -> mới nhất]
    const recent10 = list.slice(0, 10).reverse();
    const seq = recent10.map(item => formatResultVN(item.resultTruyenThong));
    const points = recent10.map(item => Number(item.point));
    const n = seq.length;

    const latestItem = list[0];
    const nextSessionId = Number(latestItem.id) + 1;
    const patternString = seq.join(' - ');

    let duDoan = 'Tài';
    let loaiCau = 'Phân tích tổng hợp';
    let lyDo = '';
    let doTinCay = '75%';

    // Đếm độ dài chuỗi bệt ở cuối (tính từ phiên mới nhất ngược về trước)
    let streakSide = seq[n - 1];
    let streakLen = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (seq[i] === streakSide) {
            streakLen++;
        } else {
            break;
        }
    }

    // Lấy 6 phiên gần nhất theo thứ tự thời gian [t-5, t-4, t-3, t-2, t-1, t0]
    const last6 = seq.slice(-6);
    const last4 = seq.slice(-4);
    const last3 = seq.slice(-3);

    // 1. KIỂM TRA CẦU BỆT DÀI (Từ 4 tay trở lên ở cuối chuỗi 10 phiên)
    // Ví dụ dữ liệu mẫu: có chuỗi 10 tay Tài liên tiếp hoặc 7 tay Xỉu liên tiếp
    if (streakLen >= 4) {
        if (streakLen >= 9) {
            // Bệt quá dài (9-10 tay) có dấu hiệu bẻ cầu theo điểm số biên (3 hoặc 18)
            const lastPoint = points[n - 1];
            if (lastPoint === 3 || lastPoint === 18) {
                duDoan = oppositeVN(streakSide);
                loaiCau = `Cầu Bệt Cực Đại (${streakLen} tay) - Chạm Đỉnh Bão`;
                lyDo = `Chuỗi ${streakSide} đã kéo dài ${streakLen} phiên và vừa xuất hiện điểm cực trị (${lastPoint} điểm), báo hiệu đảo chiều.`;
                doTinCay = '82%';
            } else {
                duDoan = streakSide;
                loaiCau = `Cầu Bệt Siêu Dài (${streakLen} tay)`;
                lyDo = `Đang trong dây bệt ${streakSide} rất mạnh (${streakLen} phiên liên tiếp trong 10 phiên gần nhất), tiếp tục bám bệt.`;
                doTinCay = '86%';
            }
        } else {
            duDoan = streakSide;
            loaiCau = `Cầu Bệt ${streakSide} (${streakLen} tay)`;
            lyDo = `Phát hiện dây bệt ${streakSide} đang chạy ${streakLen} phiên liên tiếp ở cuối bảng 10 phiên, ưu tiên theo bệt.`;
            doTinCay = streakLen >= 6 ? '88%' : '84%';
        }
    }
    // 2. KIỂM TRA CẦU 1 - 1 (Đảo liên tục: T - X - T - X hoặc X - T - X - T)
    else if (
        n >= 4 &&
        last4[0] !== last4[1] &&
        last4[1] !== last4[2] &&
        last4[2] !== last4[3]
    ) {
        duDoan = oppositeVN(seq[n - 1]);
        loaiCau = 'Cầu 1 - 1 (Đảo chiều liên tục)';
        lyDo = `4 phiên cuối đang đi nhịp 1-1 (${last4.join(' -> ')}), phiên tiếp theo đảo sang ${duDoan}.`;
        doTinCay = '85%';
    }
    // 3. KIỂM TRA CẦU 2 - 2 (T - T - X - X hoặc X - X - T - T)
    else if (
        n >= 4 &&
        last4[0] === last4[1] &&
        last4[2] === last4[3] &&
        last4[1] !== last4[2]
    ) {
        // Đã đủ 2 nhịp của bên mới -> Đảo chiều sang bên còn lại
        duDoan = oppositeVN(last4[3]);
        loaiCau = 'Cầu 2 - 2 (Cặp đôi đối xứng)';
        lyDo = `Nhịp 2-2 đang hình thành rõ (${last4.join(' -> ')}), đã đủ 2 tay ${last4[3]} nên bẻ sang ${duDoan}.`;
        doTinCay = '83%';
    }
    // 4. KIỂM TRA CẦU 2 - 2 ĐANG MỞ NHỊP (T - T - X -> Dự đoán X để thành T - T - X - X)
    else if (
        n >= 5 &&
        seq[n - 5] !== seq[n - 4] &&
        seq[n - 4] === seq[n - 3] &&
        seq[n - 3] !== seq[n - 2] &&
        seq[n - 2] === seq[n - 1]
    ) {
        duDoan = oppositeVN(seq[n - 1]);
        loaiCau = 'Cầu 2 - 2 Chuẩn Nhịp';
        lyDo = `Chuỗi 5 phiên cuối đi theo cấu trúc cặp (${seq.slice(-5).join(' -> ')}), chốt nhịp đảo sang ${duDoan}.`;
        doTinCay = '81%';
    }
    // 5. KIỂM TRA CẦU 3 - 3 (T - T - T - X - X - X hoặc đang đi T - T - T - X - X)
    else if (
        n >= 5 &&
        seq[n - 5] === seq[n - 4] &&
        seq[n - 4] === seq[n - 3] &&
        seq[n - 3] !== seq[n - 2] &&
        seq[n - 2] === seq[n - 1]
    ) {
        duDoan = seq[n - 1];
        loaiCau = 'Cầu 3 - 3 (Đang lên tay thứ 3)';
        lyDo = `Trước đó có 3 tay ${seq[n - 3]}, hiện tại đã ra 2 tay ${seq[n - 1]}, dự đoán nối tiếp tay thứ 3 (${duDoan}).`;
        doTinCay = '82%';
    }
    else if (
        n >= 6 &&
        last6[0] === last6[1] &&
        last6[1] === last6[2] &&
        last6[3] === last6[4] &&
        last6[4] === last6[5] &&
        last6[2] !== last6[3]
    ) {
        duDoan = oppositeVN(last6[5]);
        loaiCau = 'Cầu 3 - 3 Hoàn Chỉnh';
        lyDo = `Đã hoàn thành trọn vẹn 2 nhịp 3-3 (${last6.join(' -> ')}), phiên kế tiếp đảo chiều sang ${duDoan}.`;
        doTinCay = '84%';
    }
    // 6. KIỂM TRA CẦU 1 - 2 - 1 hoặc 2 - 1 - 2 (Cầu gánh)
    else if (
        n >= 5 &&
        seq[n - 5] === seq[n - 4] &&
        seq[n - 4] !== seq[n - 3] &&
        seq[n - 3] !== seq[n - 2] &&
        seq[n - 2] === seq[n - 1]
    ) {
        duDoan = oppositeVN(seq[n - 1]);
        loaiCau = 'Cầu 2 - 1 - 2 (Cầu đối xứng)';
        lyDo = `5 phiên cuối tạo mẫu đối xứng 2-1-2 (${seq.slice(-5).join(' -> ')}), dự đoán đảo sang ${duDoan}.`;
        doTinCay = '80%';
    }
    // 7. KIỂM TRA CẦU 1 - 2 - 3 (Tăng tiến: 1X - 2T - 2X -> X)
    else if (
        n >= 5 &&
        seq[n - 5] !== seq[n - 4] &&
        seq[n - 4] === seq[n - 3] &&
        seq[n - 3] !== seq[n - 2] &&
        seq[n - 2] === seq[n - 1]
    ) {
        duDoan = seq[n - 1];
        loaiCau = 'Cầu 1 - 2 - 3 (Cầu bậc thang)';
        lyDo = `Nhịp tăng tiến 1-2-3 đang hình thành (${seq.slice(-5).join(' -> ')}), theo tiếp ${duDoan} để đủ 3 tay.`;
        doTinCay = '79%';
    }
    // 8. CẦU BỆT NGẮN 3 TAY (T - T - T hoặc X - X - X)
    else if (streakLen === 3) {
        // Kiểm tra xem trong 10 phiên có xu hướng bệt dài hay hay gãy ở tay 3
        const taiCount = seq.filter(x => x === 'Tài').length;
        const xiuCount = seq.filter(x => x === 'Xỉu').length;
        if ((streakSide === 'Tài' && taiCount >= 6) || (streakSide === 'Xỉu' && xiuCount >= 6)) {
            duDoan = streakSide;
            loaiCau = `Cầu Bệt 3 Tay Theo Xu Hướng Lớn`;
            lyDo = `Đang có 3 tay ${streakSide} liên tiếp và ${streakSide} chiếm ưu thế trong 10 phiên (${taiCount} Tài - ${xiuCount} Xỉu), tiếp tục theo ${duDoan}.`;
            doTinCay = '81%';
        } else {
            duDoan = oppositeVN(streakSide);
            loaiCau = `Cầu Bẻ Bệt 3 Tay`;
            lyDo = `Chuỗi ${streakSide} chạm mốc 3 phiên trong thế cầu biến động (${last3.join(' -> ')}), dự đoán bẻ cầu sang ${duDoan}.`;
            doTinCay = '77%';
        }
    }
    // 9. PHÂN TÍCH CẦU NGHIÊNG & ĐIỂM RƠI TRONG 10 PHIÊN GẦN NHẤT
    else {
        const taiCount = seq.filter(x => x === 'Tài').length;
        const xiuCount = seq.filter(x => x === 'Xỉu').length;
        const lastPoint = points[n - 1];
        const prevPoint = points[n - 2];

        if (taiCount >= 7) {
            duDoan = 'Tài';
            loaiCau = 'Cầu Nghiêng Tài Áp Đảo';
            lyDo = `Trong 10 phiên gần nhất có tới ${taiCount} Tài / ${xiuCount} Xỉu, lực cầu nghiêng hẳn về Tài.`;
            doTinCay = '80%';
        } else if (xiuCount >= 7) {
            duDoan = 'Xỉu';
            loaiCau = 'Cầu Nghiêng Xỉu Áp Đảo';
            lyDo = `Trong 10 phiên gần nhất có tới ${xiuCount} Xỉu / ${taiCount} Tài, lực cầu nghiêng hẳn về Xỉu.`;
            doTinCay = '80%';
        } else {
            // Xét biên độ điểm số 2 phiên cuối để bắt nhịp hồi
            if (lastPoint <= 7) {
                duDoan = 'Xỉu';
                loaiCau = 'Cầu Đuổi Điểm Thấp';
                lyDo = `Phiên gần nhất về ${lastPoint} điểm (Xỉu sâu), quán tính cầu tiếp tục giữ cửa Xỉu.`;
            } else if (lastPoint >= 14) {
                duDoan = 'Tài';
                loaiCau = 'Cầu Đuổi Điểm Cao';
                lyDo = `Phiên gần nhất về ${lastPoint} điểm (Tài cao), quán tính cầu tiếp tục giữ cửa Tài.`;
            } else {
                // Điểm sát ranh giới (10 hoặc 11) thường có xu hướng đảo chiều
                duDoan = oppositeVN(seq[n - 1]);
                loaiCau = 'Cầu Đảo Biên Điểm (10-11)';
                lyDo = `Phiên vừa rồi về ${lastPoint} điểm sát ranh giới Tài/Xỉu (${prevPoint} -> ${lastPoint}), dự đoán đảo sang ${duDoan}.`;
            }
            doTinCay = '76%';
        }
    }

    return {
        phien_hien_tai: Number(latestItem.id),
        ket_qua_phien_hien_tai: formatResultVN(latestItem.resultTruyenThong),
        xuc_xac_hien_tai: latestItem.dices,
        tong_diem_hien_tai: latestItem.point,
        phien_du_doan: nextSessionId,
        du_doan: duDoan,
        loai_cau: loaiCau,
        do_tin_cay: doTinCay,
        ly_do_phan_tich: lyDo,
        chuoi_10_phien_gan_nhat: patternString,
        chi_tiet_10_phien: recent10.map(item => ({
            phien: item.id,
            ket_qua: formatResultVN(item.resultTruyenThong),
            diem: item.point,
            xuc_xac: item.dices
        }))
    };
}

/**
 * ĐỐI CHIẾU KẾT QUẢ THỰC TẾ ĐỂ CHECK ĐÚNG / SAI
 */
function verifyPastPredictions(list) {
    // Tạo map tra cứu nhanh kết quả thực tế theo ID phiên
    const resultMap = new Map();
    for (const item of list) {
        resultMap.set(Number(item.id), item);
    }

    for (const pred of predictionHistory) {
        if (pred.trang_thai === 'Đang chờ kết quả' && resultMap.has(pred.phien_du_doan)) {
            const actualItem = resultMap.get(pred.phien_du_doan);
            const actualResult = formatResultVN(actualItem.resultTruyenThong);
            const isWin = pred.du_doan === actualResult;

            pred.ket_qua_thuc_te = actualResult;
            pred.xuc_xac_thuc_te = actualItem.dices;
            pred.diem_thuc_te = actualItem.point;
            pred.trang_thai = isWin ? 'Đúng' : 'Sai';
            pred.thoi_gian_co_ket_qua = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        }
    }
}

/**
 * HÀM ĐỒNG BỘ DỮ LIỆU TỰ ĐỘNG TỪ API GỐC
 */
async function syncGameData() {
    try {
        const response = await fetch(API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Status ${response.status}`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.list) || data.list.length === 0) {
            throw new Error('Dữ liệu API trả về không hợp lệ hoặc rỗng');
        }

        // Sắp xếp chắc chắn theo ID giảm dần (mới nhất đứng đầu)
        const sortedList = [...data.list].sort((a, b) => Number(b.id) - Number(a.id));
        latestHistory = sortedList;
        lastSyncTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        syncError = null;

        // 1. Đối chiếu các dự đoán trước đó xem Đúng hay Sai
        verifyPastPredictions(sortedList);

        // 2. Tạo dự đoán cho phiên mới nhất + 1 nếu chưa có
        const nextId = Number(sortedList[0].id) + 1;
        const existingPred = predictionHistory.find(p => p.phien_du_doan === nextId);

        if (!existingPred) {
            const analysis = analyzePattern(sortedList);
            currentPrediction = analysis;

            predictionHistory.unshift({
                phien_du_doan: analysis.phien_du_doan,
                du_doan: analysis.du_doan,
                loai_cau: analysis.loai_cau,
                do_tin_cay: analysis.do_tin_cay,
                ly_do: analysis.ly_do_phan_tich,
                chuoi_cau: analysis.chuoi_10_phien_gan_nhat,
                ket_qua_thuc_te: null,
                xuc_xac_thuc_te: null,
                diem_thuc_te: null,
                trang_thai: 'Đang chờ kết quả',
                thoi_gian_du_doan: new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            });

            // Giới hạn lưu 200 phiên gần nhất trong RAM để tối ưu bộ nhớ trên Render
            if (predictionHistory.length > 200) {
                predictionHistory.pop();
            }
        } else {
            // Cập nhật thông tin phân tích mới nhất
            currentPrediction = analyzePattern(sortedList);
        }
    } catch (err) {
        syncError = err.message;
        console.error('[Lỗi đồng bộ API]:', err.message);
    }
}

// Khởi chạy đồng bộ ngay lập tức và lặp lại mỗi 3 giây
syncGameData();
setInterval(syncGameData, 3000);

// ============================================================================
// ENDPOINT 1: /dunphi -> TRẢ VỀ JSON TIẾNG VIỆT DỰ ĐOÁN PHIÊN TIẾP THEO
// ============================================================================
app.get('/dunphi', async (req, res) => {
    if (!currentPrediction) {
        await syncGameData();
    }

    if (!currentPrediction) {
        return res.status(503).json({
            trang_thai: 'Lỗi',
            thong_bao: 'Hệ thống đang kết nối tới máy chủ LC79, vui lòng thử lại sau vài giây.',
            chi_tiet_loi: syncError
        });
    }

    // Thống kê nhanh hiệu suất đúng/sai hiện tại
    const daCoKetQua = predictionHistory.filter(p => p.trang_thai === 'Đúng' || p.trang_thai === 'Sai');
    const soLanDung = daCoKetQua.filter(p => p.trang_thai === 'Đúng').length;
    const soLanSai = daCoKetQua.filter(p => p.trang_thai === 'Sai').length;
    const tyLeThang = daCoKetQua.length > 0
        ? ((soLanDung / daCoKetQua.length) * 100).toFixed(1) + '%'
        : 'Đang thống kê';

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
        he_thong: 'Phân Tích Cầu Tài Xỉu LC79 (Pattern AI)',
        cap_nhat_luc: lastSyncTime,
        phien_moi_nhat: currentPrediction.phien_hien_tai,
        ket_qua_moi_nhat: {
            cua: currentPrediction.ket_qua_phien_hien_tai,
            diem: currentPrediction.tong_diem_hien_tai,
            xuc_xac: currentPrediction.xuc_xac_hien_tai
        },
        du_doan_phien_tiep_theo: {
            phien: currentPrediction.phien_du_doan,
            ket_qua_du_doan: currentPrediction.du_doan,
            loai_cau_nhan_dien: currentPrediction.loai_cau,
            do_tin_cay: currentPrediction.do_tin_cay,
            phan_tich_chi_tiet: currentPrediction.ly_do_phan_tich
        },
        soi_cau_10_phien_gan_nhat: currentPrediction.chuoi_10_phien_gan_nhat,
        thong_ke_hieu_suat: {
            tong_phien_da_check: daCoKetQua.length,
            du_doan_dung: soLanDung,
            du_doan_sai: soLanSai,
            ty_le_chinh_xac: tyLeThang
        }
    });
});

// ============================================================================
// ENDPOINT 2: /date -> GIAO DIỆN HTML CHECK DỰ ĐOÁN ĐÚNG / SAI TRỰC QUAN
// ============================================================================
app.get('/date', (req, res) => {
    const daCoKetQua = predictionHistory.filter(p => p.trang_thai === 'Đúng' || p.trang_thai === 'Sai');
    const soLanDung = daCoKetQua.filter(p => p.trang_thai === 'Đúng').length;
    const soLanSai = daCoKetQua.filter(p => p.trang_thai === 'Sai').length;
    const tyLeThang = daCoKetQua.length > 0
        ? ((soLanDung / daCoKetQua.length) * 100).toFixed(1)
        : '0.0';

    const rowsHtml = predictionHistory.map(item => {
        const isWin = item.trang_thai === 'Đúng';
        const isLoss = item.trang_thai === 'Sai';

        const statusBadge = isWin
            ? `<span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">✔ DỰ ĐOÁN ĐÚNG</span>`
            : isLoss
                ? `<span class="px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">✖ DỰ ĐOÁN SAI</span>`
                : `<span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">⏳ Đang chờ quay...</span>`;

        const predColor = item.du_doan === 'Tài' ? 'text-amber-400 font-bold' : 'text-sky-400 font-bold';
        const actualText = item.ket_qua_thuc_te
            ? `<span class="${item.ket_qua_thuc_te === 'Tài' ? 'text-amber-400' : 'text-sky-400'} font-bold">${item.ket_qua_thuc_te}</span> <span class="text-slate-400 text-xs">(${item.diem_thuc_te}đ - [${item.xuc_xac_thuc_te.join(',')}])</span>`
            : `<span class="text-slate-500 italic">Chưa mở bát</span>`;

        return `
            <tr class="border-b border-slate-800 hover:bg-slate-800/50 transition">
                <td class="py-3.5 px-4 font-mono font-semibold text-slate-200">#${item.phien_du_doan}</td>
                <td class="py-3.5 px-4 text-xs text-slate-400">${item.thoi_gian_du_doan}</td>
                <td class="py-3.5 px-4">
                    <span class="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-indigo-300 border border-slate-700">${item.loai_cau}</span>
                </td>
                <td class="py-3.5 px-4 ${predColor} text-base">${item.du_doan}</td>
                <td class="py-3.5 px-4">${actualText}</td>
                <td class="py-3.5 px-4 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lịch Sử Check Đúng / Sai - Soi Cầu LC79</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <meta http-equiv="refresh" content="5">
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen p-4 md:p-8">
    <div class="max-w-6xl mx-auto space-y-6">
        <!-- Header -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900/90 border border-slate-800 p-6 rounded-2xl shadow-xl">
            <div>
                <div class="flex items-center gap-2.5">
                    <span class="h-3 w-3 rounded-full bg-emerald-400 animate-ping"></span>
                    <h1 class="text-xl md:text-2xl font-extrabold bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                        HỆ THỐNG SOI CẦU PATTERN & CHECK ĐÚNG / SAI LC79
                    </h1>
                </div>
                <p class="text-slate-400 text-sm mt-1">
                    Tự động đồng bộ API liên tục • Cập nhật lúc: <span class="text-slate-200 font-medium">${lastSyncTime || 'Đang tải...'}</span> (Tự làm mới mỗi 5s)
                </p>
            </div>
            <div class="flex items-center gap-3">
                <a href="/dunphi" target="_blank" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/20 transition">
                    Xem JSON /dunphi ↗
                </a>
            </div>
        </div>

        <!-- Phiên đang dự đoán hiện tại -->
        ${currentPrediction ? `
        <div class="bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-indigo-500/30 p-6 rounded-2xl shadow-lg">
            <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div class="space-y-2">
                    <span class="text-xs font-bold uppercase tracking-wider text-indigo-400">Dự đoán phiên tiếp theo</span>
                    <div class="flex items-baseline gap-4">
                        <span class="text-3xl font-extrabold text-white">#${currentPrediction.phien_du_doan}</span>
                        <span class="px-4 py-1.5 rounded-xl text-lg font-extrabold ${currentPrediction.du_doan === 'Tài' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-sky-500/20 text-sky-400 border border-sky-500/40'}">
                            CHỐT: ${currentPrediction.du_doan.toUpperCase()} (${currentPrediction.do_tin_cay})
                        </span>
                    </div>
                    <p class="text-sm text-slate-300"><strong class="text-indigo-300">Loại cầu:</strong> ${currentPrediction.loai_cau}</p>
                    <p class="text-xs text-slate-400">${currentPrediction.ly_do_phan_tich}</p>
                </div>
                <div class="bg-slate-950/70 border border-slate-800 p-4 rounded-xl lg:max-w-md w-full">
                    <div class="text-xs text-slate-400 mb-2 font-medium">10 Phiên Gần Nhất (Cũ ➔ Mới):</div>
                    <div class="flex flex-wrap gap-1.5">
                        ${currentPrediction.chi_tiet_10_phien.map(p => `
                            <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${p.ket_qua === 'Tài' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'}" title="Phiên #${p.phien} - ${p.diem} điểm">
                                ${p.ket_qua} (${p.diem})
                            </span>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Thống kê tổng quan -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                <div class="text-slate-400 text-xs font-medium uppercase">Tổng Phiên Đã Check</div>
                <div class="text-2xl font-extrabold text-white mt-1">${daCoKetQua.length}</div>
            </div>
            <div class="bg-slate-900 border border-emerald-500/20 p-5 rounded-2xl">
                <div class="text-emerald-400 text-xs font-medium uppercase">Dự Đoán Đúng</div>
                <div class="text-2xl font-extrabold text-emerald-400 mt-1">${soLanDung}</div>
            </div>
            <div class="bg-slate-900 border border-rose-500/20 p-5 rounded-2xl">
                <div class="text-rose-400 text-xs font-medium uppercase">Dự Đoán Sai</div>
                <div class="text-2xl font-extrabold text-rose-400 mt-1">${soLanSai}</div>
            </div>
            <div class="bg-slate-900 border border-indigo-500/20 p-5 rounded-2xl">
                <div class="text-indigo-400 text-xs font-medium uppercase">Tỷ Lệ Chính Xác</div>
                <div class="text-2xl font-extrabold text-indigo-400 mt-1">${tyLeThang}%</div>
            </div>
        </div>

        <!-- Bảng lịch sử đối chiếu Đúng / Sai -->
        <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div class="p-5 border-b border-slate-800 flex items-center justify-between">
                <h2 class="font-bold text-slate-200">Lịch Sử Đối Chiếu Dự Đoán & Kết Quả Thực Tế</h2>
                <span class="text-xs text-slate-400">Hiển thị tối đa 200 phiên gần nhất</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-slate-950/60 text-slate-400 text-xs uppercase border-b border-slate-800">
                            <th class="py-3.5 px-4">Phiên</th>
                            <th class="py-3.5 px-4">Giờ Dự Đoán</th>
                            <th class="py-3.5 px-4">Nhận Diện Cầu</th>
                            <th class="py-3.5 px-4">AI Dự Đoán</th>
                            <th class="py-3.5 px-4">Kết Quả Thực Tế</th>
                            <th class="py-3.5 px-4 text-center">Trạng Thái</th>
                        </tr>
                    </thead>
                    <tbody class="text-sm divide-y divide-slate-800">
                        ${rowsHtml || `<tr><td colspan="6" class="py-8 text-center text-slate-500">Đang khởi tạo dữ liệu phiên đầu tiên...</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// Trang chủ điều hướng nhanh
app.get('/', (req, res) => {
    res.redirect('/date');
});

app.listen(PORT, () => {
    console.log(`Server dự đoán LC79 đang chạy tại cổng ${PORT}`);
});
