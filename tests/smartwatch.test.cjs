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
    win.GM_notification = () => {};
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
