// KLIKI Marketing Dashboard — UI (paparan sahaja; semua kiraan dalam data.js)
(function () {
  const CFG = window.KLIKI_CONFIG, KD = window.KD, T = CFG.targets;
  const $ = s => document.querySelector(s);
  const MON = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const CACHE_KEY = 'kliki-dash-v1';
  const TABS = ['funnel', 'ringkasan', 'content', 'outlet', 'trend'];

  const savedTab = localGet('tab');
  const state = { ds: null, month: null, picked: false, tab: TABS.includes(savedTab) ? savedTab : 'funnel', loading: false };

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

  // ---------- chart (SVG, satu siri) ----------
  function barChart(data, opts = {}) {
    const W = 340, H = opts.h || 150, pl = 44, pr = 6, pt = 10, pb = 20;
    const vals = data.map(d => d.value || 0);
    let max = Math.max(...vals, opts.target || 0, 0), min = Math.min(...vals, 0);
    if (max === min) max = min + 1;
    const y = v => pt + (H - pt - pb) * (max - v) / (max - min);
    const bw = (W - pl - pr) / data.length;
    const gap = Math.min(4, bw * 0.25);
    const tl = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + 'K' : Math.round(v);
    const ticks = [min, (max + min) / 2, max].filter((v, i, a) => a.indexOf(v) === i);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">`;
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

  // ---------- views ----------
  function viewFunnel(key) {
    const [y, m] = parseKey(key);
    const f = KD.funnel(state.ds, y, m);
    const live = isCurrent(key);
    let h = insightBlock(y, m);
    if (!f.stages.some(s => s.value > 0)) return h + `<div class="card empty">Belum ada data aliran pelanggan untuk ${monLabel(key)}.</div>`;
    h += `<h2>Aliran pelanggan <span class="note">· ${monLabel(key)}${live ? ' (bulan semasa)' : ''}</span></h2><div class="card flow">`;
    f.stages.forEach((s, i) => {
      if (i) {
        const isW = f.weakest && f.weakest.id === s.id, isS = f.strongest && f.strongest.id === s.id;
        const r = s.rate, w = r == null ? 0 : Math.min(100, r), mk = s.avg3 == null ? null : Math.min(100, s.avg3);
        const cmpTxt = s.avg3 != null ? `purata 3 bln ${fmtPct(s.avg3)}` : (s.prevRate != null ? `bulan lepas ${fmtPct(s.prevRate)}` : 'tiada perbandingan');
        const dv = s.vsAvg == null ? '' : Math.abs(s.vsAvg) < 1 ? ' · ≈ sama' : ` · ${s.vsAvg >= 0 ? '▲' : '▼'} ${Math.abs(s.vsAvg).toFixed(0)}%`;
        h += `<div class="step ${isW ? 'weak' : ''} ${isS ? 'strong' : ''}">
          <div class="row"><span class="rate">${fmtPct(r, r != null && r < 10 ? 2 : 1)}${r > 100 ? ' <span class="dl">(&gt;100%)</span>' : ''}</span>
            ${isW ? '<span class="tag bad">✕ Paling lemah</span>' : isS ? '<span class="tag good">✓ Paling baik</span>' : ''}</div>
          ${r != null && r < 5 ? '' : `<div class="rbar" data-tip="${esc(`${s.note}: ${fmtPct(r)}${s.avg3 != null ? ' · purata 3 bln ' + fmtPct(s.avg3) : ''}`)}"><i style="width:${w.toFixed(1)}%"></i>${mk != null ? `<span class="avg" style="left:${mk.toFixed(1)}%"></span>` : ''}</div>`}
          <div class="sub">${esc(s.note)} · ${cmpTxt}${dv}</div></div>`;
      }
      h += `<div class="stage"><span class="name">${esc(s.label)}</span><span class="v">${fmt(s.value)}</span></div>`;
    });
    h += `</div><div class="chart-cap">Bar = kadar peralihan (0–100%); garis kecil = purata 3 bulan. Ini aliran, bukan corong tertutup: klik WhatsApp tak unik, dan Leads/Walk-in termasuk pelanggan dari saluran lain.</div>`;
    const ACT = {
      profileViews: 'Hook 3 saat pertama dan CTA "tengok profile" dalam video.',
      uniqueClicks: 'Semak bio & pin video: pastikan sebab untuk klik link jelas (harga, promo, lokasi).',
      wa: 'Semak susunan Linktree: butang WhatsApp outlet patut paling atas dan jelas.',
      leads: 'Semak masa balas WhatsApp di outlet; klik yang tak dibalas cepat tak jadi lead.',
      walkin: 'Follow-up leads (harga, stok, janji temu) supaya mereka datang ke kedai.',
    };
    if (f.weakest && ACT[f.weakest.id]) h += `<div class="card action"><b>Cadangan fokus</b><p>${ACT[f.weakest.id]}</p></div>`;
    return h;
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
    h += meta('Facebook', s.facebook, ps.facebook) + meta('Instagram', s.instagram, ps.instagram);
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
      h += `<h2>Strategic mix</h2>` + mix('Jenis', c.typeCount, T.strategicType) + mix('Subjek', c.subjCount, T.strategicSubject);
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

  function viewOutlet(key) {
    const [y, m] = parseKey(key);
    const o = KD.outletStats(state.ds, y, m), po = KD.outletStats(state.ds, ...KD.prevYM(y, m));
    const live = isCurrent(key);
    const pace = live ? Math.max(o.days.leads, 1) / daysIn(y, m) : 1;
    const rows = [
      ['RAW Video Phone', 'rawPhone'], ['RAW Video Repair', 'rawRepair'],
      ['Gambar Customer', 'customer'], ['Before / After', 'beforeAfter'],
      ['Klik WhatsApp', 'wa'], ['Klik Lokasi', 'location'],
      ['Leads', 'leads'], ['Walk-in', 'walkin'], ['Conversion', 'conversion'],
    ];
    const cards = CFG.outlets.map(x => {
      let hit = 0, total = 0, miss = [], list = '';
      for (const [label, k] of rows) {
        const tg = k === 'conversion' ? T.conversion : T.outlet[x][k];
        const a = o.outlets[x][k];
        if (tg == null) continue;
        if (a == null) { list += `<li><span class="st na">–</span><span class="k">${label}</span><span class="v">tiada data</span></li>`; continue; }
        total++;
        const p = po.outlets[x][k];
        const st = KD.status(a, tg, k === 'conversion' ? 1 : pace, false, p != null ? a > p : null);
        if (st.level === 'good') hit++;
        if (st.level === 'bad') miss.push(label);
        const val = k === 'conversion' ? fmtPct(a, 0) : fmt(a);
        const tv = k === 'conversion' ? tg + '%' : fmt(tg);
        list += `<li><span class="st ${st.level}" aria-label="${statusWord(st, live)}">${iconOf(st)}</span><span class="k">${label}</span><span class="v"><b>${val}</b> / ${tv}</span></li>`;
      }
      const ratio = total ? hit / total : 0;
      // warna skor: tiada KPI merah = hijau/kuning; ada merah = kuning (≤1) atau merah
      const lvl = !miss.length ? (ratio >= 0.75 ? 'good' : 'warn') : miss.length <= 1 ? 'warn' : 'bad';
      return { x, hit, total, ratio, lvl, miss, list };
    }).sort((a, b) => b.ratio - a.ratio);

    let h = `<h2>Skor outlet <span class="note">· KPI capai daripada jumlah</span></h2><div class="ostrip">${cards.map(c => `
      <a class="otile" href="#o-${c.x}"><span class="on">${CFG.outletNames[c.x]}</span>
        <span class="os ${c.lvl}">${c.hit}<span class="of">/${c.total}</span></span>
        <span class="ob"><i class="${c.lvl}" style="width:${(c.ratio * 100).toFixed(0)}%"></i></span>
        <span class="om">${c.miss.length ? `${c.miss.length} merah` : 'tiada merah'}</span></a>`).join('')}</div>`;
    h += `<div class="legend one"><span><span class="st good">✓</span> ${live ? 'On track' : 'Capai'}</span><span><span class="st warn">!</span> 80–99%</span><span><span class="st warn">↗</span> Naik</span><span><span class="st bad">✕</span> Belum</span></div>`;
    h += cards.map((c, i) => `<details class="card outlet" id="o-${c.x}" ${i === cards.length - 1 ? 'open' : ''}>
      <summary><span class="row"><b class="oname">${CFG.outletNames[c.x]}</b><span class="score ${c.lvl}">${c.hit}/${c.total} capai</span></span>
      ${c.miss.length ? `<span class="sub">Merah: ${c.miss.join(', ')}</span>` : ''}</summary>
      <ul class="olist">${c.list}</ul></details>`).join('');
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
    }), { aria: opts.aria, target: opts.target });
    let h = `<h2>TikTok views bulanan <span class="note">· garis putus = target 4M</span></h2><div class="card">${mk('tt_views', { target: T.tiktokViews, aria: 'Views TikTok bulanan' })}</div>`;
    h += `<h2>Net followers TikTok</h2><div class="card">${mk('tt_netGrowth', { aria: 'Net followers bulanan' })}<div class="chart-cap">Biru = bertambah, oren = berkurang. Had bawah ${fmt(T.netFollowersFloor)}.</div></div>`;
    h += `<h2>Facebook views</h2><div class="card">${mk('fb_views', { aria: 'Views Facebook bulanan' })}<div class="chart-cap">Bar pudar = data harian tak lengkap. Tiada bar = tiada data.</div></div>`;
    h += `<h2>Instagram views</h2><div class="card">${mk('ig_views', { aria: 'Views Instagram bulanan' })}</div>`;
    const tot = series.map(r => ({ ...r, lead_all: CFG.outlets.reduce((a, x) => a + (r['lead_' + x] || 0), 0) || null, walk_all: CFG.outlets.reduce((a, x) => a + (r['walk_' + x] || 0), 0) || null }));
    const mk2 = f => barChart(tot.map(r => ({ label: MON[+r.key.slice(5) - 1], value: r[f], hl: r.key === key, tip: `${monLabel(r.key)}: ${fmt(r[f])}` })));
    h += `<h2>Leads (4 outlet)</h2><div class="card">${mk2('lead_all')}</div>`;
    h += `<h2>Walk-in (4 outlet)</h2><div class="card">${mk2('walk_all')}</div>`;
    h += `<h2>Jadual</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Bulan</th><th>TT Views</th><th>Net Fol.</th><th>FB</th><th>IG</th><th>Leads</th><th>Walk-in</th></tr></thead><tbody>`;
    for (const r of [...tot].reverse())
      h += `<tr><td>${monLabel(r.key)}</td><td>${fmt(r.tt_views)}</td><td>${fmt(r.tt_netGrowth)}</td><td>${fmt(r.fb_views)}</td><td>${fmt(r.ig_views)}</td><td>${fmt(r.lead_all)}</td><td>${fmt(r.walk_all)}</td></tr>`;
    h += `</tbody></table></div></div>`;
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
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (!state.ds) return;
    const key = state.month, view = $('#view');
    let html;
    try {
      if (state.tab === 'content') {
        if (!state.ds.posts[key]) view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Memuatkan post ${monLabel(key)}…</p></div>`;
        html = await viewContent(key);
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.ds && Date.now() - new Date(state.ds.loadedAt) > 10 * 60 * 1000) { state.ds.posts = {}; load(); }
  });

  // ---------- boot ----------
  try { const c = localGet(CACHE_KEY); if (c) { state.ds = JSON.parse(c); fillMonths(); render(); } } catch { /* cache rosak */ }
  load();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
