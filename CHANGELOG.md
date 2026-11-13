# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use `MAJOR.MINOR.PATCH`.

## [3.6.0] — 2026-11-13

### Added
- **Changed products surface in the dashboard.** When a smart-watch check or a normal page visit records a different price, an already-open dashboard re-renders in place instead of waiting for you to close and reopen it. Returning to a tab also re-reads history, so a dashboard picks up changes recorded elsewhere.
- **Change badge.** Rows that moved within the last 7 days show a `↓` / `↑` badge with the percentage move; the tooltip shows the previous and new price.
- **Row tint.** Recent drops get a soft green tint and recent rises a soft orange tint, so movement is visible even while scrolling.
- **Recent changes sort.** A new dashboard sort orders products by the time of their last real movement, independent of later unchanged baseline samples.

### Changed
- Dashboard re-renders triggered by data changes preserve the current search text, sort selection, and scroll position.
- `checkWatchedProduct` now reports whether the price actually changed, so only real changes refresh the UI.
- `latestChange` walks backwards through samples, so a later unchanged daily baseline cannot hide the most recent movement.

## [3.5.0] — 2026-11-13

### Added
- **Smart watch (opt-in, default off).** Budgeted background price checks while a Jumia/AliExpress tab is visible. No server and no headless crawler; nothing runs when every tab is closed.
- Canary-gated scheduling: up to three recently volatile background-eligible products act as signals. Two canary changes within six hours trigger a slow campaign sweep of the rest.
- Adaptive per-product intervals based on 30-day volatility, recent changes, and consecutive unchanged checks, with ±20% jitter and a 14-day staleness ceiling.
- **Target prices.** A 🎯 button on each dashboard row sets a target. Products within 10% of target are checked daily; products at/below target are effectively retired. Reaching a target fires a notification.
- Conditional GET with stored `ETag` / `Last-Modified`; `304 Not Modified` confirms an unchanged price without parsing or appending a sample.
- Hard limits: 40 checks/day, 8-second minimum gap, one request in flight, and per-host exponential backoff on 403/429/5xx (honouring `Retry-After`).
- Dashboard smart-watch bar with an enable checkbox, live status (`12/40 checks today · 3 canaries · next in 2h`), and **Check now**.
- Cross-tab lease so two open tabs do not double-check, and automatic pausing when the tab is hidden, offline, or `saveData` is enabled.
- Refactored extraction helpers to accept an explicit `Document` and base URL, so background checks can parse fetched HTML without touching the live page.

### Changed
- Normal page visits now update scheduler metadata (`noteLivePrice`), even when the watch is off. This keeps the first background check well informed.
- Background samples are stored as `src: "watch"` and are only recorded when the price changes or the newest sample is at least 24 hours old, keeping history small.
- `mergeHistoryData` now also preserves an imported `target` price.
- AliExpress remains visit-captured: background fetches are disabled because AliExpress serves challenge pages to scripted requests.

## [3.4.0] — 2026-11-12

### Added
- **Product images.** Each tracked product now stores an image URL, resolved in this order: `og:image` / `og:image:secure_url` / Twitter image meta → JSON-LD `Product.image` (including relative URLs and `ImageObject` values) → site gallery selectors. Obvious site chrome (logos, sprites, spacers, tracking pixels) is rejected.
- **Dashboard thumbnails.** 40×40 thumbnails in every row, with a 🛍 placeholder when an image is missing or fails to load.
- **Panel thumbnail.** The floating panel shows the product image and name above the current price.
- **Fetch images** in the dashboard footer. Backfills up to 30 tracked products per click, two requests at a time, 250 ms apart. Only products without an image are targeted, so clicking again resumes where the last run stopped.
- Broken-image fallback via a capture-phase `error` listener, replacing failed thumbnails with the placeholder.

### Changed
- Image URLs are persisted by `recordPrice`, retained by `mergeHistoryData`, and included in Export/Import JSON.
- `imageFromDoc` accepts an explicit site hint so image backfill works for Jumia and AliExpress entries in the same history.
- Explicit text/background colours on dashboard footer buttons, filter input, sort select, import textarea, and panel buttons; dashboard content now declares a base `color`. This fixes invisible control text under forced dark mode / dark UA form-control schemes.
- Script metadata now includes `@homepageURL`, `@supportURL`, `@updateURL`, `@downloadURL`, and `@license`; author updated to Oxide5401. **`@name` and `@namespace` are unchanged** to preserve existing storage.

### Fixed
- Dark-mode screenshots revealed that form controls could render white text on white backgrounds; all controls now pin readable colours.

## [3.3.2] — 2026-11-12

### Fixed
- **Invisible product names in the dashboard** on setups where site/extension CSS suppresses text inside `<a>` elements. The name is now a plain `<span class="jtm-name-text">`; a transparent, absolutely positioned `<a class="jtm-name-link">` overlay keeps the row clickable and preserves link semantics (open in new tab, copy link, keyboard focus).
- Tooltips still expose the full stored name, and the name cell keeps ellipsis behaviour.

## [3.3.1] — 2026-11-12

### Fixed
- Product-name link colour no longer hard-coded to `#222`; it inherits the row colour, so names stay visible when the modal is recoloured by dark-mode extensions.
- Added `color-scheme: only light` to the panel and dashboard to stop Chrome/Edge auto-dark from recolouring the UI.
- Blank, whitespace-only, or zero-width-only stored names now fall back to the product key instead of rendering as nothing (`displayName`).
- Price extraction can no longer overwrite a good stored name with a blank/space-only value; zero-width characters are stripped before saving.

## [3.3.0] — 2026-11-12

### Added
- **AliExpress support** alongside Jumia Ghana: `@match` rules for `aliexpress.com` and `*.aliexpress.com`, `@connect` rules, and site-aware configuration.
- Site registry (`SITES`, `SITE`, `IS_ALI`) with per-site labels, currencies, key prefixes, coupon pages, and extraction retry budgets.
- AliExpress extraction chain: DOM selectors, embedded page state, JSON-LD, and meta fallbacks; an SPA URL watcher records new items without a reload.
- Currency detection and `formatMoney`; improved `parsePrice` for ranges and European separators.
- Shared product history (`jumia_gh_price_history`) with `ali:<itemId>` keys, plus per-site coupon stores.
- Dashboard site tags (`Jumia` / `AliExpress`) and per-row site detection.
- **Import JSON** with merge-safe semantics: adds products/samples and fills missing fields, never overwrites existing data.
- Safer name storage: zero-width characters are stripped, and empty extraction results no longer replace good names.

### Changed
- `@name` and `@namespace` intentionally restored byte-for-byte to v3.2.0 (including the en dash in the name) so installing this file updates the existing script and keeps its `GM_setValue` data.
- The script lives in its own release file; the original 3.2.0 file is left untouched.

### Notes
- AliExpress has no Ghana-specific domain; the script assumes `aliexpress.com` with ship-to Ghana and GHS pricing, without currency conversion.

## [3.2.0] — baseline

Original Jumia Ghana–only userscript: price extraction, coupon finder, floating panel, dashboard, notifications, and persistent `GM_setValue` history. Preserved unchanged as the storage-identity baseline for later versions.
