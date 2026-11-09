/* ================================================================
   ██╗   ██╗██╗██████╗     ████████╗██╗  ██╗███╗   ███╗██████╗ ███████╗
   ██║   ██║██║██╔══██╗    ╚══██╔══╝╚██╗██╔╝████╗ ████║██╔══██╗██╔════╝
   ██║   ██║██║██████╔╝       ██║    ╚███╔╝ ██╔████╔██║██║  ██║███████╗
   ╚██╗ ██╔╝██║██╔═══╝        ██║    ██╔██╗ ██║╚██╔╝██║██║  ██║╚════██║
    ╚████╔╝ ██║██║            ██║   ██╔╝ ██╗██║ ╚═╝ ██║██████╔╝███████║
     ╚═══╝  ╚═╝╚═╝            ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝
   LC79 · TREO RENDER · BỆT/KÉP/THEO/BẺ · FULL VERSION
   ================================================================ */
(function () {
  'use strict';

  /* ============================================================
     [1] CONFIG
     ============================================================ */
  const CFG = {
    API: 'https://wtxmd52.macminim6.online/v1/txmd5/sessions',
    REFRESH_MS: 5000,
    MAX_LOG: 80,
    STORAGE_KEY: '__vip_txmd5_state__',
    SOUND_ON: true,
    DEBUG: false
  };

  /* ============================================================
     [2] STATE
     ============================================================ */
  const S = {
    pred: null,
    log: [],
    fetches: 0,
    errors: 0,
    timerFetch: null,
    timerCd: null,
    cd: CFG.REFRESH_MS / 1000,
    lastList: [],
    streakStats: { maxXiu: 0, maxTai: 0, currentXiu: 0, currentTai: 0 },
    startTime: Date.now()
  };

  /* ============================================================
     [3] UTILS
     ============================================================ */
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();
  const fmtTime = () => new Date().toLocaleTimeString('vi-VN');

  function log(...args) {
    if (CFG.DEBUG) console.log('%c[TXMD5]', 'color:#4ecdc4', ...args);
  }

  function saveState() {
    try {
      localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify({
        log: S.log.slice(0, 40),
        streakStats: S.streakStats
      }));
    } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(CFG.STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.log && Array.isArray(d.log)) S.log = d.log;
      if (d.streakStats) S.streakStats = d.streakStats;
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     [4] SOUND
     ============================================================ */
  function beep(freq = 880, dur = 120) {
    if (!CFG.SOUND_ON) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000);
      osc.start();
      osc.stop(ctx.currentTime + dur / 1000);
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     [5] PATTERN ENGINE - PHÂN TÍCH CẦU CHUYÊN SÂU
     ============================================================ */
  const Pattern = {
    getSeq(list) {
      return list.map(x => x.resultTruyenThong);
    },

    getStreak(seq) {
      let streak = 1;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] === seq[0]) streak++;
        else break;
      }
      return streak;
    },

    countChanges(seq, n = 10) {
      const s = seq.slice(0, n);
      let c = 0;
      for (let i = 1; i < s.length; i++) {
        if (s[i] !== s[i - 1]) c++;
      }
      return c;
    },

    isKep(seq) {
      if (seq.length < 6) return false;
      return seq[0] === seq[1] && seq[2] === seq[3] &&
             seq[4] === seq[5] && seq[0] !== seq[2] && seq[2] !== seq[4];
    },

    isKep3(seq) {
      if (seq.length < 9) return false;
      return seq[0] === seq[1] && seq[1] === seq[2] &&
             seq[3] === seq[4] && seq[4] === seq[5] &&
             seq[6] === seq[7] && seq[7] === seq[8];
    },

    isTheo(seq, n = 10) {
      return this.countChanges(seq, n) >= 7;
    },

    isBet(seq) {
      return this.getStreak(seq) >= 3;
    },

    isDao(seq) {
      if (seq.length < 4) return false;
      for (let i = 1; i < 4; i++) {
        if (seq[i] === seq[i - 1]) return false;
      }
      return true;
    },

    isCau1_1(seq) {
      if (seq.length < 6) return false;
      for (let i = 1; i < 6; i++) {
        if (seq[i] === seq[i - 1]) return false;
      }
      return true;
    },

    isCau2_1(seq) {
      if (seq.length < 6) return false;
      const a = seq[0], b = seq[1];
      if (a === b) return false;
      return seq[2] === a && seq[3] === b && seq[4] === a && seq[5] === b;
    },

    isCau3_1(seq) {
      if (seq.length < 8) return false;
      const a = seq[0], b = seq[1];
      if (a === b) return false;
      return seq[2] === a && seq[3] === b && seq[4] === a && seq[5] === b && seq[6] === a && seq[7] === b;
    },

    analyze(list) {
      const seq = this.getSeq(list);
      const streak = this.getStreak(seq);
      const changes10 = this.countChanges(seq, 10);
      const changes5 = this.countChanges(seq, 5);

      const isKep = this.isKep(seq);
      const isKep3 = this.isKep3(seq);
      const isTheo = this.isTheo(seq);
      const isBet = this.isBet(seq);
      const isDao = this.isDao(seq);
      const isCau1_1 = this.isCau1_1(seq);
      const isCau2_1 = this.isCau2_1(seq);
      const isCau3_1 = this.isCau3_1(seq);

      let pred, method, conf, tags = [];

      if (isBet && streak >= 5) {
        pred = seq[0] === 'TAI' ? 'XIU' : 'TAI';
        method = `Bệt ${streak} → BẺ`;
        conf = 62;
        tags = ['bet', 'bẻ'];
      } else if (isBet) {
        pred = seq[0];
        method = `Cầu Bệt ${streak}`;
        conf = streak === 4 ? 55 : 68;
        tags = ['bet'];
      } else if (isKep3) {
        pred = seq[0];
        method = 'Cầu Kép 3-3';
        conf = 72;
        tags = ['kep3'];
      } else if (isKep) {
        pred = seq[0];
        method = 'Cầu Kép 2-2';
        conf = 68;
        tags = ['kep'];
      } else if (isCau3_1) {
        pred = seq[0];
        method = 'Cầu 3-1';
        conf = 70;
        tags = ['cau31'];
      } else if (isCau2_1) {
        pred = seq[0];
        method = 'Cầu 2-1';
        conf = 66;
        tags = ['cau21'];
      } else if (isCau1_1) {
        pred = seq[0] === 'TAI' ? 'XIU' : 'TAI';
        method = 'Cầu 1-1 → BẺ';
        conf = 64;
        tags = ['cau11'];
      } else if (isTheo) {
        pred = seq[0] === 'TAI' ? 'XIU' : 'TAI';
        method = 'Cầu Theo → BẺ';
        conf = 63;
        tags = ['theo'];
      } else if (isDao) {
        pred = seq[0] === 'TAI' ? 'XIU' : 'TAI';
        method = 'Cầu Đảo 3';
        conf = 60;
        tags = ['dao'];
      } else {
        pred = seq[0] === 'TAI' ? 'XIU' : 'TAI';
        method = streak >= 2 ? `Bẻ sau ${streak}` : 'Bẻ cầu ngắn';
        conf = streak >= 2 ? 58 : 55;
        tags = ['be'];
      }

      return {
        pred, method, conf, tags,
        streak, changes10, changes5,
        isKep, isKep3, isTheo, isBet, isDao,
        isCau1_1, isCau2_1, isCau3_1,
        seq10: seq.slice(0, 10)
      };
    }
  };

  /* ============================================================
     [6] CHECK ĐÚNG SAI
     ============================================================ */
  function checkPredictions(list) {
    const map = {};
    list.forEach(x => map[x.id] = x.resultTruyenThong);

    S.log.forEach(p => {
      if (map[p.forId] !== undefined) {
        p.actual = map[p.forId];
        p.correct = (p.value === p.actual);
      }
    });

    const done = S.log.filter(p => p.actual).slice(0, 10);
    let w = 0, t = 0;
    done.forEach(p => { t++; if (p.correct) w++; });

    const done20 = S.log.filter(p => p.actual).slice(0, 20);
    let w20 = 0, t20 = 0;
    done20.forEach(p => { t20++; if (p.correct) w20++; });

    const totalWin = S.log.filter(p => p.actual && p.correct).length;
    const totalDone = S.log.filter(p => p.actual).length;

    return {
      win10: t ? Math.round(w / t * 100) : 0,
      win20: t20 ? Math.round(w20 / t20 * 100) : 0,
      totalWin,
      totalDone,
      winAll: totalDone ? Math.round(totalWin / totalDone * 100) : 0,
      count10: { w, t }
    };
  }

  /* ============================================================
     [7] STREAK STATS
     ============================================================ */
  function updateStreakStats(list) {
    const seq = list.map(x => x.resultTruyenThong);
    let maxX = 0, maxT = 0, curX = 0, curT = 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] === 'XIU') { curX++; curT = 0; }
      else { curT++; curX = 0; }
      if (curX > maxX) maxX = curX;
      if (curT > maxT) maxT = curT;
    }
    S.streakStats = {
      maxXiu: Math.max(S.streakStats.maxXiu, maxX),
      maxTai: Math.max(S.streakStats.maxTai, maxT),
      currentXiu: curX,
      currentTai: curT
    };
  }

  /* ============================================================
     [8] UI BUILD
     ============================================================ */
  function initUI() {
    const old = $('__vip_txmd5__');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = '__vip_txmd5__';
    div.innerHTML = `
      <style>
        #__vip_txmd5__{
          position:fixed;top:10px;right:10px;z-index:2147483647;
          width:360px;max-height:94vh;overflow-y:auto;
          font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
          background:linear-gradient(160deg,#0f0c29,#302b63,#24243e);
          color:#fff;border-radius:16px;padding:14px;
          box-shadow:0 10px 50px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.08);
          font-size:12px;backdrop-filter:blur(10px);
        }
        #__vip_txmd5__::-webkit-scrollbar{width:5px}
        #__vip_txmd5__::-webkit-scrollbar-thumb{background:#ffd70055;border-radius:5px}
        #__vip_txmd5__ .vh{text-align:center;margin-bottom:12px;position:relative}
        #__vip_txmd5__ .vh h1{
          font-size:16px;letter-spacing:1.5px;font-weight:800;
          background:linear-gradient(90deg,#ffd700,#ff6b6b,#4ecdc4);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;
          background-clip:text;
        }
        #__vip_txmd5__ .vh .s{font-size:9px;color:#777;margin-top:2px}
        #__vip_txmd5__ .close{
          position:absolute;top:-2px;right:0;cursor:pointer;
          font-size:16px;color:#888;line-height:1;
        }
        #__vip_txmd5__ .close:hover{color:#ff6b6b}
        #__vip_txmd5__ .pred{
          text-align:center;padding:16px 8px;border-radius:14px;
          margin-bottom:12px;transition:.3s;position:relative;overflow:hidden;
        }
        #__vip_txmd5__ .pred.TAI{
          background:linear-gradient(135deg,#ff416c,#ff4b2b);
          box-shadow:0 0 30px rgba(255,65,108,.6);
        }
        #__vip_txmd5__ .pred.XIU{
          background:linear-gradient(135deg,#11998e,#38ef7d);
          box-shadow:0 0 30px rgba(56,239,125,.6);
        }
        #__vip_txmd5__ .pred.WAIT{background:linear-gradient(135deg,#444,#222)}
        #__vip_txmd5__ .pred .l{font-size:10px;opacity:.9;letter-spacing:2.5px}
        #__vip_txmd5__ .pred .v{
          font-size:38px;font-weight:900;letter-spacing:4px;margin:4px 0;
          text-shadow:0 3px 14px rgba(0,0,0,.5);
        }
        #__vip_txmd5__ .pred .m{font-size:10px;opacity:.92}
        #__vip_txmd5__ .tags{
          display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-top:8px;
        }
        #__vip_txmd5__ .tag{
          font-size:8px;padding:2px 7px;border-radius:10px;
          background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.15);
          transition:.2s;
        }
        #__vip_txmd5__ .tag.on{
          background:#ffd700;color:#000;font-weight:800;border-color:#ffd700;
          box-shadow:0 0 10px #ffd70088;
        }
        #__vip_txmd5__ .stats{
          display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;
        }
        #__vip_txmd5__ .st{
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
          border-radius:8px;padding:6px 2px;text-align:center;
        }
        #__vip_txmd5__ .st .n{font-size:14px;font-weight:800}
        #__vip_txmd5__ .st .lb{font-size:7px;color:#999;text-transform:uppercase;letter-spacing:.5px}
        #__vip_txmd5__ .st.g .n{color:#38ef7d}
        #__vip_txmd5__ .st.r .n{color:#ff6b6b}
        #__vip_txmd5__ .st.y .n{color:#ffd700}
        #__vip_txmd5__ .st.b .n{color:#4ecdc4}
        #__vip_txmd5__ .ht{
          display:flex;justify-content:space-between;font-size:10px;
          color:#aaa;margin-bottom:6px;font-weight:600;
        }
        #__vip_txmd5__ .hl{
          display:flex;flex-direction:column;gap:3px;
          max-height:250px;overflow-y:auto;padding-right:3px;
        }
        #__vip_txmd5__ .hl::-webkit-scrollbar{width:4px}
        #__vip_txmd5__ .hl::-webkit-scrollbar-thumb{background:#ffd70055;border-radius:4px}
        #__vip_txmd5__ .hi{
          display:flex;align-items:center;justify-content:space-between;
          padding:6px 8px;border-radius:7px;font-size:10px;
          background:rgba(255,255,255,.04);border-left:3px solid transparent;
          transition:.2s;
        }
        #__vip_txmd5__ .hi:hover{background:rgba(255,255,255,.09)}
        #__vip_txmd5__ .hi.TAI{border-left-color:#ff416c}
        #__vip_txmd5__ .hi.XIU{border-left-color:#38ef7d}
        #__vip_txmd5__ .hi .id{color:#666;font-size:8px;min-width:48px}
        #__vip_txmd5__ .hi .v{font-weight:800;min-width:32px}
        #__vip_txmd5__ .hi.TAI .v{color:#ff6b6b}
        #__vip_txmd5__ .hi.XIU .v{color:#38ef7d}
        #__vip_txmd5__ .hi .m{
          font-size:8px;color:#888;flex:1;text-align:center;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;
        }
        #__vip_txmd5__ .hi .p{font-size:8px;color:#ffd700;min-width:26px;text-align:right}
        #__vip_txmd5__ .ck{font-size:12px;min-width:16px;text-align:right;font-weight:700}
        #__vip_txmd5__ .ck.ok{color:#38ef7d}
        #__vip_txmd5__ .ck.bad{color:#ff6b6b}
        #__vip_txmd5__ .ck.wait{color:#777}
        #__vip_txmd5__ .bar{
          text-align:center;font-size:8px;color:#666;margin-top:10px;
          padding-top:8px;border-top:1px solid rgba(255,255,255,.08);
        }
        #__vip_txmd5__ .dot{
          display:inline-block;width:5px;height:5px;border-radius:50%;
          background:#38ef7d;margin-right:3px;animation:__pl 1.4s infinite;
        }
        @keyframes __pl{0%,100%{opacity:1}50%{opacity:.25}}
        #__vip_txmd5__ .mini-stats{
          display:flex;justify-content:space-around;margin-bottom:10px;
          font-size:9px;color:#888;
        }
        #__vip_txmd5__ .mini-stats span b{color:#ffd700}
      </style>
      <div class="vh">
        <span class="close" id="__close">✕</span>
        <h1>⚡ VIP TXMD5 LC79 ⚡</h1>
        <div class="s">Treo Render · Bệt/Kép/Theo/Bẻ · Full</div>
      </div>

      <div id="__pred" class="pred WAIT">
        <div class="l">DỰ ĐOÁN</div>
        <div class="v" id="__pv">...</div>
        <div class="m" id="__pm">Đang kết nối...</div>
        <div class="tags" id="__pt"></div>
      </div>

      <div class="stats">
        <div class="st y"><div class="n" id="__sT">0</div><div class="lb">Tổng</div></div>
        <div class="st g"><div class="n" id="__sX">0</div><div class="lb">Xỉu</div></div>
        <div class="st r"><div class="n" id="__sA">0</div><div class="lb">Tài</div></div>
        <div class="st b"><div class="n" id="__sW">0%</div><div class="lb">Win10</div></div>
      </div>

      <div class="mini-stats">
        <span>Win20: <b id="__w20">0%</b></span>
        <span>All: <b id="__wAll">0%</b></span>
        <span>Max X: <b id="__mX">0</b></span>
        <span>Max T: <b id="__mT">0</b></span>
      </div>

      <div class="ht">
        <span>📜 Check đúng/sai</span>
        <span id="__ut">--</span>
      </div>
      <div class="hl" id="__hl"></div>

      <div class="bar">
        <span class="dot"></span> Auto 5s · <span id="__cd">5</span>s
        · <span id="__fc">0</span> fetch
        · <span id="__er">0</span> err
      </div>
    `;
    document.body.appendChild(div);

    $('__close').onclick = () => {
      div.remove();
      if (S.timerFetch) clearInterval(S.timerFetch);
      if (S.timerCd) clearInterval(S.timerCd);
    };
  }

  /* ============================================================
     [9] RENDER
     ============================================================ */
  function render(data) {
    if (!data || !data.list || !data.list.length) return;

    const list = data.list;
    S.lastList = list;

    const latest = list[0];
    const nextId = latest.id + 1;
    const pat = Pattern.analyze(list);

    if (!S.pred || S.pred.forId !== nextId) {
      S.pred = {
        forId: nextId,
        value: pat.pred,
        method: pat.method,
        confidence: pat.conf,
        tags: pat.tags,
        ts: now()
      };
      S.log.unshift({ ...S.pred });
      if (S.log.length > CFG.MAX_LOG) S.log.pop();
      saveState();
      beep(880, 100);
    }

    updateStreakStats(list);
    const ck = checkPredictions(list);

    const box = $('__pred');
    if (box) {
      box.className = 'pred ' + S.pred.value;
      $('__pv').textContent = S.pred.value;
      $('__pm').textContent = `#${nextId} · ${S.pred.method} · ${S.pred.confidence}%`;

      const tagDefs = [
        { k: 'bet', l: `Bệt ${pat.streak}`, on: pat.isBet },
        { k: 'kep', l: 'Kép 2-2', on: pat.isKep },
        { k: 'kep3', l: 'Kép 3-3', on: pat.isKep3 },
        { k: 'theo', l: 'Theo', on: pat.isTheo },
        { k: 'cau11', l: '1-1', on: pat.isCau1_1 },
        { k: 'cau21', l: '2-1', on: pat.isCau2_1 },
        { k: 'dao', l: 'Đảo', on: pat.isDao },
        { k: 'be', l: `Bẻ ${pat.changes10}/10`, on: pat.changes10 >= 5 }
      ];
      $('__pt').innerHTML = tagDefs
        .map(t => `<span class="tag ${t.on ? 'on' : ''}">${t.l}</span>`)
        .join('');
    }

    const ts = data.typeStat || { XIU: 0, TAI: 0 };
    $('__sT').textContent = list.length;
    $('__sX').textContent = ts.XIU;
    $('__sA').textContent = ts.TAI;
    $('__sW').textContent = ck.win10 + '%';
    $('__w20').textContent = ck.win20 + '%';
    $('__wAll').textContent = ck.winAll + '%';
    $('__mX').textContent = S.streakStats.maxXiu;
    $('__mT').textContent = S.streakStats.maxTai;

    $('__hl').innerHTML = S.log.slice(0, 30).map(p => {
      let ckHtml = '<span class="ck wait">⏳</span>';
      if (p.actual) ckHtml = p.correct
        ? '<span class="ck ok">✔</span>'
        : '<span class="ck bad">✘</span>';
      return `<div class="hi ${p.value}">
        <span class="id">#${p.forId}</span>
        <span class="v">${p.value}</span>
        <span class="m">${p.method}</span>
        <span class="p">${p.confidence}%</span>
        ${ckHtml}
      </div>`;
    }).join('');

    $('__ut').textContent = fmtTime();
    $('__fc').textContent = S.fetches;
    $('__er').textContent = S.errors;

    // thông báo khi có kết quả mới (check)
    if (ck.totalDone > (S._lastDone || 0)) {
      S._lastDone = ck.totalDone;
      const lastChecked = S.log.find(p => p.actual);
      if (lastChecked) {
        beep(lastChecked.correct ? 1200 : 300, lastChecked.correct ? 100 : 200);
      }
    }

    log('Rendered', { nextId, pred: S.pred.value, win10: ck.win10 });
  }

  /* ============================================================
     [10] FETCH
     ============================================================ */
  async function fetchData() {
    try {
      const r = await fetch(CFG.API + '?t=' + now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (!d.list || !d.list.length) throw new Error('Empty list');
      S.fetches++;
      render(d);
    } catch (e) {
      S.errors++;
      const pm = $('__pm');
      if (pm) pm.textContent = 'Lỗi: ' + e.message + ' (retry...)';
      log('Fetch error', e.message);
    }
  }

  /* ============================================================
     [11] START
     ============================================================ */
  function start() {
    loadState();
    initUI();
    fetchData();
    if (S.timerFetch) clearInterval(S.timerFetch);
    if (S.timerCd) clearInterval(S.timerCd);
    S.cd = CFG.REFRESH_MS / 1000;
    S.timerCd = setInterval(() => {
      S.cd--;
      const el = $('__cd');
      if (el) el.textContent = S.cd;
      if (S.cd <= 0) { S.cd = CFG.REFRESH_MS / 1000; fetchData(); }
    }, 1000);
  }

  start();
  console.log(
    '%c✅ VIP TXMD5 LC79 đã treo render!',
    'color:#38ef7d;font-weight:bold;font-size:14px;text-shadow:0 0 8px #38ef7d'
  );
  console.log(
    '%c→ Panel góc phải trên · auto 5s · bấm ✕ để tắt',
    'color:#4ecdc4;font-size:11px'
  );
})();
