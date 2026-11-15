/* Smart-watch regression tests (jsdom, no network). */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(
    path.join(__dirname, '..', 'jumia-aliexpress-price-tracker.user.js'),
    'utf8'
);
const HISTORY_KEY = 'jumia_gh_price_history';
const WATCH_KEY = 'jumia_gh_smart_watch';
const STATE_KEY = 'jumia_gh_smart_watch_state';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const realNow = Date.now();
const today = new Date().toDateString();

function flush(n = 5) {
    return new Promise(async resolve => {
        for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
        resolve();
    });
}

async function makeEnv({ url = 'https://www.jumia.com.gh/', storage = {}, responses = {}, html = '<!doctype html><html><body></body></html>' } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    const store = new Map(Object.entries(storage));
    const clock = { now: realNow };
    const timers = [];
    const requests = [];
    let timerId = 0;

    win.GM_getValue = (k, d) => store.has(k) ? store.get(k) : d;
    win.GM_setValue = (k, v) => { store.set(k, v); };
    win.GM_addStyle = () => {};
    win.__notifications = [];
    win.GM_notification = o => { win.__notifications.push(o); };
    win.__alerts = [];
    win.alert = m => { win.__alerts.push(String(m)); };
    win.confirm = () => true;
    win.prompt = () => null;

    const RealDate = win.Date;
    win.Date = class extends RealDate {
        static now() { return clock.now; }
    };

    win.setTimeout = (fn, ms = 0, ...args) => {
        const id = ++timerId;
        timers.push({ id, fn, at: clock.now + (ms || 0), args, src: String(fn).replace(/\s+/g, ' ').slice(0, 90), ms });
        return id;
    };
    win.clearTimeout = id => {
        const i = timers.findIndex(t => t.id === id);
        if (i >= 0) timers.splice(i, 1);
    };
    win.setInterval = () => 0;

    // jsdom does not implement innerText; coupon extraction uses it for the
    // page-body tier, so map it to textContent.
    try {
        Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
            get() { return this.textContent; },
            set(v) { this.textContent = v; },
            configurable: true,
        });
    } catch { /* keep the native implementation */ }

    win.GM_xmlhttpRequest = opts => {
        requests.push(opts);
        const resp = typeof responses === 'function' ? responses(opts.url, opts) : responses[opts.url];
        Promise.resolve().then(() => {
            if (!resp) {
                if (opts.onerror) opts.onerror(new Error('no fake response for ' + opts.url));
                return;
            }
            if (opts.onload) opts.onload({
                status: resp.status == null ? 200 : resp.status,
                responseText: resp.text || '',
                responseHeaders: resp.headers || '',
                finalUrl: resp.finalUrl || '',
            });
        });
    };

    win.eval(SCRIPT);
    // init() can run on DOMContentLoaded; let it finish before tests arm timers.
    await flush();
    return { dom, win, store, timers, requests, clock };
}

async function runDue(env, advanceMs = 0) {
    env.clock.now += advanceMs;
    const due = env.timers
        .filter(t => t.at <= env.clock.now)
        .sort((a, b) => a.at - b.at)[0];
    if (!due) return false;
    env.timers.splice(env.timers.indexOf(due), 1);
    try { due.fn(...due.args); } catch (e) { throw e; }
    await flush();
    return true;
}

function productReqs(env) {
    return env.requests.filter(r =>
        /^https:\/\/(www\.)?(jumia\.com\.gh|aliexpress\.com)\/.*\.html/.test(r.url) ||
        /aliexpress\.com\/item\//.test(r.url)
    );
}

function loadJSON(env, key) {
    return JSON.parse(env.store.get(key) || '{}');
}

function loadCoupons(env) {
    try { return JSON.parse(env.store.get('jumia_gh_coupons') || '[]'); }
    catch { return []; }
}

function couponMap(env) {
    return Object.fromEntries(loadCoupons(env).map(c => [c.code, c]));
}

function seedHistory(products) {
    return { [HISTORY_KEY]: JSON.stringify(products) };
}

function stateWith(products, extra = {}) {
    return {
        products,
        hosts: {},
        canaries: {},
        budget: { day: today, used: 0 },
        campaignUntil: 0,
        campaignSince: 0,
        lastRequestAt: 0,
        lease: null,
        ...extra,
    };
}

function page(price, name = 'Test Product', url = '') {
    return `<!doctype html><html><head><title>${name}</title>
<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name,
        url,
        offers: { '@type': 'Offer', price: String(price), priceCurrency: 'GHS', availability: 'InStock' },
    })}</script></head><body></body></html>`;
}

async function openDashboard(env) {
    const btn = env.win.document.querySelector('#price-tracker-panel .jpt-tracked-btn');
    assert(btn, 'dashboard button exists');
    btn.click();
    await flush();
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── 1. Conditional GET: 304 costs no sample and backs off ──────────────
test('304 keeps history unchanged and reschedules', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = { [key]: { name: 'One', url, site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: realNow - 2 * HOUR }], created: realNow - 9 * DAY } };
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith({
            [key]: { lastCheck: realNow - 8 * HOUR, nextCheck: 0, misses: 1, failures: 0, etag: '"abc"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT', lastPrice: 100, rechecksLeft: 0 },
        })),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({ storage, responses: { [url]: { status: 304, headers: 'ETag: "abc"\r\n' } } });
    await runDue(env, 20000);

    assert.strictEqual(productReqs(env).length, 1, 'one conditional request');
    const req = productReqs(env)[0];
    assert.strictEqual(req.headers['If-None-Match'], '"abc"');
    const h = loadJSON(env, HISTORY_KEY);
    assert.strictEqual(h[key].samples.length, 1, '304 must not add a sample');
    const s = loadJSON(env, STATE_KEY);
    assert.strictEqual(s.products[key].misses, 2, 'misses incremented');
    assert(s.products[key].nextCheck > env.clock.now, 'nextCheck pushed into the future');
    assert.strictEqual(s.budget.used, 1, 'budget counted');
});

// ── 2. Daily budget is a hard stop ─────────────────────────────────────
test('daily budget caps background requests at 40', async () => {
    const history = {}, metas = {};
    for (let i = 0; i < 45; i++) {
        const url = `https://www.jumia.com.gh/item-${i}.html`;
        history[`p${i}`] = { name: `Item ${i}`, url, site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: realNow - HOUR }], created: realNow - 20 * DAY };
        metas[`p${i}`] = { lastCheck: realNow - 2 * HOUR, nextCheck: 0, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 100, rechecksLeft: 0 };
    }
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith(metas, { campaignUntil: realNow + 24 * HOUR, campaignSince: realNow - 3 * HOUR })),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({
        storage,
        responses: url => ({ status: 200, text: page(100, 'Item', url) }),
    });
    await runDue(env, 13000); // first scheduled tick
    for (let i = 0; i < 60; i++) await runDue(env, 7 * 60 * 1000);

    assert.strictEqual(productReqs(env).length, 40, 'exactly 40 product requests');
    const s = loadJSON(env, STATE_KEY);
    assert.strictEqual(s.budget.used, 40, 'budget recorded');
});

// ── 3. Two canary changes trigger a campaign ───────────────────────────
test('two canary changes trigger a campaign signal', async () => {
    const history = {}, metas = {}, responses = {};
    for (let i = 0; i < 3; i++) {
        const url = `https://www.jumia.com.gh/c${i}.html`;
        history[`c${i}`] = {
            name: `Canary ${i}`, url, site: 'jumia', currency: 'GHS',
            samples: [
                { p: 110, t: realNow - 30 * HOUR },
                { p: 105, t: realNow - 20 * HOUR },
                { p: 100, t: realNow - 2 * HOUR },
            ],
            created: realNow - 30 * DAY,
        };
        metas[`c${i}`] = { lastCheck: realNow - 7 * HOUR, nextCheck: 0, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 100, rechecksLeft: 0 };
        responses[url] = { status: 200, text: page(90, `Canary ${i}`, url) };
    }
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith(metas)),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({ storage, responses });
    await runDue(env, 20000);
    await runDue(env, 7 * 60 * 1000);
    await runDue(env, 7 * 60 * 1000);

    const s = loadJSON(env, STATE_KEY);
    assert.strictEqual(productReqs(env).length, 3, 'three canaries checked');
    assert(s.campaignUntil > env.clock.now, 'campaign active');
    assert(Object.keys(s.canaries).length >= 2, 'canary signals recorded');
});

// ── 4. Near-target product wins; a distant quiet one waits ─────────────
test('target-near product is prioritised over a quiet one', async () => {
    const history = {}, metas = {};
    for (let i = 0; i < 10; i++) {
        const key = i === 0 ? 'target' : `q${i}`;
        const url = `https://www.jumia.com.gh/${key}.html`;
        const lastT = i === 0 ? realNow - 10 * DAY : realNow - HOUR * (i + 1);
        history[key] = {
            name: key, url, site: 'jumia', currency: 'GHS',
            samples: [{ p: 100, t: lastT }], created: lastT,
            ...(i === 0 ? { target: 95 } : {}),
        };
        // Canaries (most recent quiet items) are not due in this test.
        metas[key] = {
            lastCheck: i === 0 || i === 4 ? realNow - 3 * HOUR : realNow - HOUR,
            nextCheck: i === 0 || i === 4 ? 0 : realNow + 7 * DAY,
            misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 100, rechecksLeft: 0,
        };
    }
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith(metas)),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({
        storage,
        responses: url => ({ status: 200, text: page(100, 'x', url) }),
    });
    await runDue(env, 20000);

    const reqs = productReqs(env);
    assert.strictEqual(reqs.length, 1, 'only one check');
    assert(reqs[0].url.endsWith('/target.html'), 'checked the near-target product, got ' + reqs[0].url);

    await openDashboard(env);
    const targetBtn = env.win.document.querySelector('.jtm-target');
    assert(targetBtn && targetBtn.classList.contains('set'), 'target badge rendered');
});

// ── 5. AliExpress is never fetched in the background ───────────────────
test('AliExpress products are skipped and explained', async () => {
    const key = 'ali:123';
    const url = 'https://www.aliexpress.com/item/123.html';
    const history = { [key]: { name: 'Ali thing', url, site: 'aliexpress', currency: 'GHS', samples: [{ p: 50, t: realNow - HOUR }], created: realNow - DAY } };
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith({ [key]: { lastCheck: 0, nextCheck: 0, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 50, rechecksLeft: 0 } })),
        aliexpress_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({ url: 'https://www.aliexpress.com/', storage, responses: {} });
    await runDue(env, 13000);
    await runDue(env, 7 * 60 * 1000);

    assert.strictEqual(productReqs(env).length, 0, 'no AliExpress fetch');
    await openDashboard(env);
    const status = env.win.document.querySelector('.jtm-watch-status').textContent;
    assert(/visit-only/i.test(status), 'status explains visit-only, got: ' + status);
});

// ── 6. A normal visit updates scheduler metadata (watch off) ───────────
test('visiting a tracked product updates watch metadata with watch off', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = { [key]: { name: 'One', url, site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: realNow - 2 * HOUR }], created: realNow - 9 * DAY } };
    const storage = {
        ...seedHistory(history),
        [STATE_KEY]: JSON.stringify(stateWith({ [key]: { lastCheck: realNow - 20 * HOUR, nextCheck: realNow + 3 * DAY, misses: 1, failures: 0, etag: null, lastModified: null, lastPrice: 100, rechecksLeft: 0 } })),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({ url, storage, html: page(77, 'One', url) });
    // recordPrice is scheduled after firstExtractDelayMs; give it room.
    for (let i = 0; i < 6; i++) await runDue(env, 2000);

    const h = loadJSON(env, HISTORY_KEY);
    assert.strictEqual(h[key].samples.length, 2, 'visit recorded a sample');
    assert.strictEqual(h[key].samples.at(-1).p, 77);
    const s = loadJSON(env, STATE_KEY);
    assert(s.products[key].lastCheck > realNow - HOUR, 'lastCheck refreshed');
    assert.strictEqual(s.products[key].rechecksLeft, 2, 'change schedules rechecks');
    assert(s.products[key].nextCheck > env.clock.now, 'nextCheck in the future');
});

// ── 7. Import preserves/merges target price ────────────────────────────
test('import merges a target price into existing history', async () => {
    const key = 'p1';
    const history = { [key]: { name: 'One', url: 'https://www.jumia.com.gh/p1.html', site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: 1 }], created: 1 } };
    const storage = { ...seedHistory(history), jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({ storage });
    await openDashboard(env);
    const modal = env.win.document;
    modal.querySelector('.jtm-import').click();
    modal.querySelector('.jtm-import-ta').value = JSON.stringify({ [key]: { name: 'One', samples: [{ p: 90, t: 2 }], target: 88 } });
    modal.querySelector('.jtm-import-ok').click();
    await flush();

    const h = loadJSON(env, HISTORY_KEY);
    assert.strictEqual(h[key].samples.length, 2, 'sample merged');
    assert.strictEqual(h[key].target, 88, 'target merged');
});

// ── 8. A background change refreshes an open dashboard and flags the row ─
test('background price change updates and highlights the open dashboard', async () => {
    const alpha = 'alpha', beta = 'beta';
    const alphaUrl = 'https://www.jumia.com.gh/alpha.html';
    const betaUrl = 'https://www.jumia.com.gh/beta.html';
    const history = {
        [alpha]: {
            name: 'Alpha Phone', url: alphaUrl, site: 'jumia', currency: 'GHS',
            samples: [{ p: 100, t: realNow - 3 * HOUR }], created: realNow - 9 * DAY,
        },
        [beta]: {
            name: 'Beta Case', url: betaUrl, site: 'jumia', currency: 'GHS',
            samples: [{ p: 80, t: realNow - 2 * HOUR }], created: realNow - 9 * DAY,
        },
    };
    const metas = {
        [alpha]: { lastCheck: realNow - 9 * HOUR, nextCheck: 0, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 100, rechecksLeft: 0 },
        [beta]: { lastCheck: realNow - 9 * HOUR, nextCheck: realNow + 60000, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 80, rechecksLeft: 0 },
    };
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith(metas)),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({
        storage,
        responses: {
            [alphaUrl]: { status: 200, text: page(90, 'Alpha Phone', alphaUrl) },
            [betaUrl]: { status: 200, text: page(70, 'Beta Case', betaUrl) },
        },
    });
    await openDashboard(env);

    const doc = env.win.document;
    const names = () => [...doc.querySelectorAll('.jtm-row .jtm-name-text')].map(e => e.textContent);
    assert.deepStrictEqual(names(), ['Beta Case', 'Alpha Phone'], 'default Recent sort before the check');

    // First tick changes alpha (100 → 90); the dashboard is already open.
    await runDue(env, 20000);

    assert(doc.getElementById('price-tracker-modal'), 'dashboard stays open');
    assert.deepStrictEqual(names(), ['Alpha Phone', 'Beta Case'], 'changed product rises to the top');
    const alphaRow = doc.querySelector('.jtm-row.changed');
    assert(alphaRow, 'changed row is tinted');
    assert(alphaRow.classList.contains('down'), 'a drop is styled as down');
    const flag = alphaRow.querySelector('.jtm-flag.down');
    assert(flag, 'a change badge is rendered');
    assert(/10\.0%/.test(flag.textContent), 'badge shows the movement, got ' + flag.textContent);
    assert(/Alpha Phone/.test(alphaRow.textContent), 'badge belongs to the changed product');

    // Filter/sort choices survive the auto-refresh.
    const search = doc.querySelector('.jtm-search');
    search.value = 'Beta';
    search.dispatchEvent(new env.win.Event('input'));
    const sortSel = doc.querySelector('.jtm-sort');
    sortSel.value = 'changed';
    sortSel.dispatchEvent(new env.win.Event('change'));

    // Second tick changes beta (80 → 70); state must be preserved.
    await runDue(env, 7 * 60 * 1000);

    assert.strictEqual(doc.querySelector('.jtm-search').value, 'Beta', 'search text preserved');
    assert.strictEqual(doc.querySelector('.jtm-sort').value, 'changed', 'sort preserved');
    assert.deepStrictEqual(names(), ['Beta Case'], 'filter still applied after refresh');
    const betaFlag = doc.querySelector('.jtm-row.changed .jtm-flag.down');
    assert(betaFlag && /12\.5%/.test(betaFlag.textContent), 'beta badge shows the new movement');
});

// ── 9. Returning to a hidden tab re-reads history for an open dashboard ──
test('returning to the tab refreshes the dashboard after another tab changed a price', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = {
        [key]: { name: 'One', url, site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: realNow - 3 * HOUR }], created: realNow - 9 * DAY },
    };
    const storage = { ...seedHistory(history), jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({ storage });
    await openDashboard(env);

    assert(!env.win.document.querySelector('.jtm-flag'), 'no badge before the change');

    // Simulate another tab (or a smart-watch check) writing a new sample.
    const h = loadJSON(env, HISTORY_KEY);
    h[key].samples.push({ p: 88, t: env.clock.now, src: 'watch' });
    env.store.set(HISTORY_KEY, JSON.stringify(h));

    env.win.document.dispatchEvent(new env.win.Event('visibilitychange'));
    await flush();

    const row = env.win.document.querySelector('.jtm-row.changed');
    assert(row, 'row flagged as changed');
    assert(row.querySelector('.jtm-flag.down'), 'drop badge rendered');
    assert(/88/.test(row.querySelector('.jtm-cur').textContent), 'current price re-read');
});

// ── 10. Dashboard window controls: drag, snap, maximize, minimize, close ─
test('dashboard window controls drag, snap, maximize, minimize and persist geometry', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = {
        [key]: { name: 'One', url, site: 'jumia', currency: 'GHS', samples: [{ p: 100, t: realNow - HOUR }], created: realNow - DAY },
    };
    const storage = { ...seedHistory(history), jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({ storage });
    Object.defineProperty(env.win, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(env.win, 'innerHeight', { value: 700, configurable: true });
    await openDashboard(env);

    const doc = env.win.document;
    const content = doc.querySelector('.jtm-content');
    assert(content, 'window exists');
    for (const sel of ['.jtm-min', '.jtm-max-btn', '.jtm-close', '.jtm-resize']) {
        assert(doc.querySelector(sel), sel + ' control exists');
    }
    assert.strictEqual(content.style.width, '720px', 'default width');
    assert.strictEqual(content.style.height, '560px', 'default height');
    assert.strictEqual(content.style.left, '140px', 'centered horizontally');
    assert.strictEqual(content.style.top, '70px', 'centered vertically');

    const header = doc.querySelector('.jtm-header');
    const ptr = (type, x, y, extra = {}) => new env.win.MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra,
    });

    // Drag left; 10px from the edge snaps flush.
    header.dispatchEvent(ptr('pointerdown', 300, 90));
    env.win.dispatchEvent(ptr('pointermove', 170, 90));
    assert.strictEqual(content.style.left, '0px', 'snaps to the left edge');
    assert(content.classList.contains('jtm-snapped'), 'snap indicator shown');
    env.win.dispatchEvent(ptr('pointerup', 170, 90));
    assert.strictEqual(JSON.parse(env.store.get('jumia_gh_dash_window')).x, 0, 'geometry persisted');

    // Holding Alt bypasses snapping for free positioning.
    header.dispatchEvent(ptr('pointerdown', 300, 90));
    env.win.dispatchEvent(ptr('pointermove', 312, 90, { altKey: true }));
    assert.strictEqual(content.style.left, '12px', 'Alt bypasses edge snapping');
    env.win.dispatchEvent(ptr('pointerup', 312, 90));

    // The magnet toggle turns snapping off entirely, and back on.
    const snapBtn = doc.querySelector('.jtm-snap');
    assert.strictEqual(snapBtn.getAttribute('aria-pressed'), 'true', 'snapping defaults to on');
    snapBtn.click();
    assert.strictEqual(snapBtn.getAttribute('aria-pressed'), 'false', 'snapping can be turned off');
    header.dispatchEvent(ptr('pointerdown', 300, 90));
    env.win.dispatchEvent(ptr('pointermove', 388, 90)); // x = 12 + 88 = 100
    assert.strictEqual(content.style.left, '100px', 'no snap while disabled');
    env.win.dispatchEvent(ptr('pointerup', 388, 90));
    snapBtn.click();
    assert.strictEqual(snapBtn.getAttribute('aria-pressed'), 'true', 'snapping turned back on');
    header.dispatchEvent(ptr('pointerdown', 300, 90));
    env.win.dispatchEvent(ptr('pointermove', 210, 90)); // x = 10 => snap
    assert.strictEqual(content.style.left, '0px', 'snapping resumes');
    env.win.dispatchEvent(ptr('pointerup', 210, 90));

    // Maximize fills the viewport; restore returns to the normal rectangle.
    const maxBtn = doc.querySelector('.jtm-max-btn');
    maxBtn.click();
    assert(content.classList.contains('jtm-max'), 'maximized class');
    assert.strictEqual(content.style.width, '1000px');
    assert.strictEqual(content.style.height, '700px');
    assert.strictEqual(content.style.left, '0px');
    maxBtn.click();
    assert(!content.classList.contains('jtm-max'), 'restored');
    assert.strictEqual(content.style.width, '720px');
    assert.strictEqual(content.style.height, '560px');
    assert.strictEqual(content.style.left, '0px');

    // Resize from the bottom-right grip; 8px from the right snaps flush.
    const grip = doc.querySelector('.jtm-resize');
    grip.dispatchEvent(ptr('pointerdown', 200, 200));
    env.win.dispatchEvent(ptr('pointermove', 472, 200));
    assert.strictEqual(content.style.width, '1000px', 'resize snapped to the right edge');
    env.win.dispatchEvent(ptr('pointerup', 472, 200));

    // Minimize collapses to the title bar and restores.
    const minBtn = doc.querySelector('.jtm-min');
    minBtn.click();
    assert(content.classList.contains('jtm-minimized'), 'minimized class');
    assert.strictEqual(content.style.height, '', 'height collapses');
    minBtn.click();
    assert(!content.classList.contains('jtm-minimized'), 'minimize restored');
    assert.strictEqual(content.style.height, '560px');

    // Close removes the window.
    doc.querySelector('.jtm-close').click();
    assert(!doc.getElementById('price-tracker-modal'), 'window closed');
    const saved = JSON.parse(env.store.get('jumia_gh_dash_window'));
    assert.strictEqual(saved.w, 1000);
    assert.strictEqual(saved.max, false);
    assert.strictEqual(saved.snap, true);

    // Reopening restores the saved geometry.
    await openDashboard(env);
    const reopened = doc.querySelector('.jtm-content');
    assert.strictEqual(reopened.style.width, '1000px', 'saved width restored');
    assert.strictEqual(reopened.style.height, '560px', 'saved height restored');
    assert.strictEqual(reopened.style.left, '0px', 'saved position restored');
});

// ── 11. Mini panel: drag by its header, remember the position ──────────
test('mini panel can be dragged and remembers its position', async () => {
    const env = await makeEnv({ storage: { jumia_gh_coupons_last_fetch: realNow } });
    Object.defineProperty(env.win, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(env.win, 'innerHeight', { value: 700, configurable: true });

    const doc = env.win.document;
    const panel = doc.getElementById('price-tracker-panel');
    assert(panel, 'panel exists');
    const header = panel.querySelector('.jpt-header');
    const ptr = (type, x, y, extra = {}) => new env.win.MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra,
    });

    // Drag away from the default bottom-right corner. (jsdom reports a
    // zero-origin rect, so deltas come straight from the pointer offsets.)
    header.dispatchEvent(ptr('pointerdown', 0, 0));
    env.win.dispatchEvent(ptr('pointermove', 150, 120));
    assert(panel.classList.contains('jpt-dragging'), 'drag state shown');
    assert.strictEqual(panel.style.left, '150px', 'moved horizontally');
    assert.strictEqual(panel.style.top, '120px', 'moved vertically');
    assert.strictEqual(panel.style.right, 'auto', 'right anchor released');
    assert.strictEqual(panel.style.bottom, 'auto', 'bottom anchor released');
    env.win.dispatchEvent(ptr('pointerup', 150, 120));
    assert(!panel.classList.contains('jpt-dragging'), 'drag state cleared');
    assert.strictEqual(JSON.parse(env.store.get('jumia_gh_panel_pos')).x, 150, 'x persisted');
    assert.strictEqual(JSON.parse(env.store.get('jumia_gh_panel_pos')).y, 120, 'y persisted');

    // Dragging past the edge clamps the panel inside the viewport.
    header.dispatchEvent(ptr('pointerdown', 150, 120));
    env.win.dispatchEvent(ptr('pointermove', 5000, 5000));
    assert.strictEqual(panel.style.left, '670px', 'clamped to the right edge');
    assert.strictEqual(panel.style.top, '400px', 'clamped to the bottom edge');
    env.win.dispatchEvent(ptr('pointerup', 5000, 5000));

    // Closing keeps the position for the next page load.
    panel.querySelector('.jpt-close').click();
    assert(!doc.getElementById('price-tracker-panel'), 'panel closed');

    // A fresh page restores the saved position.
    const env2 = await makeEnv({ storage: Object.fromEntries(env.store) });
    Object.defineProperty(env2.win, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(env2.win, 'innerHeight', { value: 700, configurable: true });
    const panel2 = env2.win.document.getElementById('price-tracker-panel');
    assert(panel2, 'panel recreated');
    // Layout runs on open, so re-read the saved value through a resize tick.
    env2.win.dispatchEvent(new env2.win.Event('resize'));
    assert.strictEqual(panel2.style.left, '670px', 'saved x restored');
    assert.strictEqual(panel2.style.top, '400px', 'saved y restored');

    // Double-clicking the header resets it to the default corner.
    panel2.querySelector('.jpt-header').dispatchEvent(
        new env2.win.MouseEvent('dblclick', { bubbles: true, cancelable: true })
    );
    assert.strictEqual(panel2.style.left, '', 'reset clears left');
    assert.strictEqual(panel2.style.top, '', 'reset clears top');
    assert.strictEqual(env2.store.get('jumia_gh_panel_pos'), '', 'reset clears storage');
});

// ── 12. Seller-edited listings are flagged instead of a fake price crash ─
test('a redirected, renamed listing is flagged and does not notify a drop', async () => {
    const key = 'old-phone';
    const oldUrl = 'https://www.jumia.com.gh/old-phone.html';
    const newUrl = 'https://www.jumia.com.gh/replacement-case.html';
    const history = {
        [key]: {
            name: 'Original Smartphone 128GB', url: oldUrl, site: 'jumia', currency: 'GHS',
            samples: [{ p: 1200, t: realNow - 30 * HOUR }], created: realNow - 15 * DAY,
        },
    };
    const metas = {
        [key]: { lastCheck: realNow - 9 * HOUR, nextCheck: 0, misses: 0, failures: 0, etag: null, lastModified: null, lastPrice: 1200, rechecksLeft: 0 },
    };
    const storage = {
        ...seedHistory(history),
        [WATCH_KEY]: true,
        [STATE_KEY]: JSON.stringify(stateWith(metas)),
        jumia_gh_coupons_last_fetch: realNow,
    };
    const env = await makeEnv({
        storage,
        responses: {
            [oldUrl]: { status: 200, finalUrl: newUrl, text: page(99, 'Phone Case Cover', newUrl) },
        },
    });
    await openDashboard(env);
    await runDue(env, 20000);

    const h = loadJSON(env, HISTORY_KEY)[key];
    const last = h.samples.at(-1);
    assert.strictEqual(last.p, 99, 'new price recorded');
    assert.strictEqual(last.lc, 'url', 'sample marked as a URL-driven listing change');
    assert(h.listingChangedAt, 'listing change timestamp stored');
    assert.strictEqual(h.url, newUrl, 'redirect target saved');
    assert.strictEqual(env.win.__notifications.length, 0, 'no misleading drop notification');

    const doc = env.win.document;
    const row = doc.querySelector('.jtm-row.listing');
    assert(row, 'row tinted as a listing change');
    assert(row.querySelector('.jtm-flag.listing'), 'listing badge rendered');
    assert(!row.querySelector('.jtm-flag.down'), 'no fake drop badge');
    assert(/0\.0%/.test(row.querySelector('.jtm-change').textContent), 'change restarts after the swap');
});

// ── 13. Per-product price history view ────────────────────────────────
test('dashboard history view charts samples and lists every change', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = {
        [key]: {
            name: 'Phone', url, site: 'jumia', currency: 'GHS', created: realNow - 20 * DAY,
            listingChangedAt: realNow - HOUR,
            samples: [
                { p: 100, t: realNow - 10 * DAY },
                { p: 90, t: realNow - 8 * DAY },
                { p: 80, t: realNow - 6 * DAY },
                { p: 20, t: realNow - HOUR, lc: 'name' },
                { p: 18, t: realNow - 30 * 60 * 1000 },
            ],
        },
    };
    const storage = { ...seedHistory(history), jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({ storage });
    await openDashboard(env);

    const doc = env.win.document;
    const row = doc.querySelector('.jtm-row');
    assert(row.classList.contains('listing'), 'row explains the listing change');
    assert(/−|-\s?10\.0%/.test(row.querySelector('.jtm-change').textContent), 'change ignores pre-swap prices');

    row.querySelector('.jtm-hist').click();
    assert(doc.querySelector('.jtm-detail'), 'history view opened');
    assert(doc.querySelector('.jtm-chart svg'), 'chart rendered');
    assert.strictEqual(doc.querySelectorAll('.jtm-chart circle').length, 5, 'one dot per sample');
    const chgs = [...doc.querySelectorAll('.jtm-chg')];
    assert.strictEqual(chgs.length, 4, 'four price changes listed');
    assert(!chgs[0].classList.contains('listing'), 'ordinary newest change not marked');
    assert(/18\.00/.test(chgs[0].textContent), 'newest change shows the new price');
    assert(chgs[1].classList.contains('listing'), 'listing-change step is marked');
    assert(/listing/i.test(doc.querySelector('.jtm-detail-note').textContent), 'note explains the swap');
    const stats = doc.querySelector('.jtm-detail-stats').textContent;
    assert(/18\.00/.test(stats), 'current price shown');
    assert(/20\.00/.test(stats), 'high restarts after the listing change');

    doc.querySelector('.jtm-back').click();
    assert(!doc.querySelector('.jtm-detail'), 'back returns to the list');
    assert(doc.querySelector('.jtm-row'), 'rows visible again');

    // Escape closes the detail first, then the dashboard.
    doc.querySelector('.jtm-hist').click();
    doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!doc.querySelector('.jtm-detail'), 'Escape leaves the history view');
    assert(doc.getElementById('price-tracker-modal'), 'dashboard still open');
    doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!doc.getElementById('price-tracker-modal'), 'Escape then closes the dashboard');
});

// ── 14. The panel flags a listing change instead of celebrating a drop ──
test('a renamed listing on a visit shows a panel warning, not a drop', async () => {
    const key = 'p1';
    const url = 'https://www.jumia.com.gh/p1.html';
    const history = {
        [key]: {
            name: 'Original Smartphone 128GB', url, site: 'jumia', currency: 'GHS',
            samples: [{ p: 1200, t: realNow - 2 * HOUR }], created: realNow - 9 * DAY,
        },
    };
    const storage = { ...seedHistory(history), jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({ url, storage, html: page(99, 'Phone Case Cover', url) });
    for (let i = 0; i < 6; i++) await runDue(env, 2000);

    const h = loadJSON(env, HISTORY_KEY)[key];
    assert.strictEqual(h.samples.at(-1).lc, 'name', 'visit flagged the listing change');
    assert(h.listingChangedAt, 'timestamp stored');

    const panel = env.win.document.getElementById('price-tracker-panel');
    const note = panel.querySelector('.jpt-listing');
    assert(!note.hidden, 'panel warning visible');
    assert(/listing changed/i.test(note.textContent), 'warning explains the change');
    const stats = panel.querySelector('.jpt-stats').textContent;
    assert(/0\.0%/.test(stats), 'change restarts after the swap');
    assert(!/Drop:/.test(stats), 'no fake -99% drop line');
    assert.strictEqual(env.win.__notifications.length, 0, 'no misleading notification');
});

// ── 15. Coupon extraction: attributes, fields, tiers, noise, badges ───
test('coupon extraction accepts real codes, rejects noise, and keeps expiry', async () => {
    const html = `<!doctype html><html><head>
        <meta name="description" content="Save with coupon code META9 today">
        <title>Coupons</title></head><body>
        <h1 class="name">Samsung Galaxy A15 Phone</h1>
        <div class="coupon-card"><span class="coupon-code">SAVE15</span><span>15% off Samsung Galaxy phones</span></div>
        <button data-code="JUMIA20">Copy code</button>
        <input class="voucher-code" value="WELCOME5">
        <div class="coupon-card"><span class="coupon-code">DEC31</span><span>Valid until 31 Dec 2099</span></div>
        <div class="coupon-card"><span class="coupon-code">OLD20</span><span>20% off, expired 2020-01-01</span></div>
        <div class="coupon-card"><span class="coupon-code">2024</span></div>
        <div class="coupon-card"><span class="coupon-code">GHS50</span></div>
        <div class="coupon-card"><span class="coupon-code">HELPHELP</span></div>
        <div class="coupon-card"><span class="coupon-code">128GB</span></div>
        <div class="coupon-card">This coupon available for all shoppers</div>
        <div class="coupon-card">Promo code <b>FREESHIP</b></div>
        <button data-code="CAPTCHA">Copy</button>
        <p>Use coupon code EXTRA7 for 7% off.</p>
        </body></html>`;
    const env = await makeEnv({
        storage: { jumia_gh_coupons_last_fetch: realNow },
        html,
    });

    const by = couponMap(env);
    for (const code of ['SAVE15', 'JUMIA20', 'WELCOME5', 'DEC31', 'OLD20', 'EXTRA7', 'META9', 'FREESHIP'])
        assert(by[code], code + ' extracted');
    for (const bad of ['2024', 'GHS50', 'HELPHELP', '128GB', 'CAPTCHA', 'AVAILABLE'])
        assert(!by[bad], bad + ' rejected as noise');

    assert.strictEqual(by.JUMIA20.confidence, 'high', 'data attribute is high confidence');
    assert.strictEqual(by.WELCOME5.confidence, 'high', 'coupon input value is high confidence');
    assert.strictEqual(by.SAVE15.confidence, 'high', 'dedicated code field is high confidence');
    assert.strictEqual(by.EXTRA7.confidence, 'low', 'body sentence is low confidence');
    assert.strictEqual(by.META9.confidence, 'low', 'meta description is low confidence');
    assert.strictEqual(by.FREESHIP.confidence, 'medium', 'multiword "Promo code" allows a letter-only code');
    assert(by.DEC31.expiry > realNow, 'future expiry parsed');
    assert(by.OLD20.expiry < realNow, 'past expiry parsed');

    const doc = env.win.document;
    const rendered = [...doc.querySelectorAll('.jpt-coupon-code')].map(e => e.dataset.code);
    assert.strictEqual(rendered[0], 'SAVE15', 'most relevant usable coupon first');
    assert(rendered.includes('OLD20'), 'expired coupon still listed (greyed out)');

    const cardFor = code => [...doc.querySelectorAll('.jpt-coupon')]
        .find(c => c.querySelector(`[data-code="${code}"]`));
    const old = cardFor('OLD20');
    assert(old.classList.contains('jpt-expired'), 'expired styling');
    assert(/20% off/.test(old.querySelector('.jpt-coupon-deal').textContent), 'deal badge parsed');

    const dec = cardFor('DEC31');
    assert(/exp 31 Dec/.test(dec.querySelector('.jpt-coupon-expiry').textContent), 'expiry date rendered');
    assert(/usable/.test(doc.querySelector('.jpt-coupons-status').textContent), 'usable count shown');
});

// ── 16. A failed sync must not park the finder for six hours ───────────
test('all coupon pages failing keeps the previous sync timestamp', async () => {
    const storage = { jumia_gh_coupons_last_fetch: realNow };
    const env = await makeEnv({
        storage,
        responses: {
            'https://www.jumia.com.gh/coupons/': { status: 403, text: 'Forbidden' },
            'https://www.jumia.com.gh/sp/coupons/': {
                status: 200,
                text: '<!doctype html><html><head><title>Just a moment...</title></head><body>' +
                    'Verify you are human. '.repeat(20) + '</body></html>',
            },
        },
    });

    env.win.document.querySelector('.jpt-find-coupons').click();
    await flush(20);

    assert.strictEqual(env.store.get('jumia_gh_coupons_last_fetch'), realNow,
        'timestamp unchanged when every page fails');
    const retryAt = env.store.get('jumia_gh_coupons_retry_after');
    assert(retryAt > realNow, 'a short retry backoff is stored');
    assert(/unavailable/i.test(env.win.document.querySelector('.jpt-toast').textContent),
        'panel explains the outage');

    // The backoff suppresses automatic retries during the next navigation.
    const env2 = await makeEnv({
        storage: {
            jumia_gh_coupons_last_fetch: realNow,
            jumia_gh_coupons_retry_after: realNow + 5 * 60 * 1000,
        },
    });
    assert.strictEqual(env2.requests.filter(r => /coupons\//.test(r.url)).length, 0,
        'automatic sync waits for the retry window');
});

// ── 17. A blocked first URL falls through to the next coupon page ──────
test('coupon sync retries the next URL and records a success', async () => {
    const couponPage = `<!doctype html><html><head><title>Coupons</title></head><body>
        <div class="coupon-card"><span class="coupon-code">SECOND5</span><span>5% off your next order</span></div>
        <p>${'Shop more and save with our latest offers. '.repeat(8)}</p>
        </body></html>`;
    const env = await makeEnv({
        storage: { jumia_gh_coupons_last_fetch: realNow },
        responses: {
            'https://www.jumia.com.gh/coupons/': { status: 403, text: 'Forbidden' },
            'https://www.jumia.com.gh/sp/coupons/': { status: 200, text: couponPage },
        },
    });

    env.win.document.querySelector('.jpt-find-coupons').click();
    await flush(20);

    const by = couponMap(env);
    assert.strictEqual(by.SECOND5.code, 'SECOND5', 'code from the second URL stored');
    assert.strictEqual(by.SECOND5.confidence, 'high', 'dedicated field confidence kept');
    assert.strictEqual(env.store.get('jumia_gh_coupons_last_fetch'), realNow,
        'successful sync advances the timestamp');
    assert(env.requests.filter(r => /coupons\//.test(r.url)).length >= 2, 'both URLs attempted');
});

// ── 18. Expiry parsing: ISO, day/month, relative, invalid ──────────────
test('coupon expiry parsing handles ISO, day/month, relative and invalid dates', async () => {
    const html = `<!doctype html><html><body>
        <div class="coupon-card"><span class="coupon-code">ISO31</span><span>Expires 2099-12-31</span></div>
        <div class="coupon-card"><span class="coupon-code">DMY31</span><span>Valid until 31/12/2099</span></div>
        <div class="coupon-card"><span class="coupon-code">REL7</span><span>Valid for 7 days</span></div>
        <div class="coupon-card"><span class="coupon-code">TOMM</span><span>Expires tomorrow</span></div>
        <div class="coupon-card"><span class="coupon-code">BADDATE</span><span>Valid until 31/02/2099</span></div>
        </body></html>`;
    const env = await makeEnv({
        storage: { jumia_gh_coupons_last_fetch: realNow },
        html,
    });
    const by = couponMap(env);

    const iso = new Date(by.ISO31.expiry);
    assert.deepStrictEqual([iso.getFullYear(), iso.getMonth(), iso.getDate()], [2099, 11, 31],
        'ISO expiry parsed');
    const dmy = new Date(by.DMY31.expiry);
    assert.deepStrictEqual([dmy.getFullYear(), dmy.getMonth(), dmy.getDate()], [2099, 11, 31],
        'day/month/year expiry parsed');
    assert(by.REL7.expiry > realNow + 6 * DAY && by.REL7.expiry < realNow + 8 * DAY,
        'relative window parsed');
    assert(by.TOMM.expiry > realNow && by.TOMM.expiry < realNow + 2 * DAY,
        'tomorrow parsed');
    assert.strictEqual(by.BADDATE.expiry, null, 'impossible date ignored');
});

// ── 19. Ranking prefers relevant usable codes; junk is purged ──────────
test('ranking prefers relevant usable codes and purges junk on startup', async () => {
    const coupons = [
        { code: 'ALL10', description: '10% off everything', source: 'x', firstSeen: realNow, lastSeen: realNow, expiry: null, hits: 1, confidence: 'high' },
        { code: 'PHONE15', description: '15% off Samsung Galaxy phone accessories', source: 'x', firstSeen: realNow - 5 * DAY, lastSeen: realNow - 20 * DAY, expiry: null, hits: 1, confidence: 'high' },
        { code: 'OLD99', description: '99% off Samsung Galaxy phone', source: 'x', firstSeen: realNow, lastSeen: realNow, expiry: realNow - DAY, hits: 1, confidence: 'high' },
        { code: '2024', description: 'year', source: 'x', firstSeen: realNow, lastSeen: realNow, expiry: null, hits: 1, confidence: 'high' },
    ];
    const env = await makeEnv({
        storage: {
            jumia_gh_coupons: JSON.stringify(coupons),
            jumia_gh_coupons_last_fetch: realNow,
        },
        html: '<!doctype html><html><body><h1 class="name">Samsung Galaxy A15 Phone</h1></body></html>',
    });

    const rendered = [...env.win.document.querySelectorAll('.jpt-coupon-code')]
        .map(e => e.dataset.code);
    assert.strictEqual(rendered[0], 'PHONE15', 'product-relevant coupon first');
    assert.strictEqual(rendered.at(-1), 'OLD99', 'expired coupon last');
    assert(!rendered.includes('2024'), 'invalid stored code not rendered');
    assert(!loadCoupons(env).some(c => c.code === '2024'), 'invalid stored code purged');
});

(async () => {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log('PASS  ' + t.name);
        } catch (e) {
            failed++;
            console.error('FAIL  ' + t.name);
            console.error('      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e));
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
