# Architecture

This document describes how the userscript is organised, how data flows through it, and where to add features safely.

The whole program is one IIFE in `jumia-aliexpress-price-tracker.user.js`. There is no build step; the committed file is exactly what users install.

---

## 1. High-level flow

```
page load (document-end)
        │
        ├─ purgeInvalidCoupons()        clean legacy junk
        ├─ createPanel()                floating UI
        ├─ updateTrackedBadge()
        ├─ scanCurrentPageForCoupons()  page-derived codes
        ├─ renderCoupons()
        ├─ refreshCouponsFromWeb()      background, 6h TTL
        ├─ watchSpaNavigation()         AliExpress in-page URL changes
        │
        └─ if product page:
             trackCurrentPage()
                └─ extract → recordPrice() → updatePanel() → notifyDrop()
```

Coupons are handled on every page. Product tracking only runs on pages that match the site's product-page pattern.

---

## 2. Module map

The file is divided into nine commented sections:

| Section | Responsibility | Key functions |
| --- | --- | --- |
| 1 | Site detection + config | `SITES`, `SITE`, `IS_ALI`, `CONFIG` |
| 2 | Utilities | `parsePrice`, `detectCurrency`, `formatMoney`, `formatPrice`, `getProductKey`, `escapeHtml`, `truncate`, `displayName`, `setThumb`, `timeAgo`, `copyToClipboard` |
| 3 | Price + image extraction | `cleanUrl`, `absoluteImage`, `productNodesOf`, `imageFromDoc`, `extractImage`, `extractFromJsonLd`, `extractFromDomJumia`, `extractFromDomAliExpress`, `extractFromAliExpressState`, `extractFromMeta`, `extractPrice` |
| 4 | Price storage | `loadHistory`, `saveHistory`, `mergeHistoryData`, `recordPrice` |
| 5 | Coupons | validation sets, `extractCouponsFromDom`, `mergeCoupons`, `loadCoupons`, `saveCoupons`, `purgeInvalidCoupons`, `fetchHtml`, `refreshCouponsFromWeb`, `scanCurrentPageForCoupons`, `rankCoupons` |
| 6 | Main panel | `createPanel`, `updateTrackedBadge`, `updatePanel`, `renderCoupons` |
| 7 | Tracked-products dashboard | `backfillImages`, `openTrackedModal`, `renderTrackedModal` |
| 8 | Notifications | `notify`, `notifyDrop` |
| 9 | Main / bootstrap | `isProductPage`, `trackCurrentPage`, `watchSpaNavigation`, `init` |

---

## 3. Site abstraction

```js
const SITES = [
  {
    id: 'jumia',
    label: 'Jumia Ghana',
    shortLabel: 'Jumia GH',
    currency: 'GHS',
    keyPrefix: '',
    match: h => /(^|\.)jumia\.com\.gh$/.test(h),
    couponPageUrls: [...],
    extractAttempts: 20,
    extractDelayMs: 500,
    firstExtractDelayMs: 800,
  },
  { /* aliexpress: keyPrefix 'ali:', stricter retry budget */ },
];
```

`SITE` is selected from `location.hostname`; `IS_ALI` is a cached boolean. Anything site-dependent should be read from `SITE` rather than branched on the hostname.

Adding a third site requires:

1. A `SITES` entry (`id`, labels, currency, key prefix, matcher, coupon URLs, retry settings).
2. `@match` and `@connect` entries in the userscript header.
3. An extraction branch/selectors in section 3.
4. Product-page detection in `isProductPage`.

Storage compatibility: use a unique `keyPrefix` so product keys do not collide across sites.

---

## 4. Product identity

```js
function getProductKey() {
  const path = new URL(location.href).pathname;
  if (IS_ALI) {
    const m = path.match(/\/(?:item|i)\/(\d+)/);
    return SITE.keyPrefix + (m ? m[1] : path);
  }
  const m = path.match(/([a-zA-Z0-9\-]+)\.html$/);
  return m ? m[1] : path;
}
```

- **Jumia:** URL slug, e.g. `samsung-galaxy-a15-128gb`.
- **AliExpress:** `ali:` + numeric item ID, e.g. `ali:1005006187992416`.

Keys are the primary keys of the history object and are visible in Export JSON. Changing the key scheme orphans existing samples, so it is a breaking change.

---

## 5. Price extraction

`extractPrice()` returns:

```js
{ price: number, currency?: string, oldPrice?: number|null,
  name?: string, availability?: string, source: 'dom'|'json-ld'|'state'|'meta' }
```

### Jumia order
1. `extractFromDomJumia()` — `.prc` and related selectors.
2. `extractFromJsonLd()` — first positive `Offer.price`.
3. `extractFromMeta()` — product/Open Graph price meta tags.

### AliExpress order
1. `extractFromDomAliExpress()` — current-price/price-container/gallery classes.
2. `extractFromAliExpressState()` — scans embedded script/state content.
3. `extractFromJsonLd()`.
4. `extractFromMeta()`.

`parsePrice` takes the **first** number in a string and normalises separators:

- `1,234.56` → `1234.56`
- `1.234,56` → `1234.56`
- `GHS 20.00 - 35.00` → `20.00`

`detectCurrency` looks for symbols and ISO codes; it falls back to `SITE.currency`. There is no FX conversion anywhere.

### Retry loop
`trackCurrentPage()` records at most one product at a time using `trackingKey`; each attempt checks whether the URL still points at the same product (important for the AliExpress SPA). It stops after `CONFIG.extractAttempts` and logs a warning.

---

## 6. Price storage

```js
history = {
  [productKey]: {
    name, url, site, currency, image?, created,
    samples: [{ p, op?, t, src }],
  }
}
```

- Stored as a JSON string under `CONFIG.storageKey` (`jumia_gh_price_history`).
- `saveHistory` trims to the 200 products with the newest final sample (`maxProducts`).
- `recordPrice` trims each product to the last 120 samples (`maxSamplesPerProduct`).
- Names are cleaned of zero-width characters and only overwrite an existing name when non-empty.
- `image` is only overwritten when a new image URL is found, so a failed extraction cannot erase a good one.

### Merge semantics
`mergeHistoryData(incoming)`:

- Adds unknown product keys verbatim.
- For known keys, appends samples whose `t` is not already present, re-sorts, and re-trims.
- Fills missing `name`, `url`, `currency`, `site`, `image`; keeps the earliest `created`.
- Ignores products without a non-empty `samples` array.
- Never deletes existing data.

This is the basis of Import JSON and is intentionally tolerant of partial or legacy exports.

---

## 7. Product images

```js
absoluteImage(url, base)   // resolve + filter non-http(s), data:, chrome-like URLs
productNodesOf(doc)        // JSON-LD Product nodes, including @graph
imageFromDoc(doc, base, isAliPage)
extractImage()             // live page, cached per URL
```

`imageFromDoc` order:

1. Meta: `og:image:secure_url`, `og:image`, `twitter:image`.
2. JSON-LD `Product.image` (string, array, or `ImageObject`).
3. Gallery DOM selectors, site-aware (`#imgs img` for Jumia; `Product_Gallery`, `gallery`, `main-image` for AliExpress).

`extractImage` caches by `location.href`, so the SPA can rely on it after navigation. Tracking stores the URL in `product.image`.

`backfillImages(limit)`:

- Selects products with no image and an `http(s)` URL.
- Fetches pages through `fetchHtml` (`GM_xmlhttpRequest`).
- Parses with `DOMParser` and calls `imageFromDoc(doc, product.url, isAliTarget)`.
- Runs two workers, 250 ms apart, up to `limit` products per click.
- Returns `{ ok, failed, remaining, total }` for the dashboard alert.

AliExpress frequently serves a challenge page to these requests; failures are expected and logged, not fatal.

---

## 8. Coupons

Extraction is deliberately conservative:

1. Collect candidate code/context pairs from DOM text, `data-*` attributes, and nearby elements.
2. Reject candidates by length/charset and an exact-noise dictionary (`CODE`, `OFF`, `SAVE`, …).
3. Deduplicate by normalised code.
4. Merge into the per-site store with hit counts and first/last-seen timestamps.
5. Rank with `rankCoupons(productName)`: recency, expiry proximity, product-token matches, site-wide wording, free shipping, hits.

Per-site storage keys live in `CONFIG`, derived from `IS_ALI`. `purgeInvalidCoupons()` removes entries that older versions may have stored incorrectly.

Web sync honours `CONFIG.couponCacheTTLMs` (6 hours) unless forced by **Find Coupons**. `fetchHtml` uses `GM_xmlhttpRequest` with a 15 s timeout and the browser's user agent.

---

## 9. UI

### Panel (`createPanel`)
- Fixed, bottom-right, isolated by a unique ID.
- One `GM_addStyle` block; explicit colours and `color-scheme: only light`.
- `updatePanel(result)` sets the product name (`displayName`), thumbnail (`setThumb`), current price, stats, and drop message.
- `renderCoupons()` rebuilds the coupon list from the cache on demand.
- Buttons wire directly to `recordPrice`, `refreshCouponsFromWeb`, storage clears, and the dashboard.

### Dashboard (`openTrackedModal` / `renderTrackedModal`)
- Modal with a fixed backdrop, toolbar, list, import overlay, and footer actions.
- Rows are generated from history; sorting/filtering happens in memory and re-renders the list only.
- Per-row markup uses three deliberate patterns:
  - **Name:** `<span class="jtm-name-text">` for text + absolutely positioned `<a class="jtm-name-link">` overlay. This survives CSS that hides anchor text.
  - **Thumbnail:** `<span class="jtm-thumb">` containing an `<img>` or the 🛍 placeholder.
  - **Tag:** `<span class="jtm-tag">` with an `.ali` modifier for AliExpress.
- A capture-phase `error` listener on the modal swaps broken images for the placeholder (image `error` events do not bubble).
- Footer actions: Export, Import (merge), Fetch images, Clear All.

### Escaping
All page/history-derived strings pass through `escapeHtml` before interpolation into template strings. Image URLs are attribute-escaped and scheme-filtered at capture time.

---

## 10. Notifications

`notifyDrop(result)` compares the new sample to the previous one. At or above `CONFIG.dropThresholdPercent` (5%), it notifies via `GM_notification` or the Web Notifications API. Notification failures are non-fatal.

---

## 11. Design constraints (do not break)

- **Script identity is storage identity.** `@name` and `@namespace` must remain byte-identical to the original 3.2.0 values, including the en dash.
- **No external dependencies.** The userscript must run standalone; no CDN imports or bundlers.
- **Only declared hosts.** Network access must stay within `@connect`.
- **No text-only links in UI.** Anchor text may be hidden by the host page; use a span plus an overlay link.
- **Explicit colours.** Form controls and UI text need explicit `color`/`background` so dark-mode extensions and UA dark schemes cannot erase them.
- **Never destroy data silently.** Merge instead of replace; only overwrite a field when the new value is valid.
- **Escape before injecting.** Every interpolated value is treated as untrusted.

---

## 12. Extension points

| Goal | Where to change |
| --- | --- |
| Add a site | `SITES`, header matches/connects, extraction chain, `isProductPage` |
| Fix a broken selector | `extractFromDomJumia` / `extractFromDomAliExpress` / gallery selectors |
| Improve price parsing | `parsePrice`, `detectCurrency` |
| Add a dashboard column | `renderTrackedModal` row template + `.jtm-row` grid CSS |
| Add a stored field | `recordPrice`, `mergeHistoryData`, row/panel renderers, Export docs |
| Change retention | `CONFIG.maxSamplesPerProduct`, `CONFIG.maxProducts` |
| Change notification policy | `CONFIG.dropThresholdPercent`, `notifyDrop` |
| Add import formats | `mergeHistoryData` |

After any change: run `node --check`, exercise the affected flow with stubbed GM APIs, and update `CHANGELOG.md`.
