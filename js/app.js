// KLIKI Marketing Dashboard — UI
(function () {
  const CFG = window.KLIKI_CONFIG, KD = window.KD, T = CFG.targets;
  const $ = s => document.querySelector(s);
  const MON = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const CACHE_KEY = 'kliki-dash-v1';

  const state = { ds: null, month: null, picked: false, tab: localGet('tab') || 'ringkasan', loading: false };

  // ---------- helpers ----------
  function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* penuh / disekat */ } }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const full = n => n == null ? '—' : Math.round(n).toLocaleString('en-MY');
  function short(n) {
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return full(n);
  }
  const daysIn = (y, m) => KD.daysIn(y, m);
  const pct = (n, d = 0) => n == null ? '—' : n.toFixed(d) + '%';
  const monLabel = key => { const [y, m] = key.split('-'); return `${MON[+m - 1]} ${y}`; };
  const parseKey = key => key.split('-').map(Number);
  function prevKey(key) { let [y, m] = parseKey(key); m--; if (!m) { m = 12; y--; } return KD.ym(y, m); }
  function isCurrent(key) { const n = new Date(); return key === KD.ym(n.getFullYear(), n.getMonth() + 1); }

  const LBL = {
    done: { good: 'Capai', warn: 'Hampir', bad: 'Belum', na: 'Tiada data' },
    live: { good: 'On track', warn: 'Perlahan', bad: 'Ketinggalan', na: 'Tiada data' },
  };
  const ICON = { good: '✓', warn: '!', bad: '✕', na: '–' };
  function pill(st, live) { const l = (live ? LBL.live : LBL.done)[st.level]; return `<span class="pill ${st.level}">${ICON[st.level]} ${l}</span>`; }
  function prog(actual, target, st, pace) {
    const w = target ? Math.min(100, 100 * (actual || 0) / target) : 0;
    const pm = pace < 1 ? `<span class="pace" style="left:${(pace * 100).toFixed(1)}%" title="Sasaran setakat hari ini"></span>` : '';
    return `<div class="prog ${st.level}" role="progressbar" aria-valuenow="${Math.round(w)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${w}%"></i>${pm}</div>`;
  }

  function kpi(label, actual, target, pace, opts = {}) {
    const st = KD.status(actual, target, pace, opts.floor);
    const live = pace < 1;
    const tgt = opts.floor ? `Had bawah ${full(target)}` : `Target ${short(target)}${st.pct != null ? ` · ${pct(st.pct)}` : ''}`;
    return `<div class="card kpi">
      <div class="label">${esc(label)}</div>
      <div class="value">${opts.fmt ? opts.fmt(actual) : short(actual)}</div>
      <div class="row tgt-row"><span class="tgt">${tgt}</span>${pill(st, live)}</div>
      ${opts.floor ? '' : prog(actual, target, st, pace)}
    </div>`;
  }

  // ---------- chart (SVG, satu siri) ----------
  function barChart(data, opts = {}) {
    // data: [{label, value, tip}]
    const W = 340, H = opts.h || 150, pl = 44, pr = 6, pt = 10, pb = 20;
    const vals = data.map(d => d.value || 0);
    let max = Math.max(...vals, opts.target || 0, 0), min = Math.min(...vals, 0);
    if (max === min) max = min + 1;
    const y = v => pt + (H - pt - pb) * (max - v) / (max - min);
    const bw = (W - pl - pr) / data.length;
    const gap = Math.min(4, bw * 0.25);
    const ticks = [min, (max + min) / 2, max].filter((v, i, a) => a.indexOf(v) === i);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || '')}">`;
    for (const t of ticks) s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 4}" y="${y(t) + 3}" text-anchor="end">${short(t)}</text>`;
    if (min < 0) s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--text-2)"/>`;
    data.forEach((d, i) => {
      if (d.value == null) { s += `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-tip="${esc(d.tip || d.label)}"/>`; if (!opts.labelEvery || i % opts.labelEvery === 0) s += `<text x="${pl + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(d.label)}</text>`; return; }
      const v = d.value || 0, x = pl + i * bw + gap / 2, w = Math.max(1, bw - gap);
      const y0 = y(Math.max(0, v)), h = Math.max(v === 0 ? 0 : 1.5, Math.abs(y(v) - y(0)));
      const r = Math.min(4, w / 2, h);
      const cls = 'b' + (v < 0 ? ' neg' : '') + (d.dim ? ' dim' : '');
      // hujung data bulat, tapak rata
      if (h > 0) {
        s += v >= 0
          ? `<path class="${cls}" d="M${x},${y0 + h}V${y0 + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y0 + h}z"/>`
          : `<path class="${cls}" d="M${x},${y(0)}V${y(0) + h - r}q0,${r} ${r},${r}h${w - 2 * r}q${r},0 ${r},-${r}V${y(0)}z"/>`;
      }
      if (opts.labelEvery ? i % opts.labelEvery === 0 || i === data.length - 1 : true)
        s += `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle">${esc(d.label)}</text>`;
      s += `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-tip="${esc(d.tip || `${d.label}: ${full(v)}`)}"/>`;
    });
    if (opts.target) s += `<line class="tline" x1="${pl}" x2="${W - pr}" y1="${y(opts.target)}" y2="${y(opts.target)}"/>`;
    return s + '</svg>';
  }

  // tooltip sentuh / hover
  const tip = $('#tip');
  function showTip(e) {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    const r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip; tip.hidden = false;
    const x = Math.min(Math.max(r.left + r.width / 2, 70), innerWidth - 70);
    tip.style.left = x + 'px'; tip.style.top = r.top + 'px';
  }
  document.addEventListener('pointerover', showTip);
  document.addEventListener('pointerdown', showTip);
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ---------- views ----------
  function viewRingkasan(key) {
    const [y, m] = parseKey(key);
    const s = KD.social(state.ds, y, m), ps = KD.social(state.ds, ...parseKey(prevKey(key)));
    const tt = s.tiktok;
    if (!tt.days) return `<div class="empty">Tiada data TikTok Insight untuk ${monLabel(key)} lagi.</div>`;
    const pace = isCurrent(key) || tt.days < s.daysInMonth ? tt.days / s.daysInMonth : 1;
    const st = KD.status(tt.views, T.tiktokViews, pace);
    const proj = pace < 1 ? tt.views / pace : null;

    let h = `<div class="card hero">
      <div class="row"><span class="label">TikTok Views (akaun)</span>${pill(st, pace < 1)}</div>
      <div class="value">${full(tt.views)}</div>
      <div class="sub">Target ${short(T.tiktokViews)} · ${pct(st.pct, 1)}${proj ? ` · unjuran ${short(proj)}` : ''} · ${tt.days}/${s.daysInMonth} hari data</div>
      ${prog(tt.views, T.tiktokViews, st, pace)}
      ${barChart(tt.daily.map(d => ({ label: d.d, value: d.views, tip: `${d.d} ${MON[m - 1]}: ${full(d.views)} views` })), { aria: 'Views TikTok harian', labelEvery: 5, h: 130 })}
      <div class="chart-cap">Views harian · ketik bar untuk nilai</div>
    </div>`;

    h += `<h2>TikTok engagement</h2><div class="grid">
      ${kpi('Likes', tt.likes, T.likes, pace)}
      ${kpi('Comments', tt.comments, T.comments, pace)}
      ${kpi('Shares', tt.shares, T.shares, pace)}
      ${kpi('Profile Views', tt.profileViews, T.profileViews, pace)}
      ${kpi('New Followers', tt.newFollowers, T.newFollowers, pace)}
      ${kpi('Net Followers', tt.netGrowth, T.netFollowersFloor, pace, { floor: true, fmt: v => (v > 0 ? '+' : '') + full(v) })}
    </div>`;

    const lt = KD.outletStats(state.ds, y, m).linktree;
    h += `<h2>Traffic Linktree</h2>`;
    if (lt) {
      h += `<div class="grid">
        ${kpi('Unique Linktree', lt.uniqueClicks, T.uniqueLinktree, 1)}
        ${kpi('CTR Profile → Linktree', lt.ctrProfile, T.ctrProfile, 1, { fmt: v => pct(v, 1) })}
        ${kpi('CTR Action Linktree', lt.ctrAction, T.ctrAction, 1, { fmt: v => pct(v, 1) })}
        ${kpi('Klik Telegram', lt.telegram, T.telegram, 1)}
      </div>`;
    } else h += `<div class="card empty">Tiada data LINKTREE untuk bulan ini.</div>`;

    h += `<h2>Facebook & Instagram <span class="note">· banding ${monLabel(prevKey(key))}</span></h2>`;
    const meta = (name, cur, prev) => {
      if (!cur.days) return `<div class="card"><b>${name}</b><div class="empty">Tiada data bulan ini.</div></div>`;
      const row = (l, k) => {
        const d = prev.days && prev[k] ? 100 * (cur[k] - prev[k]) / prev[k] : null;
        return `<tr><td>${l}</td><td><b>${full(cur[k])}</b></td><td class="delta">${d == null ? '—' : (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(0) + '%'}</td></tr>`;
      };
      return `<div class="card"><div class="row"><b>${name}</b><span class="pill na">${cur.days} hari data</span></div>
        <table><tbody>${row('Views', 'views')}${row('Reach', 'reach')}${row('Interactions', 'interactions')}${row('Visit', 'visit')}${row('Follow baru', 'follow')}</tbody></table></div>`;
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
    const n = new Date();
    const pace = isCurrent(key) ? n.getDate() / KD.daysIn(y, m) : 1;
    let h = res.warning ? `<div class="warn-box">⚠ ${esc(res.warning)}</div>` : '';

    h += `<div class="grid" style="margin-top:10px">
      ${kpi('Total Content', c.total, T.totalContent, pace)}
      ${kpi('Views per Post (jumlah)', c.views, T.viewsPerPost, pace)}
    </div>`;
    if (c.hasType) {
      h += `<div class="grid" style="margin-top:10px">${kpi('POV Customer', c.pov, T.povCustomer, pace)}${kpi('Strategic', c.strategic, T.strategic, pace)}</div>`;
      const mix = (title, counts, tg) => `<div class="card"><b>${title}</b><table><thead><tr><th></th><th>Post</th><th>Target</th><th></th></tr></thead><tbody>${Object.keys(tg).map(k => {
        const st = KD.status(counts[k], tg[k], pace);
        return `<tr><td>${esc(k)}</td><td><b>${counts[k]}</b></td><td>${tg[k]}</td><td><span class="dot ${st.level}" aria-label="${LBL.done[st.level]}"></span></td></tr>`;
      }).join('')}</tbody></table></div>`;
      h += `<h2>Strategic mix</h2>` + mix('Jenis', c.typeCount, T.strategicType) + mix('Subjek', c.subjCount, T.strategicSubject);
    } else {
      h += `<div class="chart-cap" style="margin-top:8px">Lajur TYPE (POV Customer / Strategic) bermula dari tab SEPT'26.</div>`;
    }

    h += `<h2>Views ikut bucket <span class="note">· bebas, tak dijumlahkan</span></h2><div class="card"><div class="list">`;
    for (const [k, b] of Object.entries(c.bucketStats)) {
      const st = KD.status(b.views, b.target, pace);
      h += `<div class="li"><div class="top-row"><span class="name">${esc(k)} ${pill(st, pace < 1)}</span>
        <span class="nums"><b>${short(b.views)}</b> / ${short(b.target)} · ${b.posts} post</span></div>${prog(b.views, b.target, st, pace)}</div>`;
    }
    h += `</div></div>`;

    const order = ['KUL', 'AOR', 'SP', 'PDG', 'HQ', 'REPOST'];
    const outs = Object.keys(c.outlets).sort((a, b) => (order.indexOf(a) + 99 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 99 * (order.indexOf(b) < 0)));
    h += `<h2>Ikut outlet</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Outlet</th><th>Post</th><th>Views</th><th>Purata</th><th>Gold+</th></tr></thead><tbody>`;
    for (const o of outs) {
      const v = c.outlets[o], gold = (v.tiers.Gold || 0) + (v.tiers.Diamond || 0);
      h += `<tr><td>${esc(CFG.outletNames[o] || o)}</td><td>${v.posts}</td><td><b>${short(v.views)}</b></td><td>${short(v.views / v.posts)}</td><td>${gold}${v.tiers.Diamond ? ' 💎' : ''}</td></tr>`;
    }
    h += `</tbody></table></div>
      <div class="chart-cap">Diamond ≥ 1M · Gold ≥ 300K · Silver ≥ 100K. Jumlah: ${Object.entries(c.tiers).map(([k, v]) => `${k} ${v}`).join(' · ')}</div></div>`;

    h += `<h2>Ikut kategori</h2><div class="card"><table><thead><tr><th>Kategori</th><th>Post</th><th>Views</th><th>Purata</th></tr></thead><tbody>`;
    for (const [k, v] of Object.entries(c.kategori).sort((a, b) => b[1].views - a[1].views))
      h += `<tr><td>${esc(k)}</td><td>${v.posts}</td><td><b>${short(v.views)}</b></td><td>${short(v.views / v.posts)}</td></tr>`;
    h += `</tbody></table></div>`;

    h += `<h2>Top 5 post</h2><div class="card">`;
    for (const p of c.top) {
      const d = p.date ? `${p.date.d}/${p.date.m}` : '';
      h += `<div class="top-post"><span class="meta">${esc(d)} · ${esc(CFG.outletNames[p.outlet] || p.outlet)} · ${esc(p.kategori)}${p.sub ? ' · ' + esc(p.sub) : ''}${p.type ? ' · ' + esc(p.type) : ''}</span><span class="v">${short(p.views)}</span></div>`;
    }
    h += `</div><div class="chart-cap">Sumber: REPORT CONTENT DATA, tab ${esc(res.tab && res.tab.startsWith('gid') ? monLabel(key) : res.tab)}. Purata views/post bulan ini: ${short(c.avg)}.</div>`;
    return h;
  }

  function viewOutlet(key) {
    const [y, m] = parseKey(key);
    const o = KD.outletStats(state.ds, y, m);
    const live = isCurrent(key);
    const pace = live ? Math.max(o.days.leads, 1) / KD.daysIn(y, m) : 1;
    const rows = [
      ['RAW Video Phone', 'rawPhone'], ['RAW Video Repair', 'rawRepair'],
      ['Gambar Customer', 'customer'], ['Before / After', 'beforeAfter'],
      ['Leads', 'leads'], ['Walk-in', 'walkin'], ['Conversion', 'conversion'],
      ['Klik WhatsApp', 'wa'], ['Klik Lokasi', 'location'],
    ];
    let h = `<div class="card" style="margin-top:10px"><div class="tbl-wrap"><table><thead><tr><th>KPI</th>${CFG.outlets.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>`;
    for (const [label, k] of rows) {
      h += `<tr><td>${label}</td>`;
      for (const x of CFG.outlets) {
        const a = o.outlets[x][k];
        const tg = k === 'conversion' ? T.conversion : T.outlet[x][k];
        if (tg == null && (a == null || a === 0)) { h += `<td class="cell"><span class="sub">N/A</span></td>`; continue; }
        const st = k === 'conversion' ? KD.status(a, tg, 1) : KD.status(a, tg, pace);
        const val = k === 'conversion' ? pct(a) : full(a);
        h += `<td class="cell" data-tip="${esc(`${CFG.outletNames[x]} · ${label}: ${val} / target ${k === 'conversion' ? tg + '%' : full(tg)}`)}"><b>${val}</b><span class="dot ${st.level}"></span><span class="sub">/ ${k === 'conversion' ? tg + '%' : short(tg)}</span></td>`;
      }
      h += `</tr>`;
    }
    h += `</tbody></table></div>
      <div class="legend"><span><i style="background:var(--good)"></i>${live ? 'On track' : 'Capai'}</span><span><i style="background:var(--warn)"></i>80–99%</span><span><i style="background:var(--bad)"></i>&lt; 80%</span></div>
      <div class="chart-cap">Conversion = Walk-in ÷ Leads. ${live ? `Bulan semasa: status dinilai ikut kadar (${o.days.leads} hari data leads).` : ''} Klik WhatsApp/Lokasi dari tab LINKTREE (${CFG.linktree.year} sahaja).</div></div>`;

    const tl = CFG.outlets.reduce((a, x) => a + o.outlets[x].leads, 0);
    const tw = CFG.outlets.reduce((a, x) => a + o.outlets[x].walkin, 0);
    const tgL = CFG.outlets.reduce((a, x) => a + T.outlet[x].leads, 0);
    const tgW = CFG.outlets.reduce((a, x) => a + T.outlet[x].walkin, 0);
    h += `<h2>Jumlah semua outlet</h2><div class="grid">
      ${kpi('Leads', tl, tgL, pace)}
      ${kpi('Walk-in', tw, tgW, pace)}
      ${kpi('Conversion', tl ? 100 * tw / tl : null, T.conversion, 1, { fmt: v => pct(v, 1) })}
      ${o.linktree ? kpi('Klik WhatsApp (4 outlet)', CFG.outlets.reduce((a, x) => a + (o.outlets[x].wa || 0), 0), CFG.outlets.reduce((a, x) => a + T.outlet[x].wa, 0), 1) : ''}
    </div>`;
    return h;
  }

  function viewTrend(key) {
    const series = KD.monthlySeries(state.ds).filter(r => r.key <= key).slice(-12);
    // bar pudar = data harian tak lengkap (< 90% hari dalam bulan); tiada bar = tiada data
    const mk = (field, opts = {}) => barChart(series.map(r => {
      const [yy, mm] = parseKey(r.key), dim = daysIn(yy, mm);
      const days = r[field.split('_')[0] + '_days'] || 0;
      const partial = days > 0 && days < dim * 0.9;
      return {
        label: MON[mm - 1], value: r[field] ?? null, dim: partial,
        tip: r[field] == null ? `${monLabel(r.key)}: tiada data` : `${monLabel(r.key)}: ${full(r[field])}${partial ? ` (${days}/${dim} hari)` : ''}`,
      };
    }), { aria: opts.aria, target: opts.target });
    let h = `<h2>TikTok views bulanan <span class="note">· garis putus = target 4M</span></h2><div class="card">${mk('tt_views', { target: T.tiktokViews, aria: 'Views TikTok bulanan' })}</div>`;
    h += `<h2>Net followers TikTok</h2><div class="card">${mk('tt_netGrowth', { aria: 'Net followers bulanan' })}<div class="chart-cap">Biru = bertambah, oren = berkurang. Had bawah: ${full(T.netFollowersFloor)}.</div></div>`;
    h += `<h2>Facebook views</h2><div class="card">${mk('fb_views', { aria: 'Views Facebook bulanan' })}<div class="chart-cap">Bar pudar = data harian tak lengkap bulan itu. Ketik untuk bilangan hari.</div></div>`;
    h += `<h2>Instagram views</h2><div class="card">${mk('ig_views', { aria: 'Views Instagram bulanan' })}<div class="chart-cap">Bar pudar = data harian tak lengkap. Tiada bar = tiada data.</div></div>`;
    const withTotals = series.map(r => ({ ...r, lead_all: CFG.outlets.reduce((a, x) => a + (r['lead_' + x] || 0), 0), walk_all: CFG.outlets.reduce((a, x) => a + (r['walk_' + x] || 0), 0) }));
    const mk2 = f => barChart(withTotals.map(r => ({ label: MON[+r.key.slice(5) - 1].slice(0, 3), value: r[f], tip: `${monLabel(r.key)}: ${full(r[f])}` })));
    h += `<h2>Leads (semua outlet)</h2><div class="card">${mk2('lead_all')}</div>`;
    h += `<h2>Walk-in (semua outlet)</h2><div class="card">${mk2('walk_all')}</div>`;

    h += `<h2>Jadual</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Bulan</th><th>TT Views</th><th>Net Fol.</th><th>FB</th><th>IG</th><th>Leads</th><th>Walk-in</th></tr></thead><tbody>`;
    for (const r of [...withTotals].reverse())
      h += `<tr><td>${monLabel(r.key)}</td><td>${short(r.tt_views)}</td><td>${full(r.tt_netGrowth)}</td><td>${short(r.fb_views)}</td><td>${short(r.ig_views)}</td><td>${full(r.lead_all)}</td><td>${full(r.walk_all)}</td></tr>`;
    h += `</tbody></table></div></div>`;
    return h;
  }

  function healthBlock() {
    const ds = state.ds; if (!ds) return '';
    const names = { tiktok: 'TikTok Insight', facebook: 'Facebook Insight', instagram: 'Instagram Insight', supply: 'Supply Video V2', beforeAfter: 'Before/After', customer: 'Customer', leads: 'Leads', walkin: 'Walk-in', linktree: 'LINKTREE' };
    const li = Object.entries(names).map(([k, n]) => {
      const s = ds.sources[k]; if (!s) return '';
      return `<li><span class="${s.ok ? 'ok' : 'no'}">${s.ok ? '●' : '✕'}</span> ${n}: ${s.ok ? s.rows + ' baris' : esc(s.error)}</li>`;
    }).join('');
    return `<h2>Status data</h2><div class="card"><details><summary>Sumber & kemas kini</summary><ul class="health">${li}</ul>
      <div class="health">Dimuat: ${new Date(ds.loadedAt).toLocaleString('ms-MY')}. Data dibaca terus dari Google Sheet setiap kali buka / tekan muat semula.</div></details></div>`;
  }

  // ---------- render ----------
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (!state.ds) return;
    const key = state.month;
    const view = $('#view');
    let html;
    try {
      if (state.tab === 'content') {
        if (!state.ds.posts[key]) view.innerHTML = `<div class="loading"><div class="spinner"></div><p>Memuatkan post ${monLabel(key)}…</p></div>`;
        html = await viewContent(key);
      } else if (state.tab === 'outlet') html = viewOutlet(key);
      else if (state.tab === 'trend') html = viewTrend(key);
      else html = viewRingkasan(key);
    } catch (e) {
      console.error(e);
      html = `<div class="card empty">Ralat paparan: ${esc(e.message)}</div>`;
    }
    if (seq !== renderSeq) return;
    view.innerHTML = html + healthBlock();
  }

  function fillMonths() {
    const months = KD.monthsAvailable(state.ds).filter(k => k >= '2025-01');
    const now = new Date(), cur = KD.ym(now.getFullYear(), now.getMonth() + 1);
    if (!months.includes(cur)) months.push(cur);
    const sel = $('#month');
    sel.innerHTML = months.slice().reverse().map(k => `<option value="${k}">${monLabel(k)}</option>`).join('');
    if (!state.picked || !months.includes(state.month)) {
      // lalai: bulan terkini yang ada data TikTok
      const withData = KD.monthsAvailable(state.ds);
      state.month = withData[withData.length - 1] || cur;
    }
    sel.value = state.month;
  }

  function persist() {
    if (!state.ds) return;
    localSet(CACHE_KEY, JSON.stringify(state.ds));
  }

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
      line.textContent = `Dikemas kini ${new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}` + (failed.length ? ` · ${failed.length} sumber gagal` : '');
      if (failed.length) line.className = 'status-line err';
      await render();
    } catch (e) {
      line.className = 'status-line err';
      line.textContent = state.ds ? `Offline · papar data simpanan ${new Date(state.ds.loadedAt).toLocaleString('ms-MY')}` : `Gagal muat data: ${e.message}`;
      if (!state.ds) $('#view').innerHTML = `<div class="card empty">Tak dapat capai Google Sheet. Semak internet, atau pastikan sheet dikongsi "Anyone with the link".</div>`;
    } finally {
      state.loading = false; btn.classList.remove('spin');
    }
  }

  // ---------- events ----------
  $('#month').addEventListener('change', e => { state.month = e.target.value; state.picked = true; render(); scrollTo(0, 0); });
  $('#refresh').addEventListener('click', () => { if (state.ds) state.ds.posts = {}; load(); });
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; localSet('tab', state.tab); render(); scrollTo(0, 0);
  }));
  document.addEventListener('visibilitychange', () => {
    // auto refresh bila app dibuka semula selepas > 10 minit
    if (document.visibilityState === 'visible' && state.ds && Date.now() - new Date(state.ds.loadedAt) > 10 * 60 * 1000) { state.ds.posts = {}; load(); }
  });

  // ---------- boot ----------
  try {
    const cached = localGet(CACHE_KEY);
    if (cached) { state.ds = JSON.parse(cached); fillMonths(); render(); }
  } catch { /* cache rosak, abaikan */ }
  load();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
