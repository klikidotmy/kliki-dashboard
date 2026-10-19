// KLIKI Marketing Dashboard — lapisan data (fetch + parse + kira KPI)
// Semua formula KPI ada di sini. UI hanya paparkan hasil.
(function (root) {
  const CFG = root.KLIKI_CONFIG || (typeof require !== 'undefined' ? require('./config.js') : null);

  // ---------- util ----------
  function parseCSV(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function num(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).replace(/[,\s%RM]/g, '');
    if (s === '' || s === '-' || /#/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return mk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return mk(y, +m[2], +m[1]); }
    return null;
    function mk(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
      return { y, m: mo, d };
    }
  }

  const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  // ---------- fetch ----------
  // Tab dengan gid: guna endpoint export (baca SEMUA baris, termasuk baris dalam row group yang di-collapse).
  // gviz hanya untuk tab yang dicari ikut nama (bulan baru tanpa gid) — gviz langkau baris tersorok.
  function gvizUrl(sheetId, { gid, sheet, range }) {
    if (gid !== undefined && !sheet) {
      const e = new URLSearchParams({ format: 'csv', gid });
      if (range) e.set('range', range);
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?${e}`;
    }
    const p = new URLSearchParams({ tqx: 'out:csv', headers: '0' });
    if (gid !== undefined) p.set('gid', gid);
    if (sheet) p.set('sheet', sheet);
    if (range) p.set('range', range);
    p.set('_', Date.now()); // elak cache
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${p}`;
  }

  async function fetchRows(sheetId, opts) {
    const res = await fetch(gvizUrl(sheetId, opts), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t = await res.text();
    if (/^\s*</.test(t)) throw new Error('Sheet tak boleh dibaca (bukan CSV). Semak share "Anyone with the link".');
    return parseCSV(t);
  }

  // ---------- parsers ----------
  // Tab harian: kolum pertama tarikh, kolum lain nombor ikut senarai kunci
  function parseDaily(rows, keys) {
    const out = [];
    for (const r of rows) {
      const d = parseDate(r[0]); if (!d) continue;
      const o = { date: d };
      let any = false;
      keys.forEach((k, i) => { const n = num(r[i + 1]); o[k] = n; if (n !== null) any = true; });
      if (any) out.push(o);
    }
    return out;
  }

  const KEYS = {
    tiktok: ['views', 'reach', 'profileViews', 'likes', 'shares', 'comments', 'websiteClicks', 'phoneClicks', 'leads', 'appDownload', 'netGrowth', 'newFollowers', 'lostFollowers'],
    meta: ['views', 'reach', 'visit', 'linkClick', 'interactions', 'follow'],
    supply: ['KUL_P', 'KUL_R', 'AOR_P', 'AOR_R', 'SP_P', 'SP_R', 'PDG_P', 'PDG_R', 'HQ_P', 'HQ_T', 'HQ_R', 'Others'],
    beforeAfter: ['KUL', 'AOR', 'SP'],
    outlet4: ['KUL', 'AOR', 'SP', 'PDG'],
  };

  // Tab per-post: TARIKH, OUTLET, KATEGORI, [TYPE], SUB KATEGORI, VIEW, [TIER]
  // Susun atur berbeza ikut bulan, jadi dikesan per baris: kolum nombor pertama selepas KATEGORI = view.
  function parsePosts(rows) {
    const posts = [];
    for (const r of rows) {
      const date = parseDate(r[0]);
      const outlet = (r[1] || '').trim().toUpperCase();
      const kategori = normKategori(r[2]);
      if (!/^[A-Z]{2,6}$/.test(outlet) || !/^[A-Za-z]/.test(kategori) || /^(OUTLET|POST|VIEW|TOTAL)/.test(outlet)) continue;
      let vi = -1;
      for (let i = 3; i <= 5; i++) { if (num(r[i]) !== null) { vi = i; break; } }
      if (vi < 0) continue;
      const views = num(r[vi]);
      const texts = r.slice(3, vi).map(s => (s || '').trim());
      const type = texts.length === 2 ? texts[0] : '';
      const sub = texts.length >= 1 ? texts[texts.length - 1] : '';
      const url = (r.slice(0, 10).find(c => /^https?:\/\//i.test((c || '').trim())) || '').trim();
      // Peringkat funnel hanya jika sheet ada lajur bernilai TOFU/MOFU/BOFU (tiada tekaan dari TYPE)
      const fc = r.slice(3, 12).find(c => /^\s*(TOFU|MOFU|BOFU)\s*$/i.test(c || ''));
      posts.push({ date, outlet, kategori, type, sub: normSub(sub), views, url, funnel: fc ? fc.trim().toUpperCase() : '' });
    }
    return posts;
  }
  function normKategori(v) {
    const s = (v || '').trim();
    if (/^trade/i.test(s)) return 'Trade-in';
    if (/^buy/i.test(s)) return 'Buyback';
    if (/^repair/i.test(s)) return 'Repair';
    if (/^phone/i.test(s)) return 'Phone';
    return s;
  }
  function normSub(v) {
    const s = (v || '').trim();
    if (/^iphone/i.test(s)) return 'iPhone';
    if (/^android/i.test(s)) return 'Android';
    return s;
  }

  // LINKTREE: baris dikenal ikut kod (05WKLM dsb), kolum bulan MAC..DEC
  const LT_CODES = {
    '05ULC': 'uniqueClicks', '05CTRLFP': 'ctrProfile', '05CTRAFL': 'ctrAction',
    '05WKLM': 'wa_KUL', '05WAOR': 'wa_AOR', '05WASP': 'wa_SP', '05WAPDG': 'wa_PDG', '05WAPOS': 'wa_Online', '05WABB': 'wa_Buyback',
    '05LKLM': 'loc_KUL', '05LAOR': 'loc_AOR', '05LSP': 'loc_SP', '05LPDG': 'loc_PDG', '05TG': 'telegram',
  };
  const MONTH_HDR = { JAN: 1, FEB: 2, MAC: 3, MAR: 3, APR: 4, MEI: 5, MAY: 5, JUN: 6, JUL: 7, OGOS: 8, OGS: 8, AUG: 8, SEPT: 9, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DIS: 12, DEC: 12 };
  function parseLinktree(rows) {
    // cari baris header bulan; jika gviz kosongkan header, guna kedudukan tetap (B=MAC ... K=DEC)
    let colOf = {};
    for (const r of rows.slice(0, 5)) {
      r.forEach((c, i) => { const k = (c || '').trim().toUpperCase(); if (MONTH_HDR[k] && i > 0) colOf[MONTH_HDR[k]] = i; });
      if (Object.keys(colOf).length >= 3) break;
    }
    if (Object.keys(colOf).length < 3) { colOf = {}; for (let m = 3; m <= 12; m++) colOf[m] = m - 2; }
    const out = {}; // out[month][key]
    let last = null;
    for (const r of rows) {
      const label = (r[0] || '').trim();
      const code = Object.keys(LT_CODES).find(c => label.toUpperCase().startsWith(c));
      let key = code ? LT_CODES[code] : (/canva/i.test(label) ? 'canva' : null);
      if (!key) {
        // baris pecahan "a/b" di bawah baris CTR
        if (last && last.startsWith('ctr') && label === '') {
          for (const [m, i] of Object.entries(colOf)) {
            const f = (r[i] || '').match(/^\s*([\d,]+)\s*\/\s*([\d,]+)\s*$/);
            if (f) { out[m] = out[m] || {}; if (out[m][last] == null) out[m][last] = 100 * num(f[1]) / num(f[2]); }
          }
        }
        last = null; continue;
      }
      for (const [m, i] of Object.entries(colOf)) {
        const n = num(r[i]);
        out[m] = out[m] || {};
        if (n !== null) out[m][key] = n;
      }
      last = key;
    }
    return out;
  }

  // ---------- load semua ----------
  async function loadAll(onProgress) {
    const S = CFG.sheets, T = CFG.tabs;
    const ds = { loadedAt: new Date().toISOString(), sources: {}, warnings: [], posts: {} };
    const tasks = [
      ['tiktok', S.contentSubmit, T.tiktok, r => parseDaily(r, KEYS.tiktok)],
      ['facebook', S.contentSubmit, T.facebook, r => parseDaily(r, KEYS.meta)],
      ['instagram', S.contentSubmit, T.instagram, r => parseDaily(r, KEYS.meta)],
      ['supply', S.contentSubmit, T.supply, r => parseDaily(r, KEYS.supply)],
      ['beforeAfter', S.contentSubmit, T.beforeAfter, r => parseDaily(r, KEYS.beforeAfter)],
      ['customer', S.contentSubmit, T.customer, r => parseDaily(r, KEYS.outlet4)],
      ['leads', S.contentSubmit, T.leads, r => parseDaily(r, KEYS.outlet4)],
      ['walkin', S.contentSubmit, T.walkin, r => parseDaily(r, KEYS.outlet4)],
      ['linktree', S.reportContent, CFG.linktree, parseLinktree],
    ];
    let done = 0;
    await Promise.all(tasks.map(async ([name, id, opts, fn]) => {
      try {
        const rows = await fetchRows(id, opts);
        ds[name] = fn(rows);
        ds.sources[name] = { ok: true, rows: Array.isArray(ds[name]) ? ds[name].length : Object.keys(ds[name]).length };
      } catch (e) {
        ds[name] = Array.isArray(ds[name]) ? [] : (name === 'linktree' ? {} : []);
        ds.sources[name] = { ok: false, error: e.message };
      }
      onProgress && onProgress(++done, tasks.length);
    }));
    return ds;
  }

  // Tab per-post dimuat ikut bulan (bila diminta)
  async function loadMonthPosts(ds, y, m) {
    const key = ym(y, m);
    if (ds.posts[key]) return ds.posts[key];
    const gid = CFG.monthTabs[key];
    const yy = String(y).slice(2);
    const candidates = gid !== undefined
      ? [{ gid }]
      : CFG.monthTabNames[m].map(n => ({ sheet: `${n}'${yy}` }));
    let result = { posts: [], tab: null, error: 'Tab bulan ini tak dijumpai' };
    for (const c of candidates) {
      try {
        const rows = await fetchRows(CFG.sheets.reportContent, { ...c, range: 'A1:J300' });
        const posts = parsePosts(rows);
        const dated = posts.filter(p => p.date);
        const match = dated.filter(p => p.date.y === y && p.date.m === m).length;
        // gviz pulangkan tab pertama jika nama tak wujud — sahkan ikut tarikh
        if (c.sheet && dated.length && match / dated.length < 0.5) continue;
        result = { posts, tab: c.sheet || `gid ${c.gid}`, error: null };
        if (dated.length && match / dated.length < 0.8) {
          result.warning = `${dated.length - match} daripada ${dated.length} post dalam tab ini bertarikh di luar ${key}. Semak lajur TARIKH.`;
        }
        break;
      } catch (e) { result.error = e.message; }
    }
    ds.posts[key] = result;
    return result;
  }

  // ---------- kira KPI ----------
  const inMonth = (y, m) => r => r.date && r.date.y === y && r.date.m === m;

  function monthsAvailable(ds) {
    const set = new Set();
    for (const r of ds.tiktok || []) if (r.views != null) set.add(ym(r.date.y, r.date.m));
    return [...set].sort();
  }

  function social(ds, y, m) {
    const f = inMonth(y, m);
    const tt = (ds.tiktok || []).filter(f).filter(r => r.views != null);
    const fb = (ds.facebook || []).filter(f).filter(r => r.views != null);
    const ig = (ds.instagram || []).filter(f).filter(r => r.views != null);
    // Sel kosong = tiada data, bukan sifar: kunci yang langsung tiada nilai jadi null
    const agg = (rows, keys) => {
      const o = { daysOf: {} };
      for (const k of keys) {
        const has = rows.filter(r => r[k] != null);
        o[k] = has.length ? sum(has, r => r[k]) : null;
        o.daysOf[k] = has.length;
      }
      return o;
    };
    const tiktok = agg(tt, KEYS.tiktok);
    tiktok.days = tt.length;
    tiktok.daily = tt.map(r => ({ d: r.date.d, views: r.views, net: r.netGrowth }));
    const facebook = agg(fb, KEYS.meta); facebook.days = fb.length;
    const instagram = agg(ig, KEYS.meta); instagram.days = ig.length;
    return { tiktok, facebook, instagram, daysInMonth: daysIn(y, m) };
  }

  function contentStats(posts) {
    const T = CFG.targets;
    const total = posts.length;
    const views = sum(posts, p => p.views);
    const hasType = posts.some(p => p.type);
    const pov = posts.filter(p => /pov/i.test(p.type)).length;
    // Post tanpa TYPE tidak dikira sebagai Strategic (dilaporkan berasingan)
    const strategicPosts = hasType ? posts.filter(p => p.type && !/pov/i.test(p.type)) : [];
    const noType = hasType ? posts.filter(p => !p.type).length : 0;
    const typeCount = {};
    for (const k of Object.keys(T.strategicType)) typeCount[k] = strategicPosts.filter(p => p.type.toLowerCase() === k.toLowerCase()).length;
    const subjCount = {};
    for (const k of Object.keys(T.strategicSubject)) subjCount[k] = strategicPosts.filter(p => p.kategori === k).length;

    const buckets = {
      iPhone: posts.filter(p => p.sub === 'iPhone'),
      Android: posts.filter(p => p.sub === 'Android'),
      Repair: posts.filter(p => p.kategori === 'Repair'),
      'Trade-in / CC': posts.filter(p => p.kategori === 'Trade-in' || p.kategori === 'Buyback'),
    };
    const bucketStats = Object.fromEntries(Object.entries(buckets).map(([k, arr]) => [k, { posts: arr.length, views: sum(arr, p => p.views), target: T.buckets[k] }]));

    const outlets = {};
    for (const p of posts) {
      const o = outlets[p.outlet] || (outlets[p.outlet] = { posts: 0, views: 0, tiers: {} });
      o.posts++; o.views += p.views || 0;
      const t = tierOf(p.views); o.tiers[t] = (o.tiers[t] || 0) + 1;
    }
    const tiers = {};
    for (const p of posts) { const t = tierOf(p.views); tiers[t] = (tiers[t] || 0) + 1; }
    const kategori = {};
    for (const p of posts) { const k = kategori[p.kategori] || (kategori[p.kategori] = { posts: 0, views: 0 }); k.posts++; k.views += p.views || 0; }
    const group = keyFn => {
      const g = {};
      for (const p of posts) { const k = keyFn(p); if (!k) continue; const o = g[k] || (g[k] = { posts: 0, views: 0, top: null }); o.posts++; o.views += p.views || 0; if (!o.top || (p.views || 0) > (o.top.views || 0)) o.top = p; }
      return g;
    };
    const byType = hasType ? group(p => p.type) : {};
    const hasFunnel = posts.some(p => p.funnel);
    const byFunnel = hasFunnel ? group(p => p.funnel) : {};
    const top = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
    return { total, views, avg: total ? views / total : 0, hasType, pov, strategic: strategicPosts.length, noType, typeCount, subjCount, bucketStats, outlets, tiers, kategori, byType, hasFunnel, byFunnel, top };
  }

  function tierOf(v) { for (const t of CFG.tiers) if ((v || 0) >= t.min) return t.name; return 'Bronze'; }

  function outletStats(ds, y, m) {
    const f = inMonth(y, m);
    const S = k => (ds[k] || []).filter(f);
    const sup = S('supply'), cust = S('customer'), ba = S('beforeAfter'), lead = S('leads'), walk = S('walkin');
    const lt = (ds.linktree || {})[m] && y === CFG.linktree.year ? ds.linktree[m] : null;
    const res = {};
    for (const o of CFG.outlets) {
      const leads = sum(lead, r => r[o]);
      const walkin = sum(walk, r => r[o]);
      res[o] = {
        rawPhone: sum(sup, r => r[o + '_P']),
        rawRepair: sum(sup, r => r[o + '_R']),
        customer: sum(cust, r => r[o]),
        beforeAfter: o === 'PDG' ? null : sum(ba, r => r[o]),
        leads, walkin,
        conversion: leads ? 100 * walkin / leads : null,
        wa: lt ? lt['wa_' + o] ?? null : null,
        location: lt ? lt['loc_' + o] ?? null : null,
      };
    }
    const days = {
      leads: new Set(lead.filter(r => KEYS.outlet4.some(k => r[k] != null)).map(r => r.date.d)).size,
      walkin: new Set(walk.filter(r => KEYS.outlet4.some(k => r[k] != null)).map(r => r.date.d)).size,
    };
    return { outlets: res, linktree: lt, days };
  }

  // Siri bulanan untuk tab Trend
  function monthlySeries(ds) {
    const by = {};
    const add = (src, fields, prefix) => {
      for (const r of ds[src] || []) {
        const k = ym(r.date.y, r.date.m);
        const o = by[k] || (by[k] = {});
        let any = false;
        for (const f of fields) if (r[f] != null) { o[prefix + f] = (o[prefix + f] || 0) + r[f]; any = true; }
        if (any) o[prefix + 'days'] = (o[prefix + 'days'] || 0) + 1;
      }
    };
    add('tiktok', ['views', 'likes', 'shares', 'comments', 'profileViews', 'newFollowers', 'lostFollowers', 'netGrowth'], 'tt_');
    add('facebook', ['views', 'reach', 'interactions', 'follow'], 'fb_');
    add('instagram', ['views', 'reach', 'interactions', 'follow'], 'ig_');
    add('leads', KEYS.outlet4, 'lead_');
    add('walkin', KEYS.outlet4, 'walk_');
    return Object.keys(by).sort().map(k => ({ key: k, ...by[k] }));
  }

  // Status berbanding target. pace = pecahan bulan yang dah berlalu (1 untuk bulan penuh).
  // improving: true jika prestasi (dinormalkan ikut hari) lebih baik dari bulan lepas.
  // good = capai kadar; warn = bawah kadar tapi >= 80% ATAU sedang naik; bad = < 80% dan tak naik.
  function status(actual, target, pace = 1, floor = false, improving = null) {
    if (actual == null || target == null) return { level: 'na', pct: null, reason: null };
    if (floor) return { level: actual >= target ? 'good' : (improving ? 'warn' : 'bad'), pct: null, reason: actual >= target ? null : (improving ? 'up' : null) };
    const pct = target ? 100 * actual / target : null;
    const r = actual / (target * Math.max(pace, 0.0001));
    if (r >= 1) return { level: 'good', pct, reason: null };
    if (r >= 0.8) return { level: 'warn', pct, reason: 'near' };
    if (improving) return { level: 'warn', pct, reason: 'up' };
    return { level: 'bad', pct, reason: null };
  }

  function prevYM(y, m, k = 1) { const d = new Date(y, m - 1 - k, 1); return [d.getFullYear(), d.getMonth() + 1]; }
  const change = (a, b) => (a == null || b == null || b === 0) ? null : 100 * (a - b) / Math.abs(b);

  // Ringkasan satu bulan dalam bentuk nilai "sebulan penuh" (dinormalkan ikut hari data) untuk perbandingan
  function monthCore(ds, y, m) {
    const s = social(ds, y, m), o = outletStats(ds, y, m), dim = daysIn(y, m);
    const tt = s.tiktok, ttF = tt.days ? dim / tt.days : null;
    const sumO = k => CFG.outlets.reduce((a, x) => a + (o.outlets[x][k] || 0), 0);
    const leadDays = o.days.leads || 0, walkDays = o.days.walkin || 0;
    const lt = o.linktree;
    const v = {
      views: tt.days ? tt.views : null, likes: tt.days ? tt.likes : null, comments: tt.days ? tt.comments : null,
      shares: tt.days ? tt.shares : null, profileViews: tt.days ? tt.profileViews : null,
      newFollowers: tt.days ? tt.newFollowers : null, netGrowth: tt.days ? tt.netGrowth : null,
      uniqueClicks: lt ? lt.uniqueClicks ?? null : null, telegram: lt ? lt.telegram ?? null : null,
      ctrProfile: lt ? lt.ctrProfile ?? null : null, ctrAction: lt ? lt.ctrAction ?? null : null,
      // LINKTREE diisi sebulan sekali: jika tiada satu pun nilai WA outlet, kira 'tiada data' (bukan 0)
      wa: lt && CFG.outlets.some(x => lt['wa_' + x] != null) ? CFG.outlets.reduce((a, x) => a + (lt['wa_' + x] || 0), 0) : null,
      waOnline: lt ? lt.wa_Online ?? null : null, waBuyback: lt ? lt.wa_Buyback ?? null : null,
      leads: leadDays ? sumO('leads') : null, walkin: walkDays ? sumO('walkin') : null,
    };
    v.conversion = v.leads ? 100 * v.walkin / v.leads : null;
    // faktor normalisasi (nisbah & data Linktree bulanan tak dinormalkan)
    const f = {
      views: ttF, likes: ttF, comments: ttF, shares: ttF, profileViews: ttF, newFollowers: ttF, netGrowth: ttF,
      leads: leadDays ? dim / leadDays : null, walkin: walkDays ? dim / walkDays : null,
    };
    const norm = k => v[k] == null ? null : v[k] * (f[k] || 1);
    return { v, norm, pace: { tt: tt.days ? Math.min(1, tt.days / dim) : 1, out: leadDays ? Math.min(1, leadDays / dim) : 1 }, days: { tt: tt.days, leads: leadDays }, dim };
  }

  const KPI_DEFS = [
    { id: 'views', label: 'TikTok Views', target: T => T.tiktokViews, pace: 'tt' },
    { id: 'likes', label: 'Likes', target: T => T.likes, pace: 'tt' },
    { id: 'comments', label: 'Comments', target: T => T.comments, pace: 'tt' },
    { id: 'shares', label: 'Shares', target: T => T.shares, pace: 'tt' },
    { id: 'profileViews', label: 'Profile Views', target: T => T.profileViews, pace: 'tt' },
    { id: 'newFollowers', label: 'New Followers', target: T => T.newFollowers, pace: 'tt' },
    { id: 'netGrowth', label: 'Net Followers', target: T => T.netFollowersFloor, pace: 'tt', floor: true },
    { id: 'uniqueClicks', label: 'Unique Linktree', target: T => T.uniqueLinktree },
    { id: 'ctrProfile', label: 'CTR Profile → Linktree', target: T => T.ctrProfile, unit: '%' },
    { id: 'ctrAction', label: 'CTR Action Linktree', target: T => T.ctrAction, unit: '%' },
    { id: 'telegram', label: 'Klik Telegram', target: T => T.telegram },
    { id: 'wa', label: 'Klik WhatsApp (4 outlet)', target: T => CFG.outlets.reduce((a, x) => a + T.outlet[x].wa, 0) },
    { id: 'leads', label: 'Leads (4 outlet)', target: T => CFG.outlets.reduce((a, x) => a + T.outlet[x].leads, 0), pace: 'out' },
    { id: 'walkin', label: 'Walk-in (4 outlet)', target: T => CFG.outlets.reduce((a, x) => a + T.outlet[x].walkin, 0), pace: 'out' },
    { id: 'conversion', label: 'Conversion', target: T => T.conversion, unit: '%' },
  ];

  // Senarai KPI bulan ini lengkap dengan target, status, delta vs bulan lepas & tahun lepas
  function kpis(ds, y, m) {
    const cur = monthCore(ds, y, m), prev = monthCore(ds, ...prevYM(y, m)), ly = monthCore(ds, y - 1, m);
    const out = {};
    for (const d of KPI_DEFS) {
      const actual = cur.v[d.id];
      const pace = d.pace ? cur.pace[d.pace] : 1;
      const now = cur.norm(d.id), p = prev.norm(d.id), l = ly.norm(d.id);
      const mom = change(now, p), yoy = change(now, l);
      const improving = now != null && p != null ? now > p : null;
      const st = status(actual, d.target(CFG.targets), pace, d.floor, improving);
      const ratio = d.floor || actual == null ? null : actual / (d.target(CFG.targets) * Math.max(pace, 0.0001));
      out[d.id] = { ...d, target: d.target(CFG.targets), actual, pace, mom, yoy, prev: p, nowN: now, lyN: l, status: st, ratio, partial: pace < 1 };
    }
    return out;
  }

  // Funnel: Views → Profile → Linktree → WhatsApp → Leads → Walk-in
  const FUNNEL = [
    { id: 'views', label: 'TikTok Views' },
    { id: 'profileViews', label: 'Profile Views' },
    { id: 'uniqueClicks', label: 'Klik Linktree (unik)' },
    { id: 'wa', label: 'Klik WhatsApp outlet' },
    { id: 'leads', label: 'Leads' },
    { id: 'walkin', label: 'Walk-in' },
  ];
  const STEP_NOTE = {
    profileViews: 'buka profile',
    uniqueClicks: 'klik Linktree',
    wa: 'klik WhatsApp outlet',
    leads: 'jadi leads',
    walkin: 'datang ke kedai',
  };
  function funnel(ds, y, m) {
    const rates = (yy, mm) => {
      const c = monthCore(ds, yy, mm).v;
      return FUNNEL.map((st, i) => {
        if (!i) return null;
        const a = c[st.id], b = c[FUNNEL[i - 1].id];
        return a != null && b ? 100 * a / b : null;
      });
    };
    const cur = monthCore(ds, y, m).v;
    const r = rates(y, m), rp = rates(...prevYM(y, m));
    const hist = [1, 2, 3].map(k => rates(...prevYM(y, m, k)));
    const stages = FUNNEL.map((st, i) => {
      const h = hist.map(x => x[i]).filter(v => v != null);
      const avg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : null;
      return { ...st, value: cur[st.id], rate: r[i], prevRate: rp[i], avg3: avg, vsAvg: i && r[i] != null && avg ? 100 * (r[i] - avg) / avg : null, note: STEP_NOTE[st.id] };
    });
    // titik paling lemah = kadar yang paling jatuh berbanding purata 3 bulan sebelum
    const cands = stages.filter(s => s.vsAvg != null);
    const weakest = cands.length ? cands.reduce((a, b) => (b.vsAvg < a.vsAvg ? b : a)) : null;
    const strongest = cands.length ? cands.reduce((a, b) => (b.vsAvg > a.vsAvg ? b : a)) : null;
    return { stages, weakest: weakest && weakest.vsAvg < 0 ? weakest : null, strongest: strongest && strongest.vsAvg > 0 ? strongest : null };
  }

  // Bilangan bulan berturut-turut (berakhir bulan ini) yang memenuhi syarat
  function streak(ds, y, m, fn) {
    let n = 0, yy = y, mm = m;
    for (let i = 0; i < 24; i++) {
      const c = monthCore(ds, yy, mm);
      const pc = monthCore(ds, ...prevYM(yy, mm));
      if (!fn(c, pc)) break;
      n++; [yy, mm] = prevYM(yy, mm);
    }
    return n;
  }

  // 3 perkara bulan ini
  function insights(ds, y, m) {
    const K = kpis(ds, y, m);
    // Pemberat ikut kepentingan bisnes: jualan & reach dulu, metrik engagement kemudian
    const W = { leads: 3, walkin: 3, conversion: 3, wa: 3, views: 3, uniqueClicks: 2, profileViews: 2, newFollowers: 2, likes: 1, comments: 1, shares: 1, telegram: 1, ctrProfile: 1, ctrAction: 1 };
    const list = Object.values(K).filter(k => !k.floor && k.ratio != null);
    const out = [];
    const trend = k => k.mom != null ? `, ${k.mom >= 0 ? 'naik' : 'turun'} ${Math.abs(k.mom).toFixed(0)}% vs bulan lepas` : '';
    if (list.length) {
      const imp = list.filter(k => (W[k.id] || 1) >= 2);
      const pool = imp.length ? imp : list;
      // terbaik: KPI penting yang capai paling tinggi; jika tiada yang capai, KPI mana-mana yang tertinggi
      const hitImp = pool.filter(k => k.ratio >= 1);
      const best = (hitImp.length ? hitImp : list).reduce((a, b) => (b.ratio > a.ratio ? b : a));
      // paling jauh: jurang × pemberat, supaya Leads 60% lebih penting dari Comments 26%
      const gap = k => Math.max(0, 1 - k.ratio) * (W[k.id] || 1);
      const worst = list.reduce((a, b) => (gap(b) > gap(a) ? b : a));
      out.push({ kind: 'good', title: best.ratio >= 1 ? best.label : `Paling hampir target: ${best.label}`, chip: `${Math.round(best.ratio * 100)}%`, text: `${Math.round(best.ratio * 100)}% daripada target${best.partial ? ' (ikut kadar hari)' : ''}${trend(best)}.` });
      if (gap(worst) > 0) out.push({ kind: 'bad', title: worst.label, chip: `${Math.round(worst.ratio * 100)}%`, text: `Baru ${Math.round(worst.ratio * 100)}% daripada target ${Math.round(worst.target).toLocaleString('en-MY')}${trend(worst)}.` });
    }
    const negNet = streak(ds, y, m, c => c.v.netGrowth != null && c.v.netGrowth < 0);
    const downViews = streak(ds, y, m, (c, p) => c.norm('views') != null && p.norm('views') != null && c.norm('views') < p.norm('views'));
    const upViews = streak(ds, y, m, (c, p) => c.norm('views') != null && p.norm('views') != null && c.norm('views') > p.norm('views'));
    if (negNet >= 3) out.push({ kind: 'bad', title: 'Followers menyusut', chip: `${negNet} bln`, text: `Net followers negatif ${negNet} bulan berturut-turut (bulan ini ${Math.round(K.netGrowth.actual).toLocaleString('en-MY')}). Lebih ramai unfollow daripada follow baru.` });
    else if (downViews >= 2) out.push({ kind: 'bad', title: 'Views menurun', chip: `${downViews} bln`, text: `TikTok views turun ${downViews} bulan berturut-turut.` });
    else if (upViews >= 2) out.push({ kind: 'good', title: 'Views meningkat', chip: `${upViews} bln`, text: `TikTok views naik ${upViews} bulan berturut-turut.` });
    else {
      const f = funnel(ds, y, m);
      if (f.weakest) out.push({ kind: 'bad', title: f.weakest.label, chip: `${f.weakest.rate.toFixed(1)}%`, text: `Kadar ${f.weakest.rate.toFixed(1)}%, ${Math.abs(f.weakest.vsAvg).toFixed(0)}% lebih rendah dari purata 3 bulan.` });
    }
    return out.slice(0, 3);
  }

  // ---------- Peringkat syarikat (Overview) ----------
  // Views/engagement/followers dari Insight akaun setiap platform (bukan jumlah view per-post, elak double count).
  // TikTok: Likes + Comments + Shares. FB/IG: lajur Interactions (sheet tak pecahkan like/comment/share Meta).
  // Followers: TikTok ada new/lost/net; FB/IG hanya follow baru (tiada data unfollow).
  const PLATFORMS = [['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['instagram', 'Instagram']];
  // kunci sumber untuk kiraan hari data setiap metrik
  const SRC_KEY = {
    tiktok: { views: 'views', reach: 'reach', engagement: 'likes', newFollowers: 'newFollowers', netFollowers: 'netGrowth', lostFollowers: 'lostFollowers', profileViews: 'profileViews' },
    meta: { views: 'views', reach: 'reach', engagement: 'interactions', newFollowers: 'follow' },
  };
  function company(ds, y, m) {
    const s = social(ds, y, m), dim = daysIn(y, m);
    const plats = PLATFORMS.map(([id, name]) => {
      const c = s[id], has = c.days > 0, tt = id === 'tiktok';
      const eng = !has ? null : tt
        ? ([c.likes, c.comments, c.shares].every(v => v == null) ? null : (c.likes || 0) + (c.comments || 0) + (c.shares || 0))
        : c.interactions;
      const sk = SRC_KEY[tt ? 'tiktok' : 'meta'];
      return {
        id, name, days: c.days,
        daysOf: Object.fromEntries(Object.entries(sk).map(([k, src]) => [k, has ? c.daysOf[src] : 0])),
        views: has ? c.views : null, reach: has ? c.reach : null, engagement: eng,
        likes: tt && has ? c.likes : null, comments: tt && has ? c.comments : null, shares: tt && has ? c.shares : null,
        newFollowers: !has ? null : tt ? c.newFollowers : c.follow,
        lostFollowers: tt && has ? c.lostFollowers : null,
        netFollowers: tt && has ? c.netGrowth : null,
        profileViews: tt && has ? c.profileViews : null,
      };
    });
    const tot = k => { const v = plats.filter(p => p[k] != null); return v.length ? sum(v, p => p[k]) : null; };
    return { plats, dim, views: tot('views'), engagement: tot('engagement'), newFollowers: tot('newFollowers'), reach: tot('reach') };
  }

  // Perubahan vs bulan lepas, dinormalkan ikut hari data (bulan separa boleh dibanding dengan bulan penuh)
  function companyCompare(ds, y, m) {
    const cur = company(ds, y, m), [py, pm] = prevYM(y, m), prev = company(ds, py, pm);
    const nz = (p, k, dim) => { const d = p.daysOf[k]; return p[k] == null || !d ? null : p[k] * dim / d; };
    const ch = (k, id) => {
      if (id) return change(nz(cur.plats.find(p => p.id === id), k, cur.dim), nz(prev.plats.find(p => p.id === id), k, prev.dim));
      // jumlah: hanya platform yang ada data di kedua-dua bulan
      let a = 0, b = 0, any = false;
      cur.plats.forEach((p, i) => { const x = nz(p, k, cur.dim), z = nz(prev.plats[i], k, prev.dim); if (x != null && z != null) { a += x; b += z; any = true; } });
      return any ? change(a, b) : null;
    };
    return { cur, prev, ch };
  }

  // Kad skor semua KPI bertarget (content dari tab per-post + TikTok, Linktree, Leads)
  // c / pc = contentStats bulan ini / bulan lepas (null jika tab per-post tiada); cPace = pecahan bulan berlalu
  function scorecard(ds, y, m, c, pc, cPace = 1) {
    const K = kpis(ds, y, m), T = CFG.targets;
    const GROUP = { views: 'TikTok', likes: 'TikTok', comments: 'TikTok', shares: 'TikTok', profileViews: 'TikTok', newFollowers: 'TikTok', netGrowth: 'TikTok',
      uniqueClicks: 'Linktree & WhatsApp', ctrProfile: 'Linktree & WhatsApp', ctrAction: 'Linktree & WhatsApp', telegram: 'Linktree & WhatsApp', wa: 'Linktree & WhatsApp',
      leads: 'Leads & Walk-in', walkin: 'Leads & Walk-in', conversion: 'Leads & Walk-in' };
    const list = Object.values(K).map(k => ({ ...k, group: GROUP[k.id] }));
    const ck = (id, label, a, prevA, target) => {
      const nowN = a == null ? null : a / Math.max(cPace, 0.0001);
      const improving = nowN != null && prevA != null ? nowN > prevA : null;
      return { id, label, group: 'Content', actual: a, target, pace: cPace, partial: cPace < 1, status: status(a, target, cPace, false, improving),
        nowN, prev: prevA, mom: change(nowN, prevA), ratio: a == null ? null : a / (target * Math.max(cPace, 0.0001)) };
    };
    if (c && c.total) {
      const p = pc && pc.total ? pc : null;
      list.unshift(
        ck('totalContent', 'Total Posts', c.total, p ? p.total : null, T.totalContent),
        ...(c.hasType ? [ck('pov', 'POV Customer', c.pov, p && p.hasType ? p.pov : null, T.povCustomer), ck('strategic', 'Strategic Posts', c.strategic, p && p.hasType ? p.strategic : null, T.strategic)] : []),
        ck('postViews', 'Views content (jumlah semua post)', c.views, p ? p.views : null, T.viewsPerPost),
        ...Object.entries(c.bucketStats).map(([k, b]) => ck('bucket_' + k, 'Views bucket ' + k, b.views, p ? p.bucketStats[k].views : null, b.target)),
      );
    }
    const res = { hit: [], miss: [], na: [], list };
    for (const k of list) (k.status.level === 'good' ? res.hit : k.status.level === 'na' ? res.na : res.miss).push(k);
    res.miss.sort((a, b) => (a.ratio ?? 1) - (b.ratio ?? 1)); // jurang terbesar dulu
    return res;
  }

  const API = { company, companyCompare, scorecard, kpis, funnel, insights, monthCore, prevYM, change, parseCSV, num, parseDate, parseDaily, parsePosts, parseLinktree, KEYS, loadAll, loadMonthPosts, monthsAvailable, social, contentStats, outletStats, monthlySeries, status, tierOf, ym, daysIn };
  root.KD = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
