# Jumia + AliExpress Price Tracker

A single Tampermonkey/Violentmonkey userscript that tracks product prices on **Jumia Ghana** (`jumia.com.gh`) and **AliExpress** (Ghana shipping, GHS), finds and stores coupon codes, and shows everything in one dashboard — including **product thumbnails**.

![Version](https://img.shields.io/badge/version-3.4.0-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-2ea44f)

- **Script:** [`jumia-aliexpress-price-tracker.user.js`](jumia-aliexpress-price-tracker.user.js)
- **One-click install:** <https://raw.githubusercontent.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/main/jumia-aliexpress-price-tracker.user.js>
- **Issues:** <https://github.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/issues>

> **Upgrading from the original Jumia-only script?** Read [Upgrading / keeping your data](#upgrading--keeping-your-data) first. Installing over the old script keeps your history; uninstalling the old script deletes it.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Upgrading / keeping your data](#upgrading--keeping-your-data)
- [Usage](#usage)
  - [The floating panel](#the-floating-panel)
  - [Coupons](#coupons)
  - [The tracked-products dashboard](#the-tracked-products-dashboard)
  - [Product images](#product-images)
  - [Notifications](#notifications)
- [How prices are extracted](#how-prices-are-extracted)
- [Data storage & privacy](#data-storage--privacy)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Versioning](#versioning)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Features

### Price tracking
- Records a timestamped price sample every time you open a product page (and on **Refresh**).
- Keeps up to **120 samples per product** and the **200 most recently updated products**.
- Shows current, lowest, highest, and percentage change since the first sample.
- Detects price drops against the previous sample and can notify you (default threshold: **5%**).
- Robust price parsing for `1,234.56` (Anglo) and `1.234,56` (European) formats and price ranges such as `GHS 20.00 - 35.00`.
- Multiple extraction strategies per site: DOM selectors → JSON-LD → embedded page state → meta tags.

### Product images (new in 3.4.0)
- Captures a product image whenever a product is tracked or refreshed.
- Resolution order: `og:image` → JSON-LD `Product.image` → site gallery selectors.
- Stores the image URL with the product, so thumbnails appear in the panel and dashboard.
- Graceful 🛍 placeholder when an image is missing, blocked, or fails to load.
- **Fetch images** button backfills images for products tracked by older versions.

### Coupons
- Scans the current page plus site coupon pages for codes.
- Strict validation removes dictionary words, placeholders, and noise (`CODE`, `OFF`, `SAVE`, etc.), deduplicates, and scores relevance to the current product.
- Persists codes across visits with per-code hit counts, first/last-seen timestamps, and expiry.
- 6-hour background sync; click a code to copy it.
- Optional **all** toggle shows the full cached list instead of the top 10.

### Dashboard
- One list for both sites, with a `Jumia` / `AliExpress` tag per row.
- Search by name; sort by recent, biggest drop/rise, lowest/highest price, or name.
- Per-row current / low / high / change, plus a delete button.
- **Export JSON**, merge-safe **Import JSON**, **Fetch images**, and **Clear All**.
- Works on any page of either site — you do not need to be on a product page.

### Cross-site behaviour
- AliExpress is a SPA: a URL watcher detects in-page product changes and records the new item without a reload.
- Per-site coupon stores and coupon-page URLs; one shared product history.
- Currency-aware formatting for GHS, USD, EUR, GBP, NGN, KES, ZAR, CNY, CAD, AUD.
- Explicit colours and `color-scheme: only light` keep the UI readable under dark-mode extensions.
- Product names are plain `<span>` text with a transparent link overlay, so they stay visible even when a site/extension CSS rule hides anchor text.

---

## Installation

### Requirements
- A userscript manager: **Tampermonkey** (Chrome, Edge, Firefox, Safari), **Violentmonkey**, or a compatible alternative.
- Access to `jumia.com.gh` and/or `aliexpress.com`.

### Install
1. Install Tampermonkey or Violentmonkey.
2. Open the raw script URL:
   <https://raw.githubusercontent.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/main/jumia-aliexpress-price-tracker.user.js>
3. Confirm the install in your userscript manager.
4. Open any page on `jumia.com.gh` or `aliexpress.com`. The panel appears in the bottom-right corner.

The script declares `@updateURL` / `@downloadURL` pointing at this repository, so script managers that support automatic updates can update it from GitHub.

### Manual install
Download `jumia-aliexpress-price-tracker.user.js`, then drag it into the browser with the userscript manager installed, or use the manager's **Utilities → Import from file** option.

---

## Upgrading / keeping your data

`GM_setValue` storage belongs to the **installed script**, keyed by `@name` + `@namespace`. This project therefore keeps the legacy identity on purpose:

```
@name       Jumia Ghana – Price Tracker + Coupons + Dashboard
@namespace  https://github.com/yourname/jumia-price-tracker
```

Both are **byte-identical to the original 3.2.0 script**, including the en dash (`–`). Do not change them; doing so creates a new script with empty storage.

To upgrade from v3.2.0 or the AliExpress beta:

1. Install this script while the old one is still installed.
2. Choose **Update** / **Reinstall** — not "install as a new script" if your manager offers that choice.
3. Do **not** uninstall the old script first; uninstalling removes its storage.

Your history, coupon cache, and "show all" setting carry over, and AliExpress items are added to the same store under `ali:<itemId>` keys.

### If you already installed a copy with a different name
Your data is still attached to the original script. Rescue it like this:

1. Open the **old** script's dashboard on Jumia and click **Export JSON** (copies to clipboard).
2. In the new script's dashboard, click **Import JSON**, paste, and click **Merge**.
3. Confirm the products appear, then remove the duplicate script.

**Merge never overwrites:** existing products keep their samples and metadata; only missing samples and fields are added.

---

## Usage

### The floating panel

| Element | What it does |
| --- | --- |
| Site badge | `Jumia GH` or `AliExpress`, so you always know which store you are on. |
| 📊 counter | Number of tracked products; click to open the dashboard. |
| Product block | Thumbnail plus the product name of the page you are on. |
| Current | Current price and, when available, the pre-discount price. |
| Stats | Sample count, change since the first sample, and drop alerts. |
| **Refresh** | Re-extracts the price now and records a sample. |
| **Find Coupons** | Scans this page and the site's coupon pages immediately. |
| **Clear** | Removes this product from history and clears the site's coupon cache. Treats the site's cache as disposable; your other tracked products are untouched. |
| Coupons list | Ranked codes; click one to copy it. Tick **all** to see every cached code. |

Prices are recorded automatically shortly after a product page loads. If extraction fails, the script retries with a site-specific backoff (20 attempts on Jumia, 40 on AliExpress).

### Coupons

Coupons are found in two ways:

1. **Page scan** — every page you visit is scanned for code-like patterns, with context labels such as `Code:`, `Coupon:`, `Voucher:`, `Use code`, etc. Full-width colons (`：`) are supported.
2. **Coupon pages** — Jumia's `/coupons/` pages and AliExpress's `p/my-coupons` / `p/coupon-package` pages are fetched in the background when the cache is older than six hours.

Codes must pass validation: minimum length, character set, and a noise dictionary. The list is deduplicated by code, and each code's description is scored against the current product name plus freshness, expiry, and site-wide relevance.

Coupon extraction is best-effort. Campaign codes and login-gated offers change frequently, so an empty list is not necessarily a bug.

### The tracked-products dashboard

Open it with the 📊 button in the panel.

- **Filter by name** — case-insensitive substring match; blank stored names still match their fallback label.
- **Sort** — Recent (last sample), Biggest drop, Biggest rise, Lowest price, Highest price, Name.
- **Rows** — site tag, thumbnail, name (tooltip shows the full stored name), current, low, high, change, delete.
- **Export JSON** — copies the full history to the clipboard as pretty-printed JSON.
- **Import JSON** — paste an export; **Merge** adds new products/samples and fills missing fields without deleting anything.
- **Fetch images** — see below.
- **Clear All** — deletes every tracked product on both sites after confirmation (coupons are kept).

### Product images

Images are captured automatically while you browse product pages; no extra clicks are needed for new items.

For products tracked before 3.4.0:

1. Open the dashboard.
2. Click **Fetch images**. It processes up to **30 products per click**, two requests at a time, with a 250 ms delay between requests.
3. Repeat until the "All done" message. The button only ever targets products that still have no image.

**AliExpress caveat:** AliExpress usually serves a bot-challenge page to scripted requests, so backfill mostly succeeds for Jumia. AliExpress images are captured normally when you actually open an item page — visiting an item once fills in its thumbnail.

A thumbnail shows 🛍 when:

- the product has no stored image yet,
- the image URL fails to load, or
- the image was rejected as site chrome (logos, sprites, spacers, tracking pixels).

### Notifications

When a new sample is at least **5% lower** than the previous one, the script triggers a notification with the new price, the previous price, and the drop percentage. It uses `GM_notification` when available and falls back to the Web Notifications API. Permission may be requested the first time.

---

## How prices are extracted

Each site has an ordered chain of extractors; the first strategy that returns a positive price wins.

**Jumia**

1. DOM selectors (`.prc`, `[data-price]`, etc.).
2. JSON-LD `Product` / `Offer`.
3. Meta tags (`product:price:amount`, `og:price:amount`, etc.).

**AliExpress**

1. DOM selectors (`.price--currentPriceText--V8_y_b5`, `.product-price-current`, `.product-price-value`, `Product_Price__container`, `.uniform-banner-box-price`).
2. Embedded page state (searching the page scripts for price fields).
3. JSON-LD.
4. Meta tags.

Because AliExpress is a SPA, extraction is retried after URL changes and can end up using whichever representation is available at that moment. The price-recorded log line reports the winning `source` (`dom`, `json-ld`, `state`, `meta`).

---

## Data storage & privacy

All data stays in your browser, inside your userscript manager's storage. There is no account, analytics, telemetry, or third-party server operated by this project.

### Storage keys

| Key | Scope | Contents |
| --- | --- | --- |
| `jumia_gh_price_history` | both sites | Products and price samples (JSON object). |
| `jumia_gh_coupons` | Jumia | Cached Jumia coupons (JSON array). |
| `aliexpress_coupons` | AliExpress | Cached AliExpress coupons (JSON array). |
| `jumia_gh_coupons_last_fetch` | Jumia | Last coupon sync timestamp (ms). |
| `aliexpress_coupons_last_fetch` | AliExpress | Last coupon sync timestamp (ms). |
| `jumia_gh_coupons_show_all` | Jumia | Whether the coupon list shows all codes. |
| `aliexpress_coupons_show_all` | AliExpress | Whether the coupon list shows all codes. |

### History schema

```json
{
  "samsung-galaxy-a15-128gb": {
    "name": "Samsung Galaxy A15 128GB Dual SIM",
    "url": "https://www.jumia.com.gh/samsung-galaxy-a15-128gb.html",
    "site": "jumia",
    "currency": "GHS",
    "image": "https://gh.jumia.is/.../1.jpg",
    "created": 1730000000000,
    "samples": [
      { "p": 1499, "op": null, "t": 1730000000000, "src": "dom" },
      { "p": 1299, "op": 1499, "t": 1730100000000, "src": "json-ld" }
    ]
  },
  "ali:1005006187992416": {
    "name": "USB C Cable 2m Fast Charging Braided",
    "url": "https://www.aliexpress.com/item/1005006187992416.html",
    "site": "aliexpress",
    "currency": "GHS",
    "created": 1730200000000,
    "samples": [
      { "p": 45.9, "op": null, "t": 1730200000000, "src": "dom" }
    ]
  }
}
```

- `p` — price (number).
- `op` — old/pre-discount price, when the page exposes one.
- `t` — sample timestamp in milliseconds.
- `src` — extraction strategy that produced the sample.
- `image` — optional absolute image URL.

Product keys:

- Jumia: the URL slug before `.html` (e.g. `samsung-galaxy-a15-128gb`).
- AliExpress: `ali:` + item ID (e.g. `ali:1005006187992416`).

### Network requests

The script performs network requests only to:

- `jumia.com.gh` / `www.jumia.com.gh` — coupon pages and image backfill.
- `aliexpress.com` / `*.aliexpress.com` — coupon pages and image backfill.
- Product image CDNs referenced by page metadata, when the browser renders a thumbnail.

Requests are restricted by the script's `@connect` rules. Cookies for the current site may accompany gallery requests, as with any page request your browser makes.

---

## Known limitations

- **Single sample = 0% change.** A newly tracked product shows `+0.0%` and equal current/low/high values until a second, different sample arrives.
- **Prices are snapshots.** Price history only grows when you visit (or refresh) a product page. There is no background crawler.
- **AliExpress blocking.** AliExpress may challenge `GM_xmlhttpRequest` page fetches; coupon sync and image backfill can fail there. Live capture from pages you actually open still works.
- **Currency follows the site.** Formatting is GHS-oriented but prints whatever currency the page/extractor reports; it does not convert between currencies.
- **Coupon discovery is heuristic.** Login-gated, personalised, or image-only offers may be missed; stale codes may persist until they expire or you clear the cache.
- **Dashboard size.** Product rows are sorted and filtered client-side; extremely large histories remain usable but longer to render.
- **No cross-device sync.** Two browsers/userscript profiles have independent stores. Use Export/Import JSON to move data manually.

---

## Troubleshooting

### The panel does not appear
- Confirm the script is enabled in Tampermonkey/Violentmonkey and matches the current site.
- Check the userscript manager's **includes** for `jumia.com.gh` and `aliexpress.com`.
- Reload the page; the script runs at `document-end`.
- Open the browser console and look for `[Price Tracker]` log lines.

### Product names look blank in the dashboard
Hover the row. If the tooltip shows the name, the data is intact — the environment is hiding text. Since 3.3.2 the name is a plain `<span>` with an invisible link overlay, and since 3.3.1 the panel/dashboard use explicit colours and light `color-scheme`. Update to the latest version and disable aggressive "force dark" rules for these sites if the problem persists.

### Names or prices appear as blank in the panel
Update to the latest version. If it still happens, open DevTools → inspect the panel and report the computed `color` / `display` of the element in an issue.

### Thumbnails are missing
- New products get images automatically; older products need **Fetch images**.
- AliExpress backfill is expected to fail often; visit the item page once.
- A 🛍 placeholder means no image, a rejected image URL, or a load failure (including offline/CDN blocks).

### "Fetch images" finishes with 0 fetched
- All eligible products may already have images, or the pages are blocked for scripted requests. Check the console for `[Price Tracker] Image backfill failed:`.
- Try running it while logged in to the site in the same browser profile.

### Coupons list is empty
- Coupons are site-specific; make sure you are looking at the right site's panel.
- Click **Find Coupons** to force a scan.
- Untick/tick **all** to switch between the top-10 view and the full cached list.
- Codes are validated aggressively; a page full of marketing text may legitimately produce none.

### I need to recover or move data
- Dashboard → **Export JSON** copies everything, including images.
- **Import JSON → Merge** is non-destructive and works across browsers.
- Keep the old script installed until the merge is confirmed.

### The script updated but behaviour did not change
Check the version shown in your userscript manager. Some managers require a manual **Check for updates**; `@updateURL` points at the `main` branch.

---

## Repository layout

```
.
├── jumia-aliexpress-price-tracker.user.js   # the userscript (self-contained)
├── README.md                                 # this file
├── CHANGELOG.md                              # release history
├── docs/
│   ├── ARCHITECTURE.md                       # module map, data flow, extension points
│   └── TESTING.md                            # manual + automated test checklist
├── LICENSE                                   # MIT
└── .gitignore
```

There is no build step, bundler, or dependency tree: the userscript is the distributable artifact.

---

## Development

### Requirements
- Node.js 18+ (used only for syntax checks and optional DOM tests).
- A Chromium-based browser or Firefox for manual testing.

### Syntax check

```bash
node --check jumia-aliexpress-price-tracker.user.js
```

### Local test harness

The script is an IIFE with no exports, so tests load it into a DOM and stub the userscript APIs:

- `GM_getValue` / `GM_setValue` backed by an object.
- `GM_addStyle` appending a `<style>` element.
- `GM_xmlhttpRequest` returning canned HTML.
- `GM_notification`, `alert`, and `confirm` stubs.

Use jsdom (`npm install jsdom`) to verify extraction, storage, merge behaviour, panel/dashboard rendering, and image handling. A headless Chromium screenshot is useful for layout checks:

```bash
msedge --headless=new --disable-gpu --hide-scrollbars \
  --window-size=800,900 --virtual-time-budget=4000 \
  --screenshot=out.png file:///path/to/harness.html
```

See [`docs/TESTING.md`](docs/TESTING.md) for the checklist.

### Editing guidelines
- **Never change `@name` or `@namespace`.** They are the storage identity and preserve existing users' data.
- Keep the script self-contained: no external libraries, no network calls beyond declared `@connect` hosts.
- Avoid putting critical text inside `<a>` elements; use a text span plus an overlay link for clickability.
- Set explicit `color`/`background` on form controls and UI text — dark-mode extensions and UA dark schemes otherwise produce invisible text.
- Escape all page-derived strings inserted into HTML (`escapeHtml`) and keep `@noframes`.
- Validate with `node --check` before committing.

### Bumping the version
1. Update `@version` in the userscript header.
2. Add a `CHANGELOG.md` entry.
3. Commit both in the same change.

---

## Versioning

The project follows a pragmatic `MAJOR.MINOR.PATCH` scheme:

- **MAJOR** — storage-incompatible or identity-changing changes (should not happen without a migration plan).
- **MINOR** — new sites, major features, new dashboard capabilities.
- **PATCH** — bug fixes, selector updates, styling and documentation fixes.

Current release: **3.4.0** — product images, image backfill, and dark-mode-safe controls. See [`CHANGELOG.md`](CHANGELOG.md).

---

## Contributing

1. Open an issue describing the bug or feature, including the site, page URL shape, and console output.
2. Keep pull requests focused; avoid unrelated formatting churn.
3. Run `node --check` and the relevant manual checklist items.
4. Do not rename the script or change its `@namespace`.

Selector breakage is the most common failure mode on both sites; a small, tested selector addition is a welcome contribution.

---

## License

[MIT](LICENSE) © 2026 Oxide5401

---

## Disclaimer

This is an independent, unofficial project. It is not affiliated with, endorsed by, or supported by Jumia or AliExpress/Alibaba. Product names, prices, images, and coupon codes belong to their respective owners. Scraping and automation may be restricted by a site's terms of service; use the script responsibly and at your own risk. Prices and coupon codes are provided "as is" and may be inaccurate or out of date.
