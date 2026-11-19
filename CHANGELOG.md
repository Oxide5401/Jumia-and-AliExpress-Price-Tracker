# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions use `MAJOR.MINOR.PATCH`.

## [3.15.1] — 2026-11-19

### Fixed
- **Repeated glued words no longer hide similar listings.** Some Jumia titles contain a doubled token (`BatteriesBatteries Not Included`). The similar-item matcher now collapses an exact repeated half before comparing product-type words, so the Zarsyn 4-slot USB charger is found as an alternative to the Shebsheb charger instead of being silently dropped.
- **Similar-item notifications are labelled honestly.** A match that is only the same *type* of product now adds `Similar product, different brand/model.` to the notification body, so it is never mistaken for an exact same-product match. Exact matches are unchanged.

### Tests
- The matching suite now asserts both cited 4-slot USB chargers (Generic `300625276` and Zarsyn `300590769`) appear as `similar: true`, the cheapest is `GH₵ 89.00`, and a charging cable or bare AA/AAA cells are still rejected. Total: **32 jsdom cases**.

## [3.15.0] — 2026-11-19

### Added
- **Price-direction filter.** The dashboard toolbar gains **All / ↓ Price reduced / ↑ Price increased**. A direction choice is saved to `jumia_gh_dash_filter` and restored the next time the dashboard opens, alongside the remembered sort.
- **Parse-once history cache.** `peekHistory()` keeps the parsed history object until the raw stored string changes, so rendering rows, badges, and buttons no longer re-parses the full JSON for every lookup. Read-only callers use `peekHistory()`; writers still use `loadHistory()`.

### Changed
- **Retention raised to 5,000 products** (from 200), newest final sample first. The per-product 120-sample cap is unchanged.
- **Dashboard search is debounced** (120 ms), so typing does not rebuild the whole list on every keystroke.
- **Result-card scanning is capped at five attempts per card**, preventing an unparseable card from being rescanned forever on a heavy listing page.
- **Hidden-tab SPA guard.** AliExpress URL watching ignores navigation while the tab is hidden, so a background tab cannot record a half-rendered product.

### Fixed
- **Unreadable history is preserved.** If the stored JSON cannot be parsed, the raw value is copied to `jumia_gh_price_history_corrupt_backup` before the script continues with an empty view. A later save can no longer silently destroy the only copy.

## [3.14.0] — 2026-11-17

### Added
- **Deal analysis.** Opening a product's history now judges the current price against its own recorded samples (needs at least three samples over two days): *At its lowest recorded price*, *Close to its lowest price*, *Below its average price*, *Above average — consider waiting*, *Price has been stable*, or *Typical price*. The box shows the average, low, high, and the percentage of recorded prices the current price beats.
- **Deal flags and Best deals sort.** Rows gain `🔥 low`, `👍 good`, `⏳ wait`, and `🏷 inflated` flags. **Best deals** sorts by how far the current price sits below its own average.
- **Inflated "was" price warning.** When a listing claims a large discount but its "was" price is far above anything ever recorded, the history view explains that the claimed saving is not supported by the price history.
- **Set target to the low.** One click sets a product's target to its recorded low, after which the target button and smart-watch scheduling use it.
- **Reference lines.** The history chart draws dashed **avg** and **🎯 target** lines and extends its Y range to include the target.
- **Old prices from result cards.** Card tracking now stores the visible pre-discount price (`op`) when the card shows one, so deal analysis has the same data as a product-page visit.

### Changed
- **JSON-LD price extraction keeps the visible "was" price.** When JSON-LD and visible DOM agree on the current price, the DOM's pre-discount price is borrowed for the inflated-discount check.

## [3.13.1] — 2026-11-16

Consolidated release covering every change since 3.11.1.

### Added
- **Similar items across brands.** A second, looser matcher compares product-*type* words after removing brand, model numbers, capacities, colours, and marketing filler. It finds fair alternatives such as another 4-slot USB battery charger from a different brand, while still rejecting accessories and variant conflicts. Such matches are stored with `similar: true`.
- **Two catalogue queries.** Each alternative check now searches a short core query (brand/model/type) and a wider type query, merging both result pages. This finds listings that omit the brand or reorder the title. Queries are spaced so the catalogue is not hammered.
- **Cheaper-alternative details in the dashboard.** The history view lists every stored alternative with its price, saving, and a `similar` badge, instead of only the single best match.
- **Green "cheaper listing" light.** The floating panel now shows a small pulsing green light when a cheaper exact or similar listing exists, with the price, saving, and a click target for the dashboard. The old always-visible alternatives block is gone.
- **Icon-only price-tag track buttons.** The **Track price** control on product pages and result cards is now a price-tag SVG styled after the wishlist heart, with no visible text. It keeps an accessible label (`Track price` / `Tracked — open dashboard`), fills orange when tracked, and matches the heart's size on product pages.
- **Update items pass.** A dashboard button re-reads up to 40 tracked Jumia pages per click, oldest/outdated first, filling in brand, image, Express/abroad fulfilment, and re-running alternative searches. Products carry `dv` (`DATA_VERSION = 3`) so older entries are prioritised; AliExpress items are reported as visit-only.
- **Panel position stays grabbable.** Dragging the panel past a viewport edge keeps a 60 px strip on screen, so the header cannot be stranded off-screen.

### Changed
- Alternative notifications distinguish **Cheaper similar item on Jumia** from an exact **Cheaper alternative on Jumia**, and the dashboard badge links the matching listing.
- The panel's current-price line includes the visible pre-discount price (`was …`) when the page exposes one.
- Track buttons are keyed by the product in their own card and synchronised from storage after any record, delete, or background update.

## [3.11.1] — 2026-11-16

### Added
- **One-click tracking from result cards.** Every product card on Jumia listing/search/category pages gets a compact **Track price** button directly under its wishlist heart. Clicking it records that card's name, price, image, brand, and Express/abroad badge without opening the product, then opens the dashboard. Tracked cards read **Tracked — open** and simply open the dashboard; no duplicate sample is added.
- **Lazy-loaded results are covered.** A debounced `MutationObserver` re-scans the page when infinite scroll or a filter inserts more cards, so new results get buttons too.
- **Panel hint on listing pages.** The panel now says *Use 💰 Track price on a result card, or open a product*, and the alternatives block explains the same instead of waiting for a product price.

### Changed
- Track buttons are now keyed by the product in their own card (`data-key`), and `syncTrackButtons()` refreshes every injected button from storage after any record, delete, or background update.
- Product keys can be derived from any URL (`productKeyFromUrl`), so listing-card links and the current page share one identity scheme.

### Tests
- Three new jsdom cases (28 total): adding from a listing card stores a `src: "card"` sample with the card's fulfilment, clicking an already tracked card opens the dashboard without duplicating a sample, and an infinite-scroll card receives a button after the debounced rescan.

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
