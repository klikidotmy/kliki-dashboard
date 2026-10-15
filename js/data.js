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
      posts.push({ date, outlet, kategori, type, sub: normSub(sub), views });
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
        const rows = await fetchRows(CFG.sheets.reportContent, { ...c, range: 'A1:G300' });
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
    const agg = (rows, keys) => Object.fromEntries(keys.map(k => [k, sum(rows, r => r[k])]));
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
    const strategicPosts = hasType ? posts.filter(p => !/pov/i.test(p.type)) : [];
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
    const top = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
    return { total, views, avg: total ? views / total : 0, hasType, pov, strategic: strategicPosts.length, typeCount, subjCount, bucketStats, outlets, tiers, kategori, top };
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

  // Status berbanding target. pace = pecahan bulan yang dah berlalu (1 untuk bulan lepas).
  function status(actual, target, pace = 1, floor = false) {
    if (actual == null || target == null) return { level: 'na', pct: null };
    if (floor) return { level: actual >= target ? 'good' : 'bad', pct: null };
    const pct = target ? 100 * actual / target : null;
    const exp = Math.max(pace, 0.0001);
    const r = actual / (target * exp);
    const level = r >= 1 ? 'good' : r >= 0.8 ? 'warn' : 'bad';
    return { level, pct };
  }

  const API = { parseCSV, num, parseDate, parseDaily, parsePosts, parseLinktree, KEYS, loadAll, loadMonthPosts, monthsAvailable, social, contentStats, outletStats, monthlySeries, status, tierOf, ym, daysIn };
  root.KD = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
