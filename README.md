# KLIKI Marketing Dashboard

Web app (PWA) untuk pantau prestasi marketing media sosial KLIKI. Data dibaca **terus dari Google Sheet** setiap kali app dibuka, jadi tiada data disimpan dalam repo ini.

## Sumber data

| Sheet | Tab | Digunakan untuk |
|---|---|---|
| CONTENT SUBMIT | Tiktok Insight, Facebook Insight, Instagram Insight | Views, engagement, followers harian |
| CONTENT SUBMIT | Supply Video V2, Customer, Before/After, Leads, Walk-in | KPI outlet |
| REPORT CONTENT DATA | Tab bulanan (JAN'26 … OKT'26) | Data per-post: content, bucket, outlet, tier |
| REPORT CONTENT DATA | LINKTREE | Klik WhatsApp, lokasi, Telegram, CTR (tahun 2026) |

Kedua-dua sheet mesti dikongsi **"Anyone with the link → Viewer"** supaya app boleh baca.

## Tukar target / tambah tab bulan baru

Semua dalam `js/config.js`:
- `targets` — target rasmi bulanan
- `monthTabs` — `gid` tab per-post ikut bulan. Bulan yang tiada dalam senarai akan dicari ikut nama tab (contoh `NOV'26`, `DIS'26`) dan disahkan ikut tarikh dalam tab.

Semua formula KPI ada dalam `js/data.js`. `js/app.js` hanya paparan.

## Struktur tab (mesyuarat bulanan)

- **Overview: Company Marketing** (halaman utama): content output (Total / POV Customer / Strategic), Total Views, Total Engagement, Follower Growth merentas TikTok, Facebook, Instagram, WhatsApp Clicks & Leads, status KPI dan highlights. Tiada jadual outlet.
- **Content Performance**: output vs target, prestasi platform, trend views bulanan, top content, prestasi ikut TYPE / kategori / bucket, funnel TOFU-MOFU-BOFU (muncul automatik bila tab per-post ada lajur bernilai TOFU/MOFU/BOFU).
- **Marketing Analysis**: KPI capai / gagal / tiada data, perubahan vs bulan lepas, insights.
- **Funnel, Outlet, Trend**: drill-down.

Peraturan data: sel kosong = tiada data (bukan 0). Views per-post (tab bulanan) tidak dicampur dengan views Insight akaun. Engagement FB/IG = lajur Interactions (tiada pecahan like/comment/share). Net follower hanya untuk TikTok (FB/IG tiada data unfollow).

## Pasang di phone

Buka URL GitHub Pages di phone:
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*

## Struktur

```
index.html            shell app
styles.css            gaya (Inter, biru KLIKI #1565FF / #0A2E8A, light/dark, sidebar navy)
js/config.js          ID sheet, gid tab, target
js/data.js            fetch CSV + parse + kira KPI
js/app.js             paparan 6 tab: Overview, Content, Analisis (mesyuarat bulanan) + Funnel, Outlet, Trend (drill-down)
sw.js                 service worker (buka laju, offline guna data terakhir)
manifest.webmanifest  maklumat app untuk "Add to Home Screen"
```
