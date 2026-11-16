# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use `MAJOR.MINOR.PATCH`.

## [3.11.0] — 2026-11-16

### Added
- **Cheaper-alternative finder.** Opening a Jumia product page runs one catalogue search (`/catalog/?q=…`) and links the cheapest listing that is genuinely the same product. Matching is deliberately conservative: brand, model words, capacity/unit values (`20000mAh`, `128GB`, `5L`, `15W`), and accessory words (`case`, `cover`, `charger`, `protector`, `strap`…) are compared, so a phone case is never offered as a cheaper phone and a 10,000 mAh bank is never compared with a 20,000 mAh one.
- **Opt-out toggle, on by default.** A *Cheaper alternatives* checkbox in the panel and a **💸 Cheaper** checkbox in the dashboard bar turn the feature off; the choice is stored in `jumia_gh_cheaper_alts` and applied immediately. Checks are throttled to once per product per 12 hours, with a one-hour retry after a failed search.
- **Saving notifications.** One notification per product per 24 hours when the match is at least **3% and GH₵ 1 cheaper**, naming the current price, the alternative, and the saving.
- **Delivery badges.** Jumia products show **⚡ Jumia Express**, **✈ Ships from abroad**, or **🏬 Marketplace seller** in the panel and on every dashboard row, read from `"isShopExpress"`, `.bdg._xprs`/`.bdg._glb`, the delivery card, and explicit page wording.
- **💰 Track price button.** A button is inserted directly under the wishlist heart on Jumia product pages. One click records the product if it is not tracked yet and opens the dashboard; it then reads **Tracked — open**.
- **Brand capture.** `recordPrice` stores the Jumia brand from the embedded product JSON (falling back to the title) for use by the matcher.

### Changed
- `mergeHistoryData` preserves `brand`, `fulfilment`, and `alts` when importing, so a merge cannot erase alternative results.
- The dashboard watch bar now holds two toggles (Smart watch, 💸 Cheaper) plus the existing status text and **Check now** button.
- Search-result prices are read from the visible `.prc` text in GHS; the EUR `data-gtm-price`/`data-ga4-price` attributes are ignored.

### Tests
- Five new jsdom cases (25 total): conservative alternative matching with accessory/capacity/brand rejection, immediate effect of the opt-out toggle, the 24-hour notification cooldown, abroad detection for non-Express listings, and the Track price button's placement and behaviour.

## [3.10.3] — 2026-11-15

### Added
- **Remembered dashboard sort.** The sort dropdown now saves your choice to `jumia_gh_dash_sort` and restores it the next time the dashboard opens, so selecting **Recent changes** keeps that ordering instead of falling back to **Recent**. Invalid or missing values fall back safely to **Recent**.

## [3.10.2] — 2026-11-15

### Fixed
- **Thumbnails stay square under aggressive theme CSS.** Some dark-mode/theme userscripts rewrite light-background elements with a large inline `border-radius: … !important`; with the old light thumbnail tile plus `overflow: hidden`, a 44 px thumbnail could be clipped into a circle. The thumbnail container is now transparent and no longer clips, the 10 px radius and hairline border live on the `<img>`, and the empty-state tint uses a dark-alpha colour. External radius overrides can no longer reshape the image.

## [3.10.1] — 2026-11-15

### Changed
- **Square, rounded thumbnails.** Panel and dashboard thumbnails are now 44 × 44 px squares with a 10 px radius and a 9 px image radius. Images use `object-fit: cover`, so portrait, landscape, and square product photos all fill the same rounded frame without distortion or letterboxing.

## [3.10.0] — 2026-11-15

### Added
- **Confidence-aware coupon extraction.** Codes are read from `data-code` / clipboard attributes, coupon input values, dedicated code fields, short coupon cards (including copy-to-redeem cards), meta descriptions, and page sentences. Each sighting records a `confidence` tier (`high` / `medium` / `low`).
- **Deal badges.** Each coupon shows its value where it can be parsed: `15% off`, `GH₵ 50 off`, `Free shipping`, or the minimum spend. The panel status line reports how many stored codes are still usable.
- **Broader expiry parsing.** Supports ISO dates and datetimes, `30 Nov 2026`, `Nov 30, 2026`, day/month without a year, `31/12/2026`, relative windows (“valid for 7 days”, “2 weeks left”), and today/tonight/tomorrow. Impossible dates are ignored.
- **Ranking v2.** Product-token relevance, site-wide wording, freshness, confidence, repeat sightings, deal size, and minimum spend are scored together; expired codes sink to the bottom.

### Changed
- **Stricter validation.** Prices (`GHS50`), specs (`128GB`), years (`2024`), numeric IDs, dictionary words, and repeated junk (`HELPHELP`) are rejected. Codes must contain a letter, and sentence words after “coupon” (for example “available”) can no longer become codes.
- **Custom `CONTEXT_RE`.** The context pattern now captures the keyword separately, supports en/em dashes, and avoids treating bare “coupon” as a strong code signal.
- **Resilient coupon sync.** HTTP errors, timeouts, empty shells, and bot challenges are distinguished from a genuine empty page; the next configured URL is tried, and the six-hour timestamp only advances after at least one page loaded successfully. A ten-minute `*_coupons_retry_after` backoff prevents hammering a blocked host while still recovering quickly.
- **Inline text handling.** Coupon cards are read with spaces between child elements, so inline markup cannot invent codes by concatenation (`ISO31Expires`).
- `mergeCoupons` keeps the strongest confidence, longest description, latest expiry, and earliest first-seen time for a code.

## [3.9.0] — 2026-11-14

### Added
- **Seller-edit detection.** When a product's name or URL changes alongside an implausible price jump (a ≥98% drop or 50× rise), the sample is marked as a listing change (`lc`) and `listingChangedAt` is stored. Background checks also compare the redirect target, so a Jumia listing that now resolves to a different product is caught.
- **Listing indicators.** Dashboard rows show an amber `⚠ listing` badge and tint instead of a fake `↓99.9%`; the floating panel shows a 30-day warning line. Low/high/change restart from the first sample after the swap, and no misleading drop or target notification is sent.
- **Per-product price history.** A 📈 button on every dashboard row opens a detail view with an SVG chart of all samples and a newest-first list of every price change (old → new, %, source, and listing markers). Back or Escape returns to the list.

### Changed
- `fetchWatchPage` keeps the redirect target (`finalUrl`) so listing identity can be compared and the stored URL refreshed.

## [3.8.0] — 2026-11-14

### Added
- **Movable floating panel.** Drag the price-tracker panel by its title bar to move it anywhere on the page. The position is stored under `jumia_gh_panel_pos` and restored on reload, so the panel reopens exactly where you left it.
- **Reset shortcut.** Double-click the title bar to return the panel to its default bottom-right corner and clear the saved position.
- The panel is clamped to the viewport (including after a browser resize), and the coupon toast now follows the panel instead of staying in the corner.

## [3.7.0] — 2026-11-13

### Added
- **Dashboard window controls.** The tracked-products window can now be dragged by its title bar, resized from the bottom-right grip, minimized to its title bar, maximized to the full viewport, and restored with the ▢ button or a title-bar double-click.
- **Smart edge snapping.** While dragging or resizing, the window snaps flush to the nearest screen edge within 18 px, with an orange outline confirming the snap. The **🧲** button toggles snapping; holding **Alt** bypasses it for one move.
- **Remembered geometry.** Position, size, maximized state, and the snap preference are stored under `jumia_gh_dash_window` and restored on the next open, clamped to the current viewport.
- Escape now closes the dashboard, and the window stays within the viewport when the browser window is resized.

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
