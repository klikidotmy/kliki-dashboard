// KLIKI Marketing Dashboard — UI (paparan sahaja; semua kiraan dalam data.js)
(function () {
  const CFG = window.KLIKI_CONFIG, KD = window.KD, T = CFG.targets;
  const $ = s => document.querySelector(s);
  const MON = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const CACHE_KEY = 'kliki-dash-v1';
  const TABS = ['overview', 'content', 'analisis', 'funnel', 'outlet', 'trend'];
  const TITLES = { overview: 'Overview: Company Marketing', content: 'Content Performance', analisis: 'Marketing Analysis', funnel: 'Aliran Pelanggan', outlet: 'Prestasi Outlet', trend: 'Trend Bulanan' };

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

  async function viewOutlet(key) {
    const { o, live, cards } = outletScores(key);
    const { c } = await monthContent(key);

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
    if (c) {
      const order = ['KUL', 'AOR', 'SP', 'PDG', 'HQ', 'REPOST'];
      const rank = x => order.indexOf(x) < 0 ? 99 : order.indexOf(x);
      h += `<h2>Content ikut outlet <span class="note">· tab per-post</span></h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Outlet</th><th>Post</th><th>Views</th><th>Purata</th><th>Gold+</th></tr></thead><tbody>`;
      for (const x of Object.keys(c.outlets).sort((a, b) => rank(a) - rank(b))) {
        const v = c.outlets[x], gold = (v.tiers.Gold || 0) + (v.tiers.Diamond || 0);
        h += `<tr><td>${esc(CFG.outletNames[x] || x)}</td><td>${v.posts}</td><td><b>${fmt(v.views)}</b></td><td>${fmt(v.views / v.posts)}</td><td>${gold}${v.tiers.Diamond ? ' 💎' : ''}</td></tr>`;
      }
      h += `</tbody></table></div></div>`;
    }
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
  // DATA BULAN (dikongsi Overview, Content, Analisis, Outlet)
  // =========================================================
  // Muat tab per-post bulan ini + bulan lepas (untuk perbandingan MoM content)
  async function monthContent(key) {
    const [y, m] = parseKey(key), [py, pm] = KD.prevYM(y, m);
    const [res, pres] = await Promise.all([KD.loadMonthPosts(state.ds, y, m), KD.loadMonthPosts(state.ds, py, pm)]);
    persist();
    const c = res.error ? null : KD.contentStats(res.posts);
    const pc = pres.error ? null : KD.contentStats(pres.posts);
    const live = isCurrent(key);
    const cPace = live ? new Date().getDate() / daysIn(y, m) : 1;
    return { res, c: c && c.total ? c : null, pc: pc && pc.total ? pc : null, cPace, live };
  }

  const IC = {
    posts: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 9v6l5-3z"/>',
    pov: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
    strat: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
    views: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eng: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    fol: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M17 8v6M14 11h6"/>',
    wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5"/>',
  };
  const icon = k => `<span class="kc-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span>`;
  const PLAT_AB = { tiktok: ['tt', 'T'], facebook: ['fb', 'f'], instagram: ['ig', 'IG'] };
  const platIc = id => `<span class="pi ${PLAT_AB[id][0]}">${PLAT_AB[id][1]}</span>`;

  // Kad KPI bertarget (content output)
  function ovCard(k, opts = {}) {
    const st = k.status, live = k.partial;
    const pct = k.target && k.actual != null ? 100 * k.actual / k.target : null;
    return `<div class="kc${opts.hero ? ' hero-kc' : ''}">
      <div class="kc-h">${icon(opts.icon)}<span class="kc-l">${esc(opts.label || k.label)}${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}</span></div>
      <div class="kc-v">${k.actual == null ? '—' : fmtVal(k.actual, k.unit)}</div>
      <div class="kc-tg">Target <b>${fmtVal(k.target, k.unit)}</b></div>
      <div class="kc-ach"><span>Achievement</span><b>${pct == null ? '—' : Math.round(pct) + '%'}</b></div>
      ${k.actual == null ? '<div class="prog"><i style="width:0"></i></div>' : bar(k.actual, k.target, st, k.pace)}
      <div class="kc-f"><span class="chip ${st.level}">${iconOf(st)} ${statusWord(st, live)}</span>${opts.d || ''}</div>
      ${opts.note ? `<div class="kc-note">${esc(opts.note)}</div>` : ''}
    </div>`;
  }
  // Kad metrik berbilang baris (views / engagement / followers / WhatsApp)
  function mCard({ ic, label, sub, value, valueSub, d = '', rows, note }) {
    return `<div class="card mcard">
      <div class="kc-h">${icon(ic)}<span class="kc-l">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></div>
      <div class="mc-v"><span class="kc-v">${value}</span>${valueSub ? `<span class="mc-vs">${valueSub}</span>` : ''}${d}</div>
      <ul class="mrows">${rows.join('')}</ul>
      ${note ? `<div class="chart-cap">${note}</div>` : ''}
    </div>`;
  }
  // satu baris: label kiri, nilai kanan, maklumat tambahan (target / delta) di bawah nilai
  const mRow = (lead, label, val, extra = '', cls = '') => `<li class="${cls}">${lead || ''}<span class="mr-l">${label}</span><span class="mr-v">${val}${extra ? `<small>${extra}</small>` : ''}</span></li>`;
  const pctOf = (a, t) => a == null || !t ? '' : `${Math.round(100 * a / t)}% daripada ${fmt(t)}`;
  const chipK = k => `<span class="chip ${k.status.level}">${iconOf(k.status)} ${statusWord(k.status, k.partial)}</span>`;

  // =========================================================
  // OVERVIEW — eksekutif, peringkat syarikat (semua outlet & platform digabung)
  // =========================================================
  async function viewOverview(key) {
    const [y, m] = parseKey(key);
    const { res, c, pc, cPace, live } = await monthContent(key);
    const dim = daysIn(y, m), today = new Date().getDate();
    const [py, pm] = KD.prevYM(y, m), prevLbl = monShort(py, pm);
    const sc = KD.scorecard(state.ds, y, m, c, pc, cPace);
    const S = id => sc.list.find(k => k.id === id);
    const K = KD.kpis(state.ds, y, m);
    const cc = KD.companyCompare(state.ds, y, m), co = cc.cur;
    const P = id => co.plats.find(p => p.id === id);
    const momD = v => delta(v, 'vs ' + prevLbl);

    let h = `<div class="ov-hello"><p>Prestasi Marketing KLIKI <b>${monLabel(key)}</b> · semua outlet & platform digabung${live ? ` · hari ${today}/${dim}, status dinilai ikut kadar hari` : ''}</p>
      <span class="badge"><span class="live-dot"></span>${live ? 'Bulan semasa' : 'Bulan lengkap'}</span></div>`;

    // ---- 1. Content output ----
    h += `<h2 class="sec">Content output <span class="note">· tab per-post bulanan, REPORT CONTENT DATA</span></h2>`;
    if (!c) h += `<div class="card empty">${res.error ? `Tak dapat baca tab per-post: ${esc(res.error)}` : `Belum ada post direkod untuk ${monLabel(key)}.`}</div>`;
    else {
      const noType = 'Lajur TYPE tiada dalam tab bulan ini';
      const ph = { actual: null, target: null, status: { level: 'na' }, partial: false };
      h += `<div class="kc-grid g3">
        ${ovCard(S('totalContent'), { icon: 'posts', hero: true, sub: `${fmt(c.avg)} views purata/post`, d: momD(S('totalContent').mom) })}
        ${ovCard(c.hasType ? S('pov') : { ...ph, target: T.povCustomer }, { icon: 'pov', label: 'POV Customer', sub: 'Content dari sudut pelanggan', d: c.hasType ? momD(S('pov').mom) : '', note: c.hasType ? '' : noType })}
        ${ovCard(c.hasType ? S('strategic') : { ...ph, target: T.strategic }, { icon: 'strat', label: 'Strategic Posts', sub: 'Educational · Trend · Review · Promo', d: c.hasType ? momD(S('strategic').mom) : '', note: c.hasType ? (c.noType ? `${c.noType} post tiada TYPE, tak dikira` : '') : noType })}
      </div>`;
      if (res.warning) h += `<div class="warn-box">⚠ ${esc(res.warning)}</div>`;
    }

    // ---- 2. Audience & hasil ----
    h += `<h2 class="sec">Audience & hasil <span class="note">· Insight akaun TikTok, Facebook, Instagram</span></h2><div class="mc-grid">`;
    const daysTxt = co.plats.filter(p => p.days).map(p => `${p.name} ${p.days}/${dim} hari`).join(' · ');
    const tt = P('tiktok');
    // Views
    h += mCard({ ic: 'views', label: 'Total Views', sub: 'Merentas platform',
      value: fmt(co.views), d: momD(cc.ch('views')),
      rows: co.plats.map(p => mRow(platIc(p.id), p.name + (p.id === 'tiktok' ? ' <span class="tgt">target ' + fmt(T.tiktokViews) + '</span>' : ''),
        p.views == null ? '—' : fmt(p.views),
        p.id === 'tiktok' && p.views != null ? `${Math.round(100 * p.views / T.tiktokViews)}% · ${statusWord(K.views.status, K.views.partial)}` : (p.views != null && co.views ? `${Math.round(100 * p.views / co.views)}% daripada jumlah` : 'tiada data'),
        p.id === 'tiktok' ? 'lv-' + K.views.status.level : '')),
      note: `${daysTxt || 'Tiada data'}. Target rasmi hanya untuk TikTok.` });
    // Engagement
    const engRow = (k, name) => mRow('', name, fmt(K[k].actual), K[k].actual == null ? '' : `${pctOf(K[k].actual, K[k].target)}`, 'lv-' + K[k].status.level + ' sub');
    h += mCard({ ic: 'eng', label: 'Total Engagement', sub: 'Merentas platform',
      value: fmt(co.engagement), d: momD(cc.ch('engagement')),
      rows: [
        mRow(platIc('tiktok'), 'TikTok <span class="tgt">likes + comments + shares</span>', fmt(tt.engagement), tt.engagement == null ? 'tiada data' : `${Math.round(100 * tt.engagement / (T.likes + T.comments + T.shares))}% daripada ${fmt(T.likes + T.comments + T.shares)}`),
        engRow('likes', 'Likes'), engRow('comments', 'Comments'), engRow('shares', 'Shares'),
        ...['facebook', 'instagram'].map(id => { const p = P(id); return mRow(platIc(id), `${p.name} <span class="tgt">interactions</span>`, fmt(p.engagement), p.engagement == null ? 'tiada data' : ''); }),
      ],
      note: 'Facebook & Instagram: sheet hanya rekod jumlah Interactions, tiada pecahan like/comment/share.' });
    // Followers
    h += mCard({ ic: 'fol', label: 'Follower Growth', sub: 'Follower baru, semua platform',
      value: fmt(co.newFollowers), d: momD(cc.ch('newFollowers')),
      rows: [
        mRow(platIc('tiktok'), 'TikTok <span class="tgt">follower baru</span>', fmt(tt.newFollowers), tt.newFollowers == null ? 'tiada data' : `${pctOf(tt.newFollowers, T.newFollowers)}`, 'lv-' + K.newFollowers.status.level),
        mRow('', 'Unfollow', tt.lostFollowers == null ? '—' : '−' + fmt(tt.lostFollowers), '', 'sub'),
        mRow('', 'Net', tt.netFollowers == null ? '—' : (tt.netFollowers > 0 ? '+' : '') + fmt(tt.netFollowers), `had bawah ${fmt(T.netFollowersFloor)}`, 'lv-' + K.netGrowth.status.level + ' sub'),
        ...['facebook', 'instagram'].map(id => { const p = P(id); return mRow(platIc(id), `${p.name} <span class="tgt">follow baru</span>`, fmt(p.newFollowers), p.newFollowers == null ? 'tiada data' : momD(cc.ch('newFollowers', id))); }),
      ],
      note: 'Facebook & Instagram tiada data unfollow, jadi net follower hanya untuk TikTok.' });
    // WhatsApp & Leads
    const mc = KD.monthCore(state.ds, y, m);
    const waAll = [mc.v.wa, mc.v.waOnline, mc.v.waBuyback].some(v => v != null) ? (mc.v.wa || 0) + (mc.v.waOnline || 0) + (mc.v.waBuyback || 0) : null;
    h += mCard({ ic: 'wa', label: 'WhatsApp Clicks & Leads', sub: 'LINKTREE (bulanan) · tab Leads (harian)',
      value: K.wa.actual == null ? '—' : fmt(K.wa.actual), valueSub: K.wa.actual == null ? 'LINKTREE belum diisi' : 'klik WA outlet',
      d: K.wa.actual == null ? '' : cmp(K.wa, K.wa.prev, 'vs ' + prevLbl),
      rows: [
        mRow('', 'Klik WA 4 outlet', fmt(K.wa.actual), K.wa.actual == null ? 'belum diisi' : pctOf(K.wa.actual, K.wa.target), 'lv-' + K.wa.status.level),
        mRow('', 'Klik WA Online Postage', fmt(mc.v.waOnline), mc.v.waOnline == null ? 'belum diisi' : '', 'sub'),
        mRow('', 'Klik WA Buyback', fmt(mc.v.waBuyback), mc.v.waBuyback == null ? 'belum diisi' : '', 'sub'),
        mRow('', 'Jumlah semua butang WA', fmt(waAll), '', 'sub'),
        mRow('', 'Leads 4 outlet', fmt(K.leads.actual), K.leads.actual == null ? 'tiada data bulan ini' : `${pctOf(K.leads.actual, K.leads.target)} · ${mc.days.leads} hari data`, 'lv-' + K.leads.status.level),
      ],
      note: 'Target WA (6,000) & Leads hanya meliputi 4 outlet. Online Postage & Buyback tiada target.' });
    h += `</div>`;

    // ---- 3. Ringkasan status KPI + sorotan ----
    const n = sc.list.length, nH = sc.hit.length, nM = sc.miss.length, nN = sc.na.length;
    const seg = (v, cls) => v ? `<i class="${cls}" style="flex:${v}"></i>` : '';
    const scoreCard = `<div class="card"><div class="card-h"><div><h3>Status KPI bulan ini</h3><div class="sub">${n} KPI bertarget${live ? ' · dinilai ikut kadar hari' : ''}</div></div>
        <button class="link-btn" data-goto="analisis">Analisis penuh →</button></div>
      <div class="sc-nums"><div class="good"><b>${nH}</b><span>${live ? 'On track' : 'Capai'}</span></div><div class="bad"><b>${nM}</b><span>Belum capai</span></div><div class="na"><b>${nN}</b><span>Tiada data</span></div></div>
      <div class="sc-bar">${seg(nH, 'good')}${seg(nM, 'bad')}${seg(nN, 'na')}</div>
      ${nM ? `<div class="sc-h">Paling jauh dari target</div><ul class="sc-list">${sc.miss.slice(0, 5).map(k => `<li><span>${esc(k.label)}</span><b>${Math.round((k.status.pct ?? 0))}%</b></li>`).join('')}</ul>` : ''}
    </div>`;
    const ins = KD.insights(state.ds, y, m);
    const hl = ins.map(i => ({ ...i }));
    if (c && c.top[0]) { const p = c.top[0]; hl.push({ kind: 'good', title: 'Post terbaik bulan ini', chip: fmt(p.views), text: `${p.kategori}${p.sub ? ' · ' + p.sub : ''}${p.type ? ' · ' + p.type : ''}${p.date ? `, ${p.date.d}/${p.date.m}` : ''}.` }); }
    const hlCard = `<div class="card"><div class="card-h"><div><h3>Key Highlights</h3><div class="sub">Dijana dari data sebenar bulan ini</div></div></div>
      ${hl.length ? `<ul class="hl-list">${hl.map(i => `<li class="${i.kind}"><span class="hi">${i.kind === 'good' ? '✓' : '✕'}</span><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div><span class="ins-c">${esc(i.chip || '')}</span></li>`).join('')}</ul>` : '<div class="empty">Belum cukup data untuk highlight.</div>'}</div>`;
    h += `<div class="ov-row r11">${scoreCard}${hlCard}</div>`;
    h += `<div class="chart-cap">Prestasi setiap outlet ada di tab Outlet. Views content per-post (tab bulanan) tidak dicampur dengan views Insight akaun untuk elak double count.</div>`;
    return h;
  }

  // =========================================================
  // CONTENT PERFORMANCE
  // =========================================================
  // Stacked bar: views bulanan ikut platform
  const PCOL = { tt: '#1565FF', fb: '#7FA8FF', ig: '#F0702B' };
  function stackChart(rows, opts = {}) {
    const W = opts.w || Math.min(chartW(), 1100), H = W > 500 ? 220 : 170, pl = 44, pr = 6, pt = 10, pb = 20;
    const tot = rows.map(r => r.parts.reduce((a, p) => a + (p.v || 0), 0));
    let max = Math.max(...tot, opts.target || 0, 1);
    const y = v => pt + (H - pt - pb) * (max - v) / max;
    const bw = (W - pl - pr) / rows.length, gap = Math.min(10, bw * 0.3);
    const tl = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (const t of [0, max / 2, max]) s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 4}" y="${y(t) + 3}" text-anchor="end">${tl(t)}</text>`;
    rows.forEach((r, i) => {
      const x = pl + i * bw + gap / 2, w = Math.max(2, bw - gap);
      let base = 0;
      for (const p of r.parts) {
        if (!p.v) continue;
        const y1 = y(base + p.v), y0 = y(base);
        s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${p.c}" opacity="${r.dim ? .45 : 1}"/>`;
        base += p.v;
      }
      s += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle"${r.hl ? ' style="font-weight:700;fill:var(--text)"' : ''}>${esc(r.label)}</text>`;
      s += `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-tip="${esc(r.tip)}"/>`;
    });
    return s + '</svg>';
  }

  async function viewContent(key) {
    const [y, m] = parseKey(key);
    const { res, c, pc, cPace, live } = await monthContent(key);
    const [py, pm] = KD.prevYM(y, m), prevLbl = monShort(py, pm);
    let h = '';

    // ---- 1. Output vs target ----
    h += `<h2>Content output vs target</h2>`;
    if (!c) h += `<div class="card empty">${res.error ? `Tak dapat baca tab per-post untuk ${monLabel(key)}: ${esc(res.error)}` : `Belum ada post direkod untuk ${monLabel(key)}.`}</div>`;
    else {
      const sc = KD.scorecard(state.ds, y, m, c, pc, cPace);
      const ids = ['totalContent', 'pov', 'strategic', 'postViews'].filter(id => sc.list.some(k => k.id === id));
      const ks = ids.map(id => { const k = sc.list.find(x => x.id === id); return { ...k, nowN: k.nowN, prev: k.prev, lyN: null }; });
      h += res.warning ? `<div class="warn-box">⚠ ${esc(res.warning)}</div>` : '';
      h += kpiList(ks);
      if (c.noType) h += `<div class="warn-box">⚠ ${c.noType} post tiada TYPE dalam sheet, jadi tak dikira sebagai POV atau Strategic.</div>`;
      if (c.hasType) {
        const mix = (title, counts, tg) => `<div class="card"><b>${title}</b><table><thead><tr><th></th><th>Post</th><th>Target</th><th>Status</th></tr></thead><tbody>${Object.keys(tg).map(k => {
          const st = KD.status(counts[k], tg[k], cPace);
          return `<tr><td>${esc(k)}</td><td><b>${counts[k]}</b></td><td>${tg[k]}</td><td><span class="st ${st.level}">${iconOf(st)}</span></td></tr>`;
        }).join('')}</tbody></table></div>`;
        h += `<h2>Strategic mix</h2><div class="pair">` + mix('Jenis', c.typeCount, T.strategicType) + mix('Subjek', c.subjCount, T.strategicSubject) + `</div>`;
      } else h += `<div class="chart-cap" style="margin-top:8px">Lajur TYPE (POV Customer / Strategic) bermula dari tab SEPT'26.</div>`;
    }

    // ---- 2. Prestasi platform ----
    const cc = KD.companyCompare(state.ds, y, m), co = cc.cur, dim = daysIn(y, m);
    const cell = (p, k) => `<td><b>${fmt(p[k])}</b>${p[k] != null ? delta(cc.ch(k, p.id), '') : ''}</td>`;
    h += `<h2>Prestasi TikTok, Instagram & Facebook <span class="note">· ▲▼ vs ${prevLbl}, dinormalkan ikut hari data</span></h2>
      <div class="card"><div class="tbl-wrap"><table class="ptbl"><thead><tr><th>Platform</th><th>Views</th><th>Reach</th><th>Engagement</th><th>Follower baru</th><th>Hari data</th></tr></thead><tbody>
      ${co.plats.map(p => `<tr><td><span class="pcell">${platIc(p.id)}${p.name}</span></td>${cell(p, 'views')}${cell(p, 'reach')}${cell(p, 'engagement')}${cell(p, 'newFollowers')}<td>${p.days}/${dim}</td></tr>`).join('')}
      <tr class="tot"><td>Jumlah</td><td><b>${fmt(co.views)}</b>${delta(cc.ch('views'), '')}</td><td><b>${fmt(co.reach)}</b></td><td><b>${fmt(co.engagement)}</b>${delta(cc.ch('engagement'), '')}</td><td><b>${fmt(co.newFollowers)}</b>${delta(cc.ch('newFollowers'), '')}</td><td></td></tr>
      </tbody></table></div><div class="chart-cap">Engagement TikTok = Likes + Comments + Shares; Facebook & Instagram = Interactions. Reach tidak dijumlahkan sebagai audiens unik (orang sama boleh dikira di beberapa platform).</div></div>`;

    // ---- 3. Trend views bulanan ----
    const series = KD.monthlySeries(state.ds).filter(r => r.key <= key).slice(-12);
    const rows = series.map(r => {
      const [yy, mm] = parseKey(r.key), d = daysIn(yy, mm);
      const partial = ['tt', 'fb', 'ig'].some(p => r[p + '_days'] && r[p + '_days'] < d * 0.9);
      const parts = [{ v: r.tt_views, c: PCOL.tt }, { v: r.fb_views, c: PCOL.fb }, { v: r.ig_views, c: PCOL.ig }];
      const tot = parts.reduce((a, p) => a + (p.v || 0), 0);
      return { label: MON[mm - 1], parts, hl: r.key === key, dim: partial,
        tip: `${monLabel(r.key)}: ${fmt(tot)} · TikTok ${fmt(r.tt_views)} · FB ${fmt(r.fb_views)} · IG ${fmt(r.ig_views)}${partial ? ' (data tak lengkap)' : ''}` };
    });
    h += `<h2>Trend views bulanan</h2><div class="card"><div class="card-h"><div><h3>Views ikut platform</h3><div class="sub">12 bulan terakhir · Insight akaun</div></div>
      <div class="legend"><span><i style="background:${PCOL.tt}"></i>TikTok</span><span><i style="background:${PCOL.fb}"></i>Facebook</span><span><i style="background:${PCOL.ig}"></i>Instagram</span></div></div>
      ${stackChart(rows, { aria: 'Views bulanan ikut platform' })}<div class="chart-cap">Bar pudar = data harian bulan itu belum lengkap.</div></div>`;

    if (!c) return h;

    // ---- 4. Top content ----
    h += `<h2>Top-performing content</h2><div class="card"><ul class="tcl">${c.top.map((p, i) => {
      const tier = KD.tierOf(p.views);
      const ttl = `${p.kategori}${p.sub ? ' · ' + p.sub : ''}`;
      const meta = [p.date ? `${p.date.d}/${p.date.m}` : '', p.type, CFG.outletNames[p.outlet] || p.outlet].filter(Boolean).join(' · ');
      const inner = `<span class="rk">${i + 1}</span><span style="min-width:0"><span class="tt" style="display:block">${esc(ttl)}${p.url ? ' <span style="color:var(--brand);font-size:11px">▶</span>' : ''}</span><span class="tm" style="display:block">${esc(meta)}</span></span>
        <span class="tv">${fmt(p.views)}<span class="tier ${tier}">${tier}</span></span>`;
      return `<li>${p.url ? `<a class="tc" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="tc">${inner}</div>`}</li>`;
    }).join('')}</ul><div class="chart-cap">${c.top.some(p => p.url) ? 'Ketik post untuk buka video. ' : ''}Views TikTok per post · ${c.total} post · purata ${fmt(c.avg)}/post.</div></div>`;

    // ---- 5. Content type & funnel ----
    const grpTable = (title, g, order) => {
      const keys = Object.keys(g).sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : g[b].views - g[a].views));
      const tv = keys.reduce((a, k) => a + g[k].views, 0);
      return `<div class="card"><b>${title}</b><div class="tbl-wrap"><table><thead><tr><th></th><th>Post</th><th>Views</th><th>Purata</th><th>% views</th></tr></thead><tbody>${keys.map(k => `<tr><td>${esc(k)}</td><td>${g[k].posts}</td><td><b>${fmt(g[k].views)}</b></td><td>${fmt(g[k].views / g[k].posts)}</td><td>${tv ? Math.round(100 * g[k].views / tv) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
    };
    h += `<h2>Prestasi ikut content type & funnel</h2><div class="pair wide">`;
    h += c.hasType ? grpTable('Content type (TYPE)', c.byType) : `<div class="card"><b>Content type</b><div class="empty">Lajur TYPE tiada dalam tab bulan ini.</div></div>`;
    h += c.hasFunnel ? grpTable('Funnel (TOFU / MOFU / BOFU)', c.byFunnel, ['TOFU', 'MOFU', 'BOFU'])
      : `<div class="card"><b>Funnel TOFU / MOFU / BOFU</b><div class="empty">Tab per-post belum ada lajur TOFU/MOFU/BOFU.<br>Tambah satu lajur dengan nilai TOFU, MOFU atau BOFU untuk setiap post dan bahagian ini akan dipaparkan secara automatik.</div></div>`;
    h += `</div>`;
    h += `<div class="pair wide">${grpTable('Kategori', c.kategori)}<div class="card"><b>Views ikut bucket <span class="note">· bebas, tak dijumlahkan</span></b><div class="list" style="margin-top:10px">${Object.entries(c.bucketStats).map(([k, b]) => {
      const st = KD.status(b.views, b.target, cPace);
      return `<div class="li"><div class="top-row"><span class="name"><span class="st ${st.level}">${iconOf(st)}</span> ${esc(k)}</span><span class="nums"><b>${fmt(b.views)}</b> / ${fmt(b.target)} · ${b.posts} post</span></div>${bar(b.views, b.target, st, cPace)}</div>`;
    }).join('')}</div></div></div>`;
    h += `<div class="chart-cap">Diamond ≥ 1M · Gold ≥ 300K · Silver ≥ 100K. ${live ? 'Bulan semasa: status dinilai ikut kadar hari.' : ''}</div>`;
    return h;
  }

  // =========================================================
  // MARKETING ANALYSIS
  // =========================================================
  const NA_WHY = { 'Linktree & WhatsApp': 'LINKTREE belum diisi untuk bulan ini (dikemas kini sebulan sekali)', 'Leads & Walk-in': 'Tab Leads / Walk-in belum ada data bulan ini', TikTok: 'Tiada data TikTok Insight bulan ini', Content: 'Tab per-post tiada data' };
  async function viewAnalysis(key) {
    const [y, m] = parseKey(key);
    const { c, pc, cPace, live } = await monthContent(key);
    const [py, pm] = KD.prevYM(y, m), prevLbl = monShort(py, pm);
    const sc = KD.scorecard(state.ds, y, m, c, pc, cPace);
    let h = `<div class="ov-hello"><p>Analisis KPI <b>${monLabel(key)}</b> berbanding target rasmi dan ${monLabel(KD.ym(py, pm))}${live ? ' · bulan semasa dinilai ikut kadar hari' : ''}</p></div>`;
    h += `<div class="sc-tiles"><div class="good"><b>${sc.hit.length}</b><span>${live ? 'On track' : 'Capai target'}</span></div><div class="bad"><b>${sc.miss.length}</b><span>${live ? 'Ketinggalan' : 'Gagal capai'}</span></div><div class="na"><b>${sc.na.length}</b><span>Tiada data</span></div></div>`;

    // sorotan + cadangan
    const ins = KD.insights(state.ds, y, m), f = KD.funnel(state.ds, y, m);
    const act = f.weakest && ACT[f.weakest.id] ? `<div class="card action"><b>Cadangan fokus: ${esc(f.weakest.label)}</b><p>${ACT[f.weakest.id]}</p></div>` : '';
    // perubahan terbesar vs bulan lepas
    const withMom = sc.list.filter(k => k.mom != null && Number.isFinite(k.mom) && !k.floor);
    const up = [...withMom].sort((a, b) => b.mom - a.mom).filter(k => k.mom > 0).slice(0, 4);
    const down = [...withMom].sort((a, b) => a.mom - b.mom).filter(k => k.mom < 0).slice(0, 4);
    const mv = (list, cls) => list.length ? `<ul class="sc-list">${list.map(k => `<li><span>${esc(k.label)}</span><b class="${cls}">${k.mom > 0 ? '▲' : '▼'} ${Math.abs(k.mom) >= 999 ? '>999' : Math.abs(k.mom).toFixed(0)}%</b></li>`).join('')}</ul>` : '<div class="empty">Tiada</div>';
    h += `<div class="ov-row r11">
      <div class="card"><div class="card-h"><div><h3>Insights</h3><div class="sub">Dijana dari data sebenar</div></div></div>
        ${ins.length ? `<ul class="hl-list">${ins.map(i => `<li class="${i.kind}"><span class="hi">${i.kind === 'good' ? '✓' : '✕'}</span><div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div><span class="ins-c">${esc(i.chip || '')}</span></li>`).join('')}</ul>` : '<div class="empty">Belum cukup data.</div>'}${act}</div>
      <div class="card"><div class="card-h"><div><h3>Perubahan vs ${prevLbl}</h3><div class="sub">Dinormalkan ikut hari data supaya bulan separa boleh dibanding</div></div></div>
        <div class="pair tight"><div><div class="sc-h">Naik paling banyak</div>${mv(up, 'up')}</div><div><div class="sc-h">Turun paling banyak</div>${mv(down, 'down')}</div></div></div>
    </div>`;

    const trow = k => {
      const st = k.status, pct = k.floor ? null : st.pct, w = pct == null ? 0 : Math.min(100, pct);
      const tg = k.floor ? `≥ ${fmt(k.target)}` : fmtVal(k.target, k.unit);
      const momTxt = k.floor || (k.nowN != null && k.nowN < 0) ? cmp(k, k.prev, '') : delta(k.mom, '');
      return `<tr><td>${esc(k.label)}<small>${esc(k.group)}</small></td><td>${tg}</td><td><b>${fmtVal(k.actual, k.unit)}</b></td>
        <td><span class="ach"><span class="mini"><i class="${st.level}" style="width:${w.toFixed(0)}%"></i></span>${pct == null ? '—' : Math.round(pct) + '%'}</span></td>
        <td>${momTxt || '—'}</td><td>${chipK(k)}</td></tr>`;
    };
    const tbl = (title, list, sub) => list.length ? `<h2>${title} <span class="note">· ${list.length} KPI${sub ? ' · ' + sub : ''}</span></h2><div class="card"><div class="tbl-wrap"><table class="tva"><thead><tr><th>KPI</th><th>Target</th><th>Actual</th><th>Achievement</th><th>vs ${prevLbl}</th><th>Status</th></tr></thead><tbody>${list.map(trow).join('')}</tbody></table></div></div>` : '';
    h += tbl(live ? 'KPI on track' : 'KPI capai target', sc.hit);
    h += tbl(live ? 'KPI ketinggalan' : 'KPI gagal capai', sc.miss, 'jurang terbesar di atas');
    if (sc.na.length) {
      const byG = {};
      for (const k of sc.na) (byG[k.group] = byG[k.group] || []).push(k.label);
      h += `<h2>Tiada data <span class="note">· tidak dikira sebagai 0</span></h2><div class="card"><ul class="na-why">${Object.entries(byG).map(([g, l]) => `<li><b>${esc(l.join(', '))}</b><p>${esc(NA_WHY[g] || 'Sumber data kosong')}</p></li>`).join('')}</ul></div>`;
    }
    if (!c) h += `<div class="warn-box">⚠ KPI content tidak dinilai kerana tab per-post ${monLabel(key)} tiada data.</div>`;
    if (c && live) h += `<div class="chart-cap">Views content per-post bulan semasa masih bertambah (video baru belum cukup umur), jadi perbandingan views per-post dengan bulan lepas belum muktamad.</div>`;
    h += `<div class="chart-cap">Status: ✓ capai/on track · ! 80–99% · ↗ bawah target tapi naik vs bulan lepas · ✕ bawah target & tak naik. Butiran aliran pelanggan di tab Funnel.</div>`;
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
      if (['overview', 'content', 'analisis', 'outlet'].includes(state.tab) && !state.ds.posts[key]) {
        view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Memuatkan post ${monLabel(key)}…</p></div>`;
      }
      if (state.tab === 'overview') html = await viewOverview(key);
      else if (state.tab === 'content') html = await viewContent(key);
      else if (state.tab === 'analisis') html = await viewAnalysis(key);
      else if (state.tab === 'outlet') html = await viewOutlet(key);
      else if (state.tab === 'trend') html = viewTrend(key);
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
    const g = e.target.closest('[data-goto]');
    if (g) { state.tab = g.dataset.goto; localSet('tab', state.tab); render(); scrollTo(0, 0); return; }
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
