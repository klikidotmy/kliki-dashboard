// KLIKI Marketing Dashboard — UI (paparan sahaja; semua kiraan dalam data.js)
(function () {
  const CFG = window.KLIKI_CONFIG, KD = window.KD, T = CFG.targets;
  const $ = s => document.querySelector(s);
  const MON = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const CACHE_KEY = 'kliki-dash-v1';
  const TABS = ['overview', 'funnel', 'ringkasan', 'content', 'outlet', 'trend'];
  const TITLES = { overview: 'Overview', funnel: 'Aliran Pelanggan', ringkasan: 'Ringkasan KPI', content: 'Prestasi Content', outlet: 'Prestasi Outlet', trend: 'Trend Bulanan' };

  const savedTab = localGet('tab');
  const state = { ds: null, month: null, picked: false, tab: TABS.includes(savedTab) ? savedTab : 'overview', loading: false };

  // ---------- helpers ----------
  function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* penuh / disekat */ } }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Format nombor seragam: penuh dengan koma; juta ditulis "3.82M"
  function fmt(n) {
    if (n == null || Number.isNaN(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    return Math.round(n).toLocaleString('en-MY');
  }
  const fmtPct = (n, d = 1) => n == null ? '—' : n.toFixed(d) + '%';
  const fmtVal = (n, unit) => unit === '%' ? fmtPct(n) : fmt(n);
  const daysIn = (y, m) => KD.daysIn(y, m);
  const monLabel = key => { const [y, m] = key.split('-'); return `${MON[+m - 1]} ${y}`; };
  const monShort = (y, m) => `${MON[m - 1]} '${String(y).slice(2)}`;
  const parseKey = key => key.split('-').map(Number);
  function isCurrent(key) { const n = new Date(); return key === KD.ym(n.getFullYear(), n.getMonth() + 1); }

  const ICON = { good: '✓', warn: '!', up: '↗', bad: '✕', na: '–' };
  const iconOf = st => st.reason === 'up' ? ICON.up : ICON[st.level];
  function statusWord(st, live) {
    if (st.level === 'good') return live ? 'On track' : 'Capai';
    if (st.level === 'warn') return st.reason === 'up' ? 'Naik' : (live ? 'Perlahan' : 'Hampir');
    if (st.level === 'bad') return live ? 'Ketinggalan' : 'Belum';
    return 'Tiada data';
  }
  function bar(actual, target, st, pace) {
    const w = target && actual != null ? Math.max(0, Math.min(100, 100 * actual / target)) : 0;
    const pm = pace < 1 ? `<span class="pace" style="left:${(pace * 100).toFixed(1)}%"></span>` : '';
    return `<div class="prog ${st.level}" role="progressbar" aria-valuenow="${Math.round(w)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${w}%"></i>${pm}</div>`;
  }
  function delta(v, label) {
    if (v == null || !Number.isFinite(v)) return '';
    const a = Math.abs(v) >= 999 ? '>999' : Math.abs(v).toFixed(0);
    return `<span class="d">${v >= 0 ? '▲' : '▼'} ${a}% <span class="dl">${label}</span></span>`;
  }

  // Beza vs tempoh lain. Untuk metrik yang boleh negatif (net followers), peratus tak bermakna: guna beza mutlak.
  function cmp(k, base, label) {
    if (k.nowN == null || base == null) return '';
    if (k.floor || base < 0 || k.nowN < 0) {
      const d = k.nowN - base;
      return `<span class="d">${d >= 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(d))} <span class="dl">${label}</span></span>`;
    }
    return delta(KD.change(k.nowN, base), label);
  }

  // Kad KPI: lebar penuh, satu isyarat status (ikon + warna bar), nilai/target, satu baris perbandingan
  function kpiCard(k, opts = {}) {
    const st = k.status, live = k.partial;
    const [y, m] = parseKey(state.month);
    const prevLbl = monShort(...KD.prevYM(y, m)), lyLbl = monShort(y - 1, m);
    const pctTxt = k.floor ? `had ${fmt(k.target)}` : (st.pct != null ? `${Math.round(st.pct)}%` : '');
    const tgt = k.actual == null ? '' : k.floor ? '' : `<span class="tg">/ ${fmtVal(k.target, k.unit)}</span>`;
    const proj = live && !k.unit && !k.floor && k.actual != null ? `<span class="d"><span class="dl">unjuran</span> ${fmt(k.actual / k.pace)}</span>` : '';
    return `<div class="kpi ${opts.hero ? 'card hero' : 'krow'}">
      <div class="k-top"><span class="label">${esc(k.label)}</span>
        <span class="st ${st.level}">${iconOf(st)} ${statusWord(st, live)}${pctTxt ? ` <span class="pct">${pctTxt}</span>` : ''}</span></div>
      <div class="k-mid"><span class="value">${fmtVal(k.actual, k.unit)}</span>${tgt}</div>
      ${k.floor || k.actual == null ? '' : bar(k.actual, k.target, st, k.pace)}
      <div class="deltas">${proj}${cmp(k, k.prev, 'vs ' + prevLbl)}${cmp(k, k.lyN, 'vs ' + lyLbl)}</div>
      ${opts.extra || ''}
    </div>`;
  }
  const kpiList = ks => `<div class="card klist">${ks.map(k => kpiCard(k)).join('')}</div>`;

  // ---------- lebar chart ikut ruang sebenar (supaya teks tak membesar/mengecil) ----------
  // frac = pecahan lebar #view yang diduduki kad bila layout berbilang lajur aktif
  function chartW(frac = 1, multiMin = 1100) {
    const vw = ($('#view') && $('#view').clientWidth) || innerWidth;
    const cs = getComputedStyle($('#view'));
    const inner = vw - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    const pad = innerWidth < 768 ? 34 : 42;
    const w = (innerWidth >= multiMin && frac < 1 ? (inner - 16) * frac : inner) - pad;
    return Math.max(280, Math.round(w));
  }

  // ---------- chart (SVG, satu siri) ----------
  function barChart(data, opts = {}) {
    const W = opts.w || Math.min(chartW(), 1100), H = opts.h || (W > 500 ? 190 : 150), pl = 44, pr = 6, pt = 10, pb = 20;
    const vals = data.map(d => d.value || 0);
    let max = Math.max(...vals, opts.target || 0, 0), min = Math.min(...vals, 0);
    if (max === min) max = min + 1;
    const y = v => pt + (H - pt - pb) * (max - v) / (max - min);
    const bw = (W - pl - pr) / data.length;
    const gap = Math.min(4, bw * 0.25);
    const tl = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v);
    const ticks = [min, (max + min) / 2, max].filter((v, i, a) => a.indexOf(v) === i);
    let s = `<svg class="chart${data.some(d => d.hl) ? ' has-hl' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (const t of ticks) s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 4}" y="${y(t) + 3}" text-anchor="end">${tl(t)}</text>`;
    if (min < 0) s += `<line class="grid-l zero" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>`;
    data.forEach((d, i) => {
      const hx = pl + i * bw;
      const lab = (opts.labelEvery ? i % opts.labelEvery === 0 || i === data.length - 1 : true)
        ? `<text x="${hx + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(d.label)}</text>` : '';
      if (d.value == null) { s += lab + `<rect class="hit" x="${hx}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-tip="${esc(d.tip || d.label)}"/>`; return; }
      const v = d.value, x = hx + gap / 2, w = Math.max(1, bw - gap);
      const y0 = y(Math.max(0, v)), h = Math.max(v === 0 ? 0 : 1.5, Math.abs(y(v) - y(0)));
      const r = Math.min(4, w / 2, h);
      const cls = 'b' + (v < 0 ? ' neg' : '') + (d.dim ? ' dim' : '') + (d.hl ? ' hl' : '');
      if (h > 0) {
        s += v >= 0
          ? `<path class="${cls}" d="M${x},${y0 + h}V${y0 + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y0 + h}z"/>`
          : `<path class="${cls}" d="M${x},${y(0)}V${y(0) + h - r}q0,${r} ${r},${r}h${w - 2 * r}q${r},0 ${r},-${r}V${y(0)}z"/>`;
      }
      s += lab + `<rect class="hit" x="${hx}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-tip="${esc(d.tip || `${d.label}: ${fmt(v)}`)}"/>`;
    });
    if (opts.target) s += `<line class="tline" x1="${pl}" x2="${W - pr}" y1="${y(opts.target)}" y2="${y(opts.target)}"/>`;
    return s + '</svg>';
  }

  // Line + area chart (Overview: views harian). Titik null = tiada data, garisan diputuskan.
  let lcId = 0;
  function lineChart(data, opts = {}) {
    const W = opts.w || chartW(), H = opts.h || (W > 500 ? 240 : 180), pl = 46, pr = 10, pt = 16, pb = 24;
    const vals = data.map(d => d.value).filter(v => v != null);
    if (!vals.length) return '';
    const n = data.length;
    let max = Math.max(...vals, opts.target || 0) * 1.08, min = 0;
    if (max <= min) max = min + 1;
    const x = i => pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1));
    const y = v => pt + (H - pt - pb) * (max - v) / (max - min);
    const tl = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v);
    const gid = 'lc-grad-' + (++lcId);
    let s = `<svg class="chart lc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1565FF" stop-opacity=".28"/><stop offset="1" stop-color="#1565FF" stop-opacity="0"/></linearGradient></defs>`;
    for (let k = 0; k <= 4; k++) {
      const t = min + (max - min) * k / 4;
      s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 6}" y="${y(t) + 3.5}" text-anchor="end">${tl(t)}</text>`;
    }
    // segmen berterusan
    const segs = []; let cur = [];
    data.forEach((d, i) => { if (d.value == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      const line = sg.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(data[i].value).toFixed(1)}`).join('');
      if (sg.length > 1) s += `<path d="${line}L${x(sg[sg.length - 1]).toFixed(1)},${y(0)}L${x(sg[0]).toFixed(1)},${y(0)}Z" fill="url(#${gid})"/>`;
      s += `<path class="line" d="${line}"/>`;
    }
    if (opts.target) s += `<line class="tline" x1="${pl}" x2="${W - pr}" y1="${y(opts.target)}" y2="${y(opts.target)}"/>`;
    const every = opts.labelEvery || Math.ceil(n / Math.max(4, Math.floor((W - pl) / 48)));
    const lastI = segs.length ? segs[segs.length - 1].slice(-1)[0] : -1;
    data.forEach((d, i) => {
      if (i % every === 0 || i === n - 1) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
      if (d.value != null && (n <= 31)) s += `<circle class="pt${i === lastI ? ' last' : ''}" cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="${i === lastI ? 4 : 2.5}"/>`;
      const bw = (W - pl - pr) / Math.max(1, n - 1);
      s += `<rect class="hit" x="${(x(i) - bw / 2).toFixed(1)}" y="${pt}" width="${bw.toFixed(1)}" height="${H - pt - pb}" data-tip="${esc(d.tip || `${d.label}: ${fmt(d.value)}`)}"/>`;
    });
    return s + '</svg>';
  }

  const tip = $('#tip');
  function showTip(e) {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip; tip.hidden = false;
    tip.style.left = Math.min(Math.max(r.left + r.width / 2, 80), innerWidth - 80) + 'px'; tip.style.top = r.top + 'px';
  }
  document.addEventListener('pointerover', showTip);
  document.addEventListener('pointerdown', showTip);
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ---------- 3 perkara bulan ni ----------
  // Insight padat: satu baris setiap satu, ketik untuk butiran
  function insightBlock(y, m) {
    const ins = KD.insights(state.ds, y, m);
    if (!ins.length) return '';
    return `<div class="card insights">${ins.map(i => `
      <details class="ins ${i.kind}"><summary>
        <span class="ins-i" aria-hidden="true">${i.kind === 'good' ? '✓' : '✕'}</span>
        <span class="ins-t">${esc(i.title)}</span><span class="ins-c">${esc(i.chip || '')}</span></summary>
        <p>${esc(i.text)}</p></details>`).join('')}</div>`;
  }

  // Cadangan fokus ikut peringkat funnel paling lemah
  const ACT = {
    profileViews: 'Hook 3 saat pertama dan CTA "tengok profile" dalam video.',
    uniqueClicks: 'Semak bio & pin video: pastikan sebab untuk klik link jelas (harga, promo, lokasi).',
    wa: 'Semak susunan Linktree: butang WhatsApp outlet patut paling atas dan jelas.',
    leads: 'Semak masa balas WhatsApp di outlet; klik yang tak dibalas cepat tak jadi lead.',
    walkin: 'Follow-up leads (harga, stok, janji temu) supaya mereka datang ke kedai.',
  };

  // ---------- views ----------
  function viewFunnel(key) {
    const [y, m] = parseKey(key);
    const f = KD.funnel(state.ds, y, m);
    const live = isCurrent(key);
    const ib = insightBlock(y, m);
    if (!f.stages.some(s => s.value > 0)) return ib + `<div class="card empty">Belum ada data aliran pelanggan untuk ${monLabel(key)}.</div>`;
    let h = `<h2>Aliran pelanggan <span class="note">· ${monLabel(key)}${live ? ' (bulan semasa)' : ''}</span></h2><div class="card flow">`;
    f.stages.forEach((s, i) => {
      if (i) {
        const isW = f.weakest && f.weakest.id === s.id, isS = f.strongest && f.strongest.id === s.id;
        const r = s.rate, w = r == null ? 0 : Math.min(100, r), mk = s.avg3 == null ? null : Math.min(100, s.avg3);
        const cmpTxt = s.avg3 != null ? `Purata 3 bln ${fmtPct(s.avg3)}` : (s.prevRate != null ? `Bulan lepas ${fmtPct(s.prevRate)}` : 'Tiada perbandingan');
        const dv = s.vsAvg == null ? '' : Math.abs(s.vsAvg) < 1 ? ' · ≈ sama' : ` · ${s.vsAvg >= 0 ? '▲' : '▼'}${Math.abs(s.vsAvg).toFixed(0)}%`;
        h += `<div class="step ${isW ? 'weak' : ''} ${isS ? 'strong' : ''}">
          <div class="row"><span class="rate">${fmtPct(r, r != null && r < 10 ? 2 : 1)} <span class="rn">${esc(s.note)}</span></span>
            ${isW ? '<span class="tag bad">✕ Paling lemah</span>' : isS ? '<span class="tag good">✓ Paling baik</span>' : ''}</div>
          ${r != null && r < 5 ? '' : `<div class="rbar" data-tip="${esc(`${s.note}: ${fmtPct(r)}${s.avg3 != null ? ' · purata 3 bln ' + fmtPct(s.avg3) : ''}`)}"><i style="width:${w.toFixed(1)}%"></i>${mk != null ? `<span class="avg" style="left:${mk.toFixed(1)}%"></span>` : ''}</div>`}
          <div class="sub">${cmpTxt}${dv}</div></div>`;
      }
      h += `<div class="stage"><span class="name">${esc(s.label)}</span><span class="v">${fmt(s.value)}</span></div>`;
    });
    h += `</div><div class="chart-cap">Setiap kadar = peringkat ini ÷ peringkat atas. Bar = kadar (0–100%); garis kecil = purata 3 bulan. Klik WhatsApp tak unik; Leads & Walk-in termasuk pelanggan dari saluran lain, jadi kadar boleh lebih 100%.</div>`;
    const act = f.weakest && ACT[f.weakest.id] ? `<div class="card action"><b>Cadangan fokus</b><p>${ACT[f.weakest.id]}</p></div>` : '';
    // Mobile: sorotan di atas (seperti asal). Desktop: dua lajur.
    return `<div class="fl-grid"><div class="fl-side">${ib ? `<h2 class="fl-h">Sorotan bulan ini</h2>${ib}` : ''}${act}</div><div class="fl-main">${h}</div></div>`;
  }

  function viewRingkasan(key) {
    const [y, m] = parseKey(key);
    const K = KD.kpis(state.ds, y, m);
    const s = KD.social(state.ds, y, m), ps = KD.social(state.ds, ...KD.prevYM(y, m));
    const tt = s.tiktok;
    let h = '';
    if (tt.days) {
      const daily = T.tiktokViews / s.daysInMonth;
      const chart = barChart(tt.daily.map(d => ({ label: d.d, value: d.views, tip: `${d.d} ${MON[m - 1]}: ${fmt(d.views)} views` })), { aria: 'Views TikTok harian', labelEvery: 5, h: 120, target: daily })
        + `<div class="chart-cap">Views harian · garis putus = kadar sasaran ${fmt(daily)}/hari · ${tt.days}/${s.daysInMonth} hari data</div>`;
      h += `<div style="margin-top:10px">${kpiCard(K.views, { hero: true, extra: chart })}</div>`;
    } else h += `<div class="card empty" style="margin-top:10px">Tiada data TikTok Insight untuk ${monLabel(key)} lagi.</div>`;

    const grid = ids => kpiList(ids.map(id => K[id]));
    if (tt.days) h += `<h2>TikTok engagement</h2>` + grid(['likes', 'comments', 'shares', 'profileViews', 'newFollowers', 'netGrowth']);
    h += `<h2>Traffic Linktree</h2>` + (K.uniqueClicks.actual != null ? grid(['uniqueClicks', 'ctrProfile', 'ctrAction', 'telegram']) : `<div class="card empty">Tiada data LINKTREE untuk bulan ini.</div>`);
    h += `<h2>Jualan (4 outlet)</h2>` + grid(['wa', 'leads', 'walkin', 'conversion']);

    h += `<h2>Facebook & Instagram</h2>`;
    const meta = (name, cur, prev) => {
      if (!cur.days) return `<div class="card"><b>${name}</b><div class="empty">Tiada data bulan ini.</div></div>`;
      const row = (l, k) => {
        const n = cur[k] * (s.daysInMonth / cur.days), p = prev.days ? prev[k] * (daysIn(...KD.prevYM(y, m)) / prev.days) : null;
        return `<tr><td>${l}</td><td><b>${fmt(cur[k])}</b></td><td>${delta(KD.change(n, p), '') || '—'}</td></tr>`;
      };
      return `<div class="card"><div class="row"><b>${name}</b><span class="sub">${cur.days} hari data</span></div>
        <table><thead><tr><th></th><th>Bulan ini</th><th>vs bln lepas</th></tr></thead><tbody>${row('Views', 'views')}${row('Reach', 'reach')}${row('Interactions', 'interactions')}${row('Visit', 'visit')}${row('Follow baru', 'follow')}</tbody></table></div>`;
    };
    h += `<div class="pair">${meta('Facebook', s.facebook, ps.facebook) + meta('Instagram', s.instagram, ps.instagram)}</div>`;
    return h;
  }

  async function viewContent(key) {
    const [y, m] = parseKey(key);
    const res = await KD.loadMonthPosts(state.ds, y, m);
    persist();
    if (res.error) return `<div class="card empty">Tak dapat baca tab per-post untuk ${monLabel(key)}: ${esc(res.error)}</div>`;
    const c = KD.contentStats(res.posts);
    if (!c.total) return `<div class="card empty">Belum ada post direkod untuk ${monLabel(key)}.</div>`;
    const pace = isCurrent(key) ? new Date().getDate() / daysIn(y, m) : 1;
    const mk = (label, actual, target) => ({ label, actual, target, pace, partial: pace < 1, status: KD.status(actual, target, pace) });
    let h = res.warning ? `<div class="warn-box">⚠ ${esc(res.warning)}</div>` : '';
    const top = [mk('Total Content', c.total, T.totalContent), mk('Views per Post (jumlah)', c.views, T.viewsPerPost)];
    if (c.hasType) top.push(mk('POV Customer', c.pov, T.povCustomer), mk('Strategic', c.strategic, T.strategic));
    h += `<div style="margin-top:10px">${kpiList(top)}</div>`;
    if (c.hasType) {
      const mix = (title, counts, tg) => `<div class="card"><b>${title}</b><table><thead><tr><th></th><th>Post</th><th>Target</th><th>Status</th></tr></thead><tbody>${Object.keys(tg).map(k => {
        const st = KD.status(counts[k], tg[k], pace);
        return `<tr><td>${esc(k)}</td><td><b>${counts[k]}</b></td><td>${tg[k]}</td><td><span class="st ${st.level}">${iconOf(st)}</span></td></tr>`;
      }).join('')}</tbody></table></div>`;
      h += `<h2>Strategic mix</h2><div class="pair">` + mix('Jenis', c.typeCount, T.strategicType) + mix('Subjek', c.subjCount, T.strategicSubject) + `</div>`;
    } else h += `<div class="chart-cap" style="margin-top:8px">Lajur TYPE (POV Customer / Strategic) bermula dari tab SEPT'26.</div>`;

    h += `<h2>Views ikut bucket <span class="note">· bebas, tak dijumlahkan</span></h2><div class="card"><div class="list">`;
    for (const [k, b] of Object.entries(c.bucketStats)) {
      const st = KD.status(b.views, b.target, pace);
      h += `<div class="li"><div class="top-row"><span class="name"><span class="st ${st.level}">${iconOf(st)}</span> ${esc(k)}</span>
        <span class="nums"><b>${fmt(b.views)}</b> / ${fmt(b.target)} · ${b.posts} post</span></div>${bar(b.views, b.target, st, pace)}</div>`;
    }
    h += `</div></div>`;

    const order = ['KUL', 'AOR', 'SP', 'PDG', 'HQ', 'REPOST'];
    const rank = o => order.indexOf(o) < 0 ? 99 : order.indexOf(o);
    h += `<h2>Ikut outlet</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Outlet</th><th>Post</th><th>Views</th><th>Purata</th><th>Gold+</th></tr></thead><tbody>`;
    for (const o of Object.keys(c.outlets).sort((a, b) => rank(a) - rank(b))) {
      const v = c.outlets[o], gold = (v.tiers.Gold || 0) + (v.tiers.Diamond || 0);
      h += `<tr><td>${esc(CFG.outletNames[o] || o)}</td><td>${v.posts}</td><td><b>${fmt(v.views)}</b></td><td>${fmt(v.views / v.posts)}</td><td>${gold}${v.tiers.Diamond ? ' 💎' : ''}</td></tr>`;
    }
    h += `</tbody></table></div><div class="chart-cap">Diamond ≥ 1M · Gold ≥ 300K · Silver ≥ 100K. Jumlah: ${Object.entries(c.tiers).map(([k, v]) => `${k} ${v}`).join(' · ')}</div></div>`;

    h += `<h2>Ikut kategori</h2><div class="card"><table><thead><tr><th>Kategori</th><th>Post</th><th>Views</th><th>Purata</th></tr></thead><tbody>`;
    for (const [k, v] of Object.entries(c.kategori).sort((a, b) => b[1].views - a[1].views))
      h += `<tr><td>${esc(k)}</td><td>${v.posts}</td><td><b>${fmt(v.views)}</b></td><td>${fmt(v.views / v.posts)}</td></tr>`;
    h += `</tbody></table></div>`;

    const hasUrl = c.top.some(p => p.url);
    h += `<h2>Top 5 post</h2><div class="card">`;
    for (const p of c.top) {
      const d = p.date ? `${p.date.d}/${p.date.m}` : '';
      const meta = `${esc(d)} · ${esc(CFG.outletNames[p.outlet] || p.outlet)} · ${esc(p.kategori)}${p.sub ? ' · ' + esc(p.sub) : ''}${p.type ? ' · ' + esc(p.type) : ''}`;
      const inner = `<span class="meta">${meta}</span><span class="v">${fmt(p.views)}${p.url ? ' <span class="go" aria-hidden="true">▶</span>' : ''}</span>`;
      h += p.url ? `<a class="top-post" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="top-post">${inner}</div>`;
    }
    h += `</div><div class="chart-cap">${hasUrl ? 'Ketik post untuk buka video.' : 'Tambah link video TikTok dalam lajur H tab bulanan supaya post boleh diketik terus ke video.'} Purata views/post: ${fmt(c.avg)}.</div>`;
    return h;
  }

  // Skor outlet (dikongsi tab Outlet & Overview — logik sama seperti asal)
  const OUTLET_ROWS = [
    ['RAW Video Phone', 'rawPhone'], ['RAW Video Repair', 'rawRepair'],
    ['Gambar Customer', 'customer'], ['Before / After', 'beforeAfter'],
    ['Klik WhatsApp', 'wa'], ['Klik Lokasi', 'location'],
    ['Leads', 'leads'], ['Walk-in', 'walkin'], ['Conversion', 'conversion'],
  ];
  function outletScores(key) {
    const [y, m] = parseKey(key);
    const o = KD.outletStats(state.ds, y, m), po = KD.outletStats(state.ds, ...KD.prevYM(y, m));
    const live = isCurrent(key);
    const pace = live ? Math.max(o.days.leads, 1) / daysIn(y, m) : 1;
    const cards = CFG.outlets.map(x => {
      let hit = 0, total = 0, miss = [], list = '';
      const vals = {};
      for (const [label, k] of OUTLET_ROWS) {
        const tg = k === 'conversion' ? T.conversion : T.outlet[x][k];
        const a = o.outlets[x][k];
        if (tg == null) continue;
        if (a == null) { vals[k] = { a: null, tg, st: { level: 'na' } }; list += `<li><span class="st na">–</span><span class="k">${label}</span><span class="v">tiada data</span></li>`; continue; }
        total++;
        const p = po.outlets[x][k];
        const st = KD.status(a, tg, k === 'conversion' ? 1 : pace, false, p != null ? a > p : null);
        vals[k] = { a, tg, st };
        if (st.level === 'good') hit++;
        if (st.level === 'bad') miss.push(label);
        const val = k === 'conversion' ? fmtPct(a, 0) : fmt(a);
        const tv = k === 'conversion' ? tg + '%' : fmt(tg);
        list += `<li><span class="st ${st.level}" aria-label="${statusWord(st, live)}">${iconOf(st)}</span><span class="k">${label}</span><span class="v"><b>${val}</b> / ${tv}</span></li>`;
      }
      const ratio = total ? hit / total : 0;
      // warna skor: tiada KPI merah = hijau/kuning; ada merah = kuning (≤1) atau merah
      const lvl = !miss.length ? (ratio >= 0.75 ? 'good' : 'warn') : miss.length <= 1 ? 'warn' : 'bad';
      return { x, hit, total, ratio, lvl, miss, list, vals };
    }).sort((a, b) => b.ratio - a.ratio);
    return { o, live, cards };
  }

  function viewOutlet(key) {
    const { o, live, cards } = outletScores(key);

    let h = `<h2>Skor outlet <span class="note">· KPI capai daripada jumlah</span></h2><div class="ostrip">${cards.map(c => `
      <a class="otile" href="#o-${c.x}"><span class="on">${CFG.outletNames[c.x]}</span>
        <span class="os ${c.lvl}">${c.hit}<span class="of">/${c.total}</span></span>
        <span class="ob"><i class="${c.lvl}" style="width:${(c.ratio * 100).toFixed(0)}%"></i></span>
        <span class="om">${c.miss.length ? `${c.miss.length} merah` : 'tiada merah'}</span></a>`).join('')}</div>`;
    h += `<div class="legend one"><span><span class="st good">✓</span> ${live ? 'On track' : 'Capai'}</span><span><span class="st warn">!</span> 80–99%</span><span><span class="st warn">↗</span> Naik</span><span><span class="st bad">✕</span> Belum</span></div>`;
    const wide = innerWidth >= 1024;
    h += `<div class="ogrid">` + cards.map((c, i) => `<details class="card outlet" id="o-${c.x}" ${wide || i === cards.length - 1 ? 'open' : ''}>
      <summary><span class="row"><b class="oname">${CFG.outletNames[c.x]}</b><span class="score ${c.lvl}">${c.hit}/${c.total} capai</span></span>
      ${c.miss.length ? `<span class="sub">Merah: ${c.miss.join(', ')}</span>` : ''}</summary>
      <ul class="olist">${c.list}</ul></details>`).join('') + `</div>`;
    h += `<div class="chart-cap">Ketik outlet untuk butiran (outlet paling lemah dibuka dulu). ↗ = bawah target tapi naik vs bulan lepas. Conversion = Walk-in ÷ Leads. Klik WhatsApp/Lokasi dari LINKTREE (${CFG.linktree.year}). ${live ? `Bulan semasa dinilai ikut kadar (${o.days.leads} hari data leads).` : ''}</div>`;
    return h;
  }

  function viewTrend(key) {
    const series = KD.monthlySeries(state.ds).filter(r => r.key <= key).slice(-12);
    const mk = (field, opts = {}) => barChart(series.map(r => {
      const [yy, mm] = parseKey(r.key), dim = daysIn(yy, mm);
      const days = r[field.split('_')[0] + '_days'] || 0;
      const partial = days > 0 && days < dim * 0.9;
      return { label: MON[mm - 1], value: r[field] ?? null, dim: partial, hl: r.key === key,
        tip: r[field] == null ? `${monLabel(r.key)}: tiada data` : `${monLabel(r.key)}: ${fmt(r[field])}${partial ? ` (${days}/${dim} hari)` : ''}` };
    }), { aria: opts.aria, target: opts.target, w: opts.w });
    // Kad separuh lebar pada desktop (≥900px, .pair)
    const half = Math.min(chartW(0.5, 900), 640);
    const sec = (title, body) => `<div class="card"><div class="card-h"><div><h3>${title}</h3></div></div>${body}</div>`;
    let h = `<h2>TikTok <span class="note">· garis putus = target 4M</span></h2><div class="pair">`;
    h += sec('Views bulanan', mk('tt_views', { target: T.tiktokViews, aria: 'Views TikTok bulanan', w: half }));
    h += sec('Net followers', mk('tt_netGrowth', { aria: 'Net followers bulanan', w: half }) + `<div class="chart-cap">Biru = bertambah, oren = berkurang. Had bawah ${fmt(T.netFollowersFloor)}.</div>`);
    h += `</div><h2>Facebook & Instagram</h2><div class="pair">`;
    h += sec('Facebook views', mk('fb_views', { aria: 'Views Facebook bulanan', w: half }) + `<div class="chart-cap">Bar pudar = data harian tak lengkap. Tiada bar = tiada data.</div>`);
    h += sec('Instagram views', mk('ig_views', { aria: 'Views Instagram bulanan', w: half }));
    const tot = series.map(r => ({ ...r, lead_all: CFG.outlets.reduce((a, x) => a + (r['lead_' + x] || 0), 0) || null, walk_all: CFG.outlets.reduce((a, x) => a + (r['walk_' + x] || 0), 0) || null }));
    const mk2 = f => barChart(tot.map(r => ({ label: MON[+r.key.slice(5) - 1], value: r[f], hl: r.key === key, tip: `${monLabel(r.key)}: ${fmt(r[f])}` })), { w: half });
    h += `</div><h2>Jualan (4 outlet)</h2><div class="pair">`;
    h += sec('Leads', mk2('lead_all')) + sec('Walk-in', mk2('walk_all'));
    h += `</div>`;
    h += `<h2>Jadual</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Bulan</th><th>TT Views</th><th>Net Fol.</th><th>FB</th><th>IG</th><th>Leads</th><th>Walk-in</th></tr></thead><tbody>`;
    for (const r of [...tot].reverse())
      h += `<tr><td>${monLabel(r.key)}</td><td>${fmt(r.tt_views)}</td><td>${fmt(r.tt_netGrowth)}</td><td>${fmt(r.fb_views)}</td><td>${fmt(r.ig_views)}</td><td>${fmt(r.lead_all)}</td><td>${fmt(r.walk_all)}</td></tr>`;
    h += `</tbody></table></div></div>`;
    return h;
  }

  // =========================================================
  // OVERVIEW — gabungan data sedia ada (KD.kpis, KD.social, KD.funnel,
  // KD.insights, KD.contentStats, skor outlet). Tiada formula KPI baru,
  // kecuali Engagement = Likes + Comments + Shares (target = jumlah 3 target rasmi).
  // =========================================================
  const IC = {
    posts: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 9v6l5-3z"/>',
    views: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eng: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5"/>',
    walk: '<path d="M4 9l1.5-5h13L20 9M4 9h16M5 9v11h14V9M10 20v-5h4v5"/>',
  };

  function ovCard(o) {
    const { label, sub, icon, actual, target, pace = 1, st, unit, d = '', foot = '', hero } = o;
    const live = pace < 1;
    const pct = target && actual != null ? 100 * actual / target : null;
    return `<div class="kc${hero ? ' hero-kc' : ''}">
      <div class="kc-h"><span class="kc-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[icon]}</svg></span>
        <span class="kc-l">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>
      <div class="kc-v">${actual == null ? '—' : fmtVal(actual, unit)}</div>
      <div class="kc-tg">Target <b>${fmtVal(target, unit)}</b></div>
      <div class="kc-ach"><span>Achievement</span><b>${pct == null ? '—' : Math.round(pct) + '%'}</b></div>
      ${actual == null ? '<div class="prog"><i style="width:0"></i></div>' : bar(actual, target, st, pace)}
      <div class="kc-f"><span class="chip ${st.level}">${iconOf(st)} ${statusWord(st, live)}</span>${d || foot}</div>
    </div>`;
  }

  async function viewOverview(key) {
    const [y, m] = parseKey(key);
    const live = isCurrent(key), dim = daysIn(y, m), today = new Date().getDate();
    const K = KD.kpis(state.ds, y, m);
    const [py, pm] = KD.prevYM(y, m), prevLbl = monShort(py, pm);
    const s = KD.social(state.ds, y, m), ps = KD.social(state.ds, py, pm);
    const res = await KD.loadMonthPosts(state.ds, y, m);
    persist();
    const c = res.error ? null : KD.contentStats(res.posts);
    const hasPosts = !!(c && c.total);
    const cPace = live ? today / dim : 1;
    const cmpD = k => cmp(k, k.prev, 'vs ' + prevLbl);

    // ---- KPI cards ----
    const postSt = KD.status(hasPosts ? c.total : null, T.totalContent, cPace);
    const eIds = ['likes', 'comments', 'shares'];
    const hasTT = s.tiktok.days > 0;
    const eAct = hasTT ? eIds.reduce((a, k) => a + (K[k].actual || 0), 0) : null;
    const eTg = eIds.reduce((a, k) => a + K[k].target, 0);
    const eNow = K.likes.nowN == null ? null : eIds.reduce((a, k) => a + (K[k].nowN || 0), 0);
    const ePrev = K.likes.prev == null ? null : eIds.reduce((a, k) => a + (K[k].prev || 0), 0);
    const eSt = KD.status(eAct, eTg, K.likes.pace, false, eNow != null && ePrev != null ? eNow > ePrev : null);
    const kd = (k, extra) => ({ label: k.label, actual: k.actual, target: k.target, pace: k.pace, st: k.status, unit: k.unit, d: cmpD(k), ...extra });

    let h = `<div class="ov-hello"><p>Prestasi marketing <b>${monLabel(key)}</b>${live ? ` · hari ${today} daripada ${dim}, status dinilai ikut kadar hari` : ''}</p>
      <span class="badge"><span class="live-dot"></span>${live ? 'Bulan semasa' : 'Bulan lengkap'}</span></div>`;
    h += `<div class="kc-grid">
      ${ovCard(kd(K.views, { label: 'Views', sub: 'TikTok', icon: 'views', hero: true }))}
      ${ovCard({ label: 'Total Posts', sub: 'Content bulan ini', icon: 'posts', actual: hasPosts ? c.total : null, target: T.totalContent, pace: cPace, st: postSt,
        foot: hasPosts ? `<span class="d"><span class="dl">purata</span> ${fmt(c.avg)}<span class="dl">/post</span></span>` : '' })}
      ${ovCard({ label: 'Engagement', sub: 'Likes + Comments + Shares', icon: 'eng', actual: eAct, target: eTg, pace: K.likes.pace, st: eSt,
        d: eNow != null && ePrev != null ? delta(KD.change(eNow, ePrev), 'vs ' + prevLbl) : '' })}
      ${ovCard(kd(K.wa, { label: 'WhatsApp Clicks', sub: '4 outlet · Linktree', icon: 'wa' }))}
      ${ovCard(kd(K.walkin, { label: 'Walk-in', sub: '4 outlet', icon: 'walk' }))}
    </div>`;

    // ---- Views trend + platform ----
    const daily = new Map(s.tiktok.daily.map(d => [d.d, d.views]));
    const pts = Array.from({ length: dim }, (_, i) => {
      const v = daily.has(i + 1) ? daily.get(i + 1) : null;
      return { label: String(i + 1), value: v, tip: v == null ? `${i + 1} ${MON[m - 1]}: tiada data` : `${i + 1} ${MON[m - 1]}: ${fmt(v)} views` };
    });
    const tgtDaily = T.tiktokViews / dim;
    const trendCard = hasTT
      ? `<div class="card"><div class="card-h"><div><h3>Views Trend</h3><div class="sub">TikTok harian · ${s.tiktok.days}/${dim} hari data · purata ${fmt(s.tiktok.views / s.tiktok.days)}/hari</div></div>
          <div class="legend"><span><i style="background:var(--brand)"></i>Views</span><span><i class="ln"></i>Kadar target ${fmt(tgtDaily)}/hari</span></div></div>
          ${lineChart(pts, { target: tgtDaily, aria: 'Trend views TikTok harian', w: chartW(2 / 3) })}</div>`
      : `<div class="card"><div class="card-h"><div><h3>Views Trend</h3></div></div><div class="empty">Tiada data TikTok Insight untuk ${monLabel(key)}.</div></div>`;

    const plats = [['tt', 'TikTok', 'T', s.tiktok, ps.tiktok], ['fb', 'Facebook', 'f', s.facebook, ps.facebook], ['ig', 'Instagram', 'IG', s.instagram, ps.instagram]];
    const pMax = Math.max(1, ...plats.map(p => p[3].days ? p[3].views : 0));
    const pTot = plats.reduce((a, p) => a + (p[3].days ? p[3].views : 0), 0);
    const platCard = `<div class="card"><div class="card-h"><div><h3>Platform Performance</h3><div class="sub">Views bulan ini · perbandingan dinormalkan ikut hari data</div></div></div><div class="plat">${plats.map(([id, name, ab, cur, prev]) => {
      if (!cur.days) return `<div class="plat-i"><div class="ph"><span class="pi ${id}">${ab}</span><span class="pn">${name}<small>Tiada data bulan ini</small></span><span class="pv">—</span></div></div>`;
      const n = cur.views * (dim / cur.days), p = prev.days ? prev.views * (daysIn(py, pm) / prev.days) : null;
      return `<div class="plat-i"><div class="ph"><span class="pi ${id}">${ab}</span><span class="pn">${name}<small>${cur.days} hari data · ${pTot ? Math.round(100 * cur.views / pTot) : 0}% daripada jumlah</small></span>
        <span class="pv">${fmt(cur.views)}${delta(KD.change(n, p), 'vs ' + prevLbl)}</span></div>
        <div class="pbar" data-tip="${esc(`${name}: ${fmt(cur.views)} views`)}"><i style="width:${(100 * cur.views / pMax).toFixed(1)}%"></i></div>
        <div class="plat-meta"><span>Reach <b>${fmt(cur.reach)}</b></span>${id === 'tt' ? `<span>Profile <b>${fmt(cur.profileViews)}</b></span>` : `<span>Interactions <b>${fmt(cur.interactions)}</b></span>`}</div></div>`;
    }).join('')}</div></div>`;
    h += `<div class="ov-row r21">${trendCard}${platCard}</div>`;

    // ---- Content funnel + target vs actual ----
    const f = KD.funnel(state.ds, y, m);
    const W = [100, 90, 80, 70, 61, 53];
    const C = [['#0A2E8A', '#123FB0'], ['#0F3AA8', '#1A50D0'], ['#1449C4', '#1F5DE6'], ['#1565FF', '#3A7BFF'], ['#3A7BFF', '#5E92FF'], ['#5E92FF', '#82AAFF']];
    let fun = '';
    if (f.stages.some(st => st.value > 0)) {
      f.stages.forEach((st, i) => {
        if (i) {
          const cls = f.weakest && f.weakest.id === st.id ? 'weak' : f.strongest && f.strongest.id === st.id ? 'strong' : '';
          fun += `<div class="vf-rate ${cls}"><b>${fmtPct(st.rate, st.rate != null && st.rate < 10 ? 2 : 1)}</b> ${esc(st.note)}${cls === 'weak' ? ' · paling lemah' : cls === 'strong' ? ' · paling baik' : ''}</div>`;
        }
        fun += `<div class="vf-st"><div class="vf-bar" style="--w:${W[i]}%;--c1:${C[i][0]};--c2:${C[i][1]}" data-tip="${esc(`${st.label}: ${fmt(st.value)}`)}"><span class="vn">${esc(st.label)}</span><span class="vv">${fmt(st.value)}</span></div></div>`;
      });
    }
    const funCard = `<div class="card"><div class="card-h"><div><h3>Content Funnel</h3><div class="sub">Views → Walk-in · kadar = peringkat ÷ peringkat atas</div></div></div>
      ${fun ? `<div class="vfun">${fun}</div><div class="chart-cap">Lebar bar menunjukkan urutan peringkat, bukan skala. Butiran penuh di tab Funnel.</div>` : `<div class="empty">Belum ada data aliran pelanggan.</div>`}</div>`;

    const trow = (label, k) => {
      const st = k.status, a = k.actual;
      const pct = k.floor ? null : st.pct;
      const tgTxt = k.floor ? `≥ ${fmt(k.target)}` : fmtVal(k.target, k.unit);
      const w = pct == null ? 0 : Math.min(100, pct);
      return `<tr><td>${esc(label)}</td><td>${tgTxt}</td><td><b>${fmtVal(a, k.unit)}</b></td>
        <td><span class="ach"><span class="mini"><i class="${st.level}" style="width:${w.toFixed(0)}%"></i></span>${pct == null ? '—' : Math.round(pct) + '%'}</span></td>
        <td><span class="chip ${st.level}">${iconOf(st)} ${statusWord(st, k.partial)}</span></td></tr>`;
    };
    const grp = t => `<tr class="grp"><td colspan="5">${t}</td></tr>`;
    let tva = grp('TikTok') + ['views', 'likes', 'comments', 'shares', 'profileViews', 'newFollowers', 'netGrowth'].map(id => trow(K[id].label, K[id])).join('');
    if (hasPosts) {
      const ck = (label, a, tg) => ({ actual: a, target: tg, status: KD.status(a, tg, cPace), partial: cPace < 1 });
      tva += grp('Content') + trow('Total Content', ck('', c.total, T.totalContent));
      if (c.hasType) tva += trow('POV Customer', ck('', c.pov, T.povCustomer)) + trow('Strategic', ck('', c.strategic, T.strategic));
    }
    tva += grp('Linktree') + ['uniqueClicks', 'ctrProfile', 'ctrAction', 'telegram'].map(id => trow(K[id].label, K[id])).join('');
    tva += grp('Jualan (4 outlet)') + ['wa', 'leads', 'walkin', 'conversion'].map(id => trow(K[id].label, K[id])).join('');
    const tvaCard = `<div class="card"><div class="card-h"><div><h3>Target vs Actual</h3><div class="sub">Target rasmi bulanan · Achievement = actual ÷ target</div></div></div>
      <div class="tbl-wrap"><table class="tva"><thead><tr><th>Metrik</th><th>Target</th><th>Actual</th><th>Achievement</th><th>Status</th></tr></thead><tbody>${tva}</tbody></table></div></div>`;
    h += `<div class="ov-row r12">${funCard}${tvaCard}</div>`;

    // ---- Top content + outlet performance ----
    let topCard = `<div class="card"><div class="card-h"><div><h3>Top Performing Content</h3><div class="sub">${hasPosts ? `${c.total} post · purata ${fmt(c.avg)} views/post` : 'Dari tab per-post bulanan'}</div></div></div>`;
    if (res.error) topCard += `<div class="empty">Tak dapat baca tab per-post: ${esc(res.error)}</div>`;
    else if (!hasPosts) topCard += `<div class="empty">Belum ada post direkod untuk ${monLabel(key)}.</div>`;
    else {
      topCard += `<ul class="tcl">${c.top.map((p, i) => {
        const tier = KD.tierOf(p.views);
        const ttl = `${p.kategori}${p.sub ? ' · ' + p.sub : ''}`;
        const meta = [p.date ? `${p.date.d}/${p.date.m}` : '', CFG.outletNames[p.outlet] || p.outlet, p.type].filter(Boolean).join(' · ');
        const inner = `<span class="rk">${i + 1}</span><span style="min-width:0"><span class="tt" style="display:block">${esc(ttl)}${p.url ? ' <span style="color:var(--brand);font-size:11px">▶</span>' : ''}</span><span class="tm" style="display:block">${esc(meta)}</span></span>
          <span class="tv">${fmt(p.views)}<span class="tier ${tier}">${tier}</span></span>`;
        return `<li>${p.url ? `<a class="tc" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="tc">${inner}</div>`}</li>`;
      }).join('')}</ul>`;
      if (res.warning) topCard += `<div class="warn-box">⚠ ${esc(res.warning)}</div>`;
    }
    topCard += `</div>`;

    const os = outletScores(key);
    const cell = (v, pctU) => {
      if (!v) return '<td>—</td>';
      if (v.a == null) return `<td><span class="dot na"></span>—</td>`;
      return `<td><span class="dot ${v.st.level}"></span><b>${pctU ? fmtPct(v.a, 0) : fmt(v.a)}</b> <span style="color:var(--muted)">/ ${pctU ? v.tg + '%' : fmt(v.tg)}</span></td>`;
    };
    const outCard = `<div class="card"><div class="card-h"><div><h3>Outlet Performance</h3><div class="sub">Skor = KPI capai daripada jumlah · disusun ikut skor</div></div></div>
      <div class="tbl-wrap"><table class="otbl"><thead><tr><th>Outlet</th><th>Skor</th><th>Leads</th><th>Walk-in</th><th>Conv.</th><th>Klik WA</th></tr></thead><tbody>
      ${os.cards.map(cd => `<tr><td><b>${esc(CFG.outletNames[cd.x])}</b></td><td><span class="score ${cd.lvl}">${cd.hit}/${cd.total}</span></td>
        ${cell(cd.vals.leads)}${cell(cd.vals.walkin)}${cell(cd.vals.conversion, true)}${cell(cd.vals.wa)}</tr>`).join('')}
      </tbody></table></div><div class="chart-cap">Butiran 9 KPI setiap outlet di tab Outlet.</div></div>`;
    h += `<div class="ov-row r11 wide-r">${topCard}${outCard}</div>`;

    // ---- Key highlights + next action ----
    const ins = KD.insights(state.ds, y, m);
    const hl = ins.map(i => ({ kind: i.kind, title: i.title, chip: i.chip, text: i.text }));
    if (hasPosts && c.top[0]) {
      const p = c.top[0];
      hl.push({ kind: 'good', title: 'Post terbaik bulan ini', chip: fmt(p.views), text: `${p.kategori}${p.sub ? ' · ' + p.sub : ''} dari ${CFG.outletNames[p.outlet] || p.outlet}${p.date ? `, ${p.date.d}/${p.date.m}` : ''}.` });
    }
    const hlCard = `<div class="card"><div class="card-h"><div><h3>Key Highlights</h3><div class="sub">Perkara paling penting bulan ini</div></div></div>
      ${hl.length ? `<ul class="hl-list">${hl.map(i => `<li class="${i.kind}"><span class="hi">${i.kind === 'good' ? '✓' : '✕'}</span><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div><span class="ins-c">${esc(i.chip || '')}</span></li>`).join('')}</ul>` : '<div class="empty">Belum cukup data untuk highlight.</div>'}</div>`;

    const acts = [];
    if (f.weakest && ACT[f.weakest.id]) acts.push({ t: `Baiki peringkat “${f.weakest.label}”`, p: ACT[f.weakest.id] });
    const weakO = [...os.cards].reverse().find(cd => cd.miss.length);
    if (weakO) acts.push({ t: `Outlet ${CFG.outletNames[weakO.x]}: ${weakO.miss.length} KPI merah`, p: `Fokus pada ${weakO.miss.join(', ')}.` });
    if (hasPosts && c.total < T.totalContent) {
      const need = T.totalContent - c.total, left = dim - today;
      acts.push(live && left > 0
        ? { t: `Tambah ${need} post lagi`, p: `Perlu ${need} post dalam ${left} hari lagi (≈${(need / left).toFixed(1)} sehari) untuk capai target ${T.totalContent}.` }
        : { t: `Content kurang ${need} post`, p: `Bulan ini ${c.total} post berbanding target ${T.totalContent}.` });
    }
    const naCard = `<div class="card next"><div class="card-h"><div><h3>Next Action</h3><div class="sub">Dijana dari funnel, skor outlet & target content</div></div></div>
      ${acts.length ? `<ol class="na-list">${acts.map(a => `<li><div><b>${esc(a.t)}</b><p>${esc(a.p)}</p></div></li>`).join('')}</ol>` : '<div class="empty">Tiada tindakan kritikal. Semua peringkat funnel dan outlet tiada KPI merah.</div>'}</div>`;
    h += `<div class="ov-row r11">${hlCard}${naCard}</div>`;
    return h;
  }

  // Status data: dalam menu ⓘ, bukan di setiap page
  function fillInfo() {
    const ds = state.ds; if (!ds) return;
    const names = { tiktok: 'TikTok Insight', facebook: 'Facebook Insight', instagram: 'Instagram Insight', supply: 'Supply Video V2', beforeAfter: 'Before/After', customer: 'Customer', leads: 'Leads', walkin: 'Walk-in', linktree: 'LINKTREE' };
    const li = Object.entries(names).map(([k, n]) => {
      const s = ds.sources[k]; if (!s) return '';
      return `<li><span class="${s.ok ? 'ok' : 'no'}">${s.ok ? '●' : '✕'}</span> ${n}: ${s.ok ? s.rows + ' baris' : esc(s.error)}</li>`;
    }).join('');
    $('#info-body').innerHTML = `<ul class="health">${li}</ul><p class="health">Dimuat ${new Date(ds.loadedAt).toLocaleString('ms-MY')}. Data dibaca terus dari Google Sheet setiap kali app dibuka atau bila tekan muat semula.</p>
      <p class="health">Status: ✓ capai/on track · ! 80–99% · ↗ bawah target tapi naik vs bulan lepas · ✕ bawah target & tak naik.</p>`;
  }

  // ---------- render ----------
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    document.querySelectorAll('.tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === state.tab);
      if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#page-title').textContent = TITLES[state.tab];
    document.title = `${TITLES[state.tab]} · KLIKI Marketing`;
    if (!state.ds) return;
    const key = state.month, view = $('#view');
    view.className = 'v-' + state.tab;
    let html;
    try {
      if (state.tab === 'content' || state.tab === 'overview') {
        if (!state.ds.posts[key]) view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Memuatkan post ${monLabel(key)}…</p></div>`;
        html = state.tab === 'content' ? await viewContent(key) : await viewOverview(key);
      } else if (state.tab === 'outlet') html = viewOutlet(key);
      else if (state.tab === 'trend') html = viewTrend(key);
      else if (state.tab === 'ringkasan') html = viewRingkasan(key);
      else html = viewFunnel(key);
    } catch (e) {
      console.error(e);
      html = `<div class="card empty">Ralat paparan: ${esc(e.message)}</div>`;
    }
    if (seq !== renderSeq) return;
    view.innerHTML = html;
    fillInfo();
  }

  function fillMonths() {
    const months = KD.monthsAvailable(state.ds).filter(k => k >= '2025-01');
    const now = new Date(), cur = KD.ym(now.getFullYear(), now.getMonth() + 1);
    if (!months.includes(cur)) months.push(cur);
    const sel = $('#month');
    sel.innerHTML = months.slice().reverse().map(k => `<option value="${k}">${monLabel(k)}</option>`).join('');
    if (!state.picked || !months.includes(state.month)) {
      const withData = KD.monthsAvailable(state.ds);
      state.month = withData[withData.length - 1] || cur;
    }
    sel.value = state.month;
  }

  function persist() { if (state.ds) localSet(CACHE_KEY, JSON.stringify(state.ds)); }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const btn = $('#refresh'), line = $('#status-line');
    btn.classList.add('spin'); line.className = 'status-line'; line.textContent = 'Mengemas kini dari Google Sheet…';
    try {
      const ds = await KD.loadAll((d, n) => { line.textContent = `Mengemas kini… ${d}/${n}`; });
      const failed = Object.entries(ds.sources).filter(([, s]) => !s.ok);
      if (failed.length === Object.keys(ds.sources).length) throw new Error(failed[0][1].error);
      state.ds = ds; persist(); fillMonths();
      line.textContent = `Dikemas kini ${new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}` + (failed.length ? ` · ${failed.length} sumber gagal (ketik ⓘ)` : '');
      if (failed.length) line.className = 'status-line err';
      await render();
    } catch (e) {
      line.className = 'status-line err';
      line.textContent = state.ds ? `Offline · papar data simpanan ${new Date(state.ds.loadedAt).toLocaleString('ms-MY')}` : `Gagal muat data: ${e.message}`;
      if (!state.ds) $('#view').innerHTML = `<div class="card empty">Tak dapat capai Google Sheet. Semak internet, atau pastikan sheet dikongsi "Anyone with the link".</div>`;
    } finally { state.loading = false; btn.classList.remove('spin'); }
  }

  // ---------- events ----------
  $('#month').addEventListener('change', e => { state.month = e.target.value; state.picked = true; render(); scrollTo(0, 0); });
  $('#refresh').addEventListener('click', () => { if (state.ds) state.ds.posts = {}; load(); });
  // jalur outlet: buka butiran & skrol
  document.addEventListener('click', e => {
    const t = e.target.closest('.otile'); if (!t) return;
    e.preventDefault();
    const d = document.querySelector(t.getAttribute('href')); if (!d) return;
    d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#info').addEventListener('click', () => { fillInfo(); $('#info-dlg').showModal(); });
  $('#info-close').addEventListener('click', () => $('#info-dlg').close());
  $('#info-dlg').addEventListener('click', e => { if (e.target.id === 'info-dlg') e.target.close(); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; localSet('tab', state.tab); render(); scrollTo(0, 0);
  }));
  // Lukis semula chart bila lebar berubah ketara (putar phone, ubah saiz tetingkap)
  let lastW = innerWidth, rT;
  addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40 && state.ds) { lastW = innerWidth; render(); } }, 200);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.ds && Date.now() - new Date(state.ds.loadedAt) > 10 * 60 * 1000) { state.ds.posts = {}; load(); }
  });

  // ---------- boot ----------
  try { const c = localGet(CACHE_KEY); if (c) { state.ds = JSON.parse(c); fillMonths(); render(); } } catch { /* cache rosak */ }
  load();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
