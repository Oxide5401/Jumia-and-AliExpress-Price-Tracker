# Testing

The script has no test runner or CI. This document defines the checks used before each release and gives copy-paste harness patterns for the critical paths.

---

## 1. Static checks

```bash
node --check jumia-aliexpress-price-tracker.user.js
```

Confirm the header is intact:

- `@name` and `@namespace` are **byte-identical** to the original 3.2.0 values (the name contains an en dash `–`).
- `@version` matches the entry in `CHANGELOG.md`.
- Every network host used in code appears in `@connect`.
- No `eval`, remote imports, or unescaped page strings in HTML templates.

A quick identity check on Windows:

```powershell
$old = "path\to\Jumia Ghana – ...-3.2.0.user.js"
$new = "jumia-aliexpress-price-tracker.user.js"
$a = [System.IO.File]::ReadAllLines($old)
$b = [System.IO.File]::ReadAllLines($new)
($a[1] -ceq $b[1])  # @name
($a[2] -ceq $b[2])  # @namespace
```

---

## 2. jsdom harness

Use jsdom to run the real userscript against synthetic pages, with the GM APIs stubbed.

```bash
npm install jsdom
node tests/smartwatch.test.cjs
```

```js
const fs = require('fs');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync('jumia-aliexpress-price-tracker.user.js', 'utf8');
const dom = new JSDOM(`<!doctype html><html><head>
  <meta property="og:image" content="https://example.com/p.jpg">
</head><body>
  <h1 class="name">Test Product 128GB</h1>
  <div class="prc">GH₵ 1,299.00</div>
</body></html>`, {
  url: 'https://www.jumia.com.gh/test-product-128gb.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;

const store = { jumia_gh_price_history: '{}', jumia_gh_coupons: '[]' };
w.GM_getValue = (k, d) => (k in store ? store[k] : d);
w.GM_setValue = (k, v) => { store[k] = v; };
w.GM_addStyle = css => {
  const s = w.document.createElement('style');
  s.textContent = css;
  w.document.head.appendChild(s);
};
w.GM_notification = () => {};
w.GM_xmlhttpRequest = o => setTimeout(() => o.onerror && o.onerror(new Error('stub')), 0);
w.confirm = () => false;
w.alert = () => {};

w.eval(code);

setTimeout(() => {
  const h = JSON.parse(store.jumia_gh_price_history);
  console.log(h['test-product-128gb']); // price, name, image, sample
  w.close();
}, 1600);
```

Notes:

- Use `.cjs` files: this environment treats `.js` as ESM.
- `firstExtractDelayMs` is 800 ms on Jumia and 1200 ms on AliExpress; wait accordingly.
- Image `<img>` elements do not load by default in jsdom; assert `src`/`alt` attributes, not pixels.
- Stub `GM_xmlhttpRequest` per test to return canned HTML or an HTTP error.
- For scheduler tests, capture `window.setTimeout` into a queue, replace `window.Date.now` with a controllable clock, and run queued callbacks manually. Enable the watch by setting `jumia_gh_smart_watch` to `true` and seeding `jumia_gh_smart_watch_state` (rather than relying on randomized seeding).
- `switchToOffline`/hidden-tab behaviour can be tested by setting `document.visibilityState` via `Object.defineProperty` or by removing `pretendToBeVisual`.

---

## 3. Automated regression checklist

These are the assertions worth keeping when changing extraction, storage, or UI.

### Price parsing
- `1,234.56` → `1234.56`
- `1.234,56` → `1234.56`
- `GHS 20.00 - 35.00` → `20.00`
- Non-numeric input → `null`

### Extraction
- Jumia DOM price wins over JSON-LD when both exist.
- Jumia JSON-LD is used when DOM selectors are absent.
- Meta price is the last resort.
- AliExpress state extraction works when the DOM price class is missing.
- Zero/negative/NaN prices are rejected.
- `cleanName` strips zero-width characters; blank names do not overwrite stored names.

### Storage
- `recordPrice` creates a product with `name`, `url`, `site`, `currency`, `image`, and one sample.
- A second record appends a sample and updates `image` only when a new URL exists.
- Retention caps at 120 samples; `saveHistory` caps at 200 products, newest final sample first.
- `mergeHistoryData` appends only unseen timestamps, preserves the earliest `created`, fills missing fields, ignores garbage, and never deletes.

### Images
- `og:image` is preferred; relative JSON-LD image URLs are resolved against the page.
- Logos/sprites/data URLs are rejected.
- A product with an image renders `<img>`; one without renders the 🛍 placeholder.
- `backfillImages` stores an image for a product whose fetched page has metadata, and leaves a 403 page without an image.
- A simulated `error` event swaps a broken thumbnail for the placeholder (capture-phase listener).

### UI
- Panel shows the product name and thumbnail after `updatePrice`/tracking.
- Dashboard lists all products, filters by name, and sorts by recent changes/recent/drop/rise/price/name.
- Site tags render correctly (`Jumia` grey, `AliExpress` red).
- Export produces parseable JSON; Import → Merge reports the correct product/sample counts.
- Under hostile CSS (`a { color: transparent !important; -webkit-text-fill-color: transparent !important }`), names, tags, and the footer buttons remain visible.
- Target button shows `🎯 set` when unset, the formatted target when set, and a green `.met` state at/below target.
- A movement within 7 days renders a `.jtm-flag.down|up` badge with the percentage, and the row gains `.jtm-row.changed`. Older movement shows no badge.
- `latestChange` ignores a later unchanged sample and still reports the earlier movement.

### Smart watch
- **304:** a stored `ETag` is sent as `If-None-Match`; a `304` adds no sample, increments misses, and pushes `nextCheck` forward.
- **Budget:** after `maxChecksPerDay` (40) checks, ticks stop issuing product requests until the calendar day changes.
- **Canaries:** changing two canaries within the campaign window sets `campaignUntil`; a single change does not.
- **Priority:** a near-target product is chosen ahead of a quiet non-canary; an at-target product is not polled.
- **AliExpress:** with `fetchAliExpress: false`, AliExpress products produce zero background requests and the status line explains "visit-only".
- **Visit sync:** loading a product page with the watch off still refreshes that product's `lastCheck`/`nextCheck` in `jumia_gh_smart_watch_state`.
- **Merge:** importing a product that lacks a target but whose export includes one stores the target.
- **Open dashboard refresh:** a change found by a background tick re-renders an open dashboard in place, moves the product to the top under **Recent**, adds the change badge, and preserves the current search text, sort choice, and scroll position. Dispatching `visibilitychange` after another tab writes a new sample produces the same refresh.
- **Politeness:** no more than one request is in flight, `minGapMs` is respected, and 403/429 responses set `hosts[host].blockedUntil`.

---

## 4. Headless render check

Build a harness page that seeds `GM_getValue` with sample history, loads the script inline, and clicks the 📊 button. Then screenshot with Edge/Chrome:

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=800,900 --virtual-time-budget=4000 \
  --screenshot="out.png" "file:///C:/path/to/harness.html"
```

Look for:

- names visible (no text-only anchors),
- thumbnails or placeholder present in every row,
- footer buttons readable,
- price columns aligned,
- change badge does not push the name into an unreadable wrap,
- no horizontal overflow at 720 px modal width.

To test dark mode and anchor-hostile environments, inject this before the script:

```html
<style>
  a { color: transparent !important; -webkit-text-fill-color: transparent !important; }
  @media (prefers-color-scheme: dark) { html { color-scheme: dark; } }
</style>
```

The UI must remain readable.

---

## 5. Manual checklist (before release)

### Jumia
- [ ] Load a product page: panel appears, name and thumbnail are correct, one sample recorded.
- [ ] Refresh twice: samples increment, low/high/change update.
- [ ] Visit a different product: new entry, no duplicate samples for the first.
- [ ] Open dashboard: rows sort/filter, delete works, Export copies JSON.
- [ ] Change price via DevTools before Refresh: drop notification fires at ≥5%.
- [ ] Coupons: **Find Coupons** populates the list; clicking a code copies it; **all** toggles.
- [ ] **Fetch images** fills thumbnails for products without images; a second click resumes.
- [ ] Open dashboard → tick **Smart watch**: status shows `0/40 checks today · 3 canaries · next in …`.
- [ ] Click **Check now**: one product request appears in DevTools, the status budget increments, and the row's current price reflects the result.
- [ ] With the dashboard open and sorted by **Recent**, make a background check detect a lower price: the row moves to the top during the refresh, shows a `↓x.x%` badge, and keeps your search text, sort, and scroll position.
- [ ] Select **Recent changes**: products with the newest real movements come first, even if a later unchanged check appended a baseline sample.
- [ ] The change badge disappears after 7 days (temporarily lower `changeHighlightMs` to verify).
- [ ] Set a target via 🎯: badge appears; a target already met renders green and the product stops being scheduled.
- [ ] Reload after a background check: the new sample survives and shows `src: "watch"` in Export JSON.
- [ ] Leave the tab hidden: no new requests. Return to the tab: checks resume.
- [ ] Untick **Smart watch**: no further scheduled requests.

### AliExpress
- [ ] Load an item page: `AliExpress` badge, name, price, and GHS formatting.
- [ ] Navigate item → item inside the SPA: second item is tracked without a reload.
- [ ] Revisit an item: sample appended, `lastTrackedKey` prevents duplicates.
- [ ] Thumbnail appears when the item is visited (backfill may fail by design).
- [ ] Coupons: page scan finds `Code：AE10`-style codes; coupon-page fetch is login-gated.
- [ ] Dashboard status explains that AliExpress is visit-only, and no background requests hit `aliexpress.com`.

### Data safety
- [ ] Install over 3.2.0: tracked count and coupons survive (no uninstall).
- [ ] Export → Clear All → Import → Merge: full history restored, duplicates absent.
- [ ] Two exports imported in reverse order yield the same merged data.
- [ ] Reloading after an update preserves `image` fields.

### Cross-environment
- [ ] Chrome/Edge with Tampermonkey, and Violentmonkey if available.
- [ ] With a forced-dark extension enabled.
- [ ] Window narrowed to mobile width: panel fits, dashboard scrolls.

---

## 6. Troubleshooting test results

| Symptom | Likely cause |
| --- | --- |
| No samples recorded | product-page regex does not match the URL, or all extractors returned no price |
| Name blank but tooltip correct | CSS hides anchor text or sets a transparent colour; check the span/overlay markup is present |
| Image always placeholder | `image` missing from history (run **Fetch images**) or `absoluteImage` rejected the URL |
| AliExpress backfill always fails | expected: challenge page from `GM_xmlhttpRequest` |
| Coupons never appear | strict validation rejected them, or the site changed markup; check `[Price Tracker]` console logs |
| Import says 0 merged | JSON shape is not an object of products, or samples are empty |
| Smart watch never checks | watch is off, budget exhausted, tab hidden, host backing off, or all products are AliExpress/at-target |
| Smart watch checks too often | lower `maxChecksPerDay`, raise `minIntervalMs`, or set targets to retire aspirational products |

Include browser, userscript manager version, site, URL shape, and console output in bug reports.
