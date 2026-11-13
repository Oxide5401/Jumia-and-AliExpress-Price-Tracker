// ==UserScript==
// @name         Jumia Ghana – Price Tracker + Coupons + Dashboard
// @namespace    https://github.com/yourname/jumia-price-tracker
// @version      3.6.0
// @description  Robust price tracker with product images, persistent coupon finder, and tracking dashboard for jumia.com.gh and aliexpress.com (Ghana / GHS)
// @author       Oxide5401
// @homepageURL  https://github.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker
// @supportURL   https://github.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/issues
// @updateURL    https://raw.githubusercontent.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/main/jumia-aliexpress-price-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/Oxide5401/Jumia-and-AliExpress-Price-Tracker/main/jumia-aliexpress-price-tracker.user.js
// @license      MIT
// @match        https://www.jumia.com.gh/*
// @match        https://*.aliexpress.com/*
// @match        https://aliexpress.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      jumia.com.gh
// @connect      www.jumia.com.gh
// @connect      aliexpress.com
// @connect      *.aliexpress.com
// @run-at       document-end
// @noframes
// ==/UserScript==

// NOTE: @name and @namespace above are deliberately IDENTICAL to v3.2.0.
// Userscript managers keep GM_setValue data per installed script, so changing
// either one creates a new script with empty storage. Keep them unchanged and
// install this file over the old script to keep your tracked prices/coupons.

(function () {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // 1. SITE DETECTION + CONFIG
    // ──────────────────────────────────────────────────────────────
    const HOST = location.hostname.toLowerCase();

    const SITES = [
        {
            id: 'jumia',
            label: 'Jumia Ghana',
            shortLabel: 'Jumia GH',
            currency: 'GHS',
            keyPrefix: '',
            match: h => /(^|\.)jumia\.com\.gh$/.test(h),
            couponPageUrls: [
                'https://www.jumia.com.gh/coupons/',
                'https://www.jumia.com.gh/sp/coupons/',
            ],
            extractAttempts: 20,
            extractDelayMs: 500,
            firstExtractDelayMs: 800,
        },
        {
            // AliExpress has no Ghana-specific domain: Ghanaian shoppers use
            // aliexpress.com with ship-to = Ghana and currency = GHS.
            id: 'aliexpress',
            label: 'AliExpress Ghana',
            shortLabel: 'AliExpress',
            currency: 'GHS',
            keyPrefix: 'ali:',
            match: h => /(^|\.)aliexpress\.com$/.test(h),
            // Codes for AliExpress are campaign based (e.g. "Code: AE10"),
            // so we scan these account/promo pages plus every page you visit.
            couponPageUrls: [
                'https://www.aliexpress.com/p/my-coupons/index.html',
                'https://www.aliexpress.com/p/coupon-package/index.html',
            ],
            extractAttempts: 40,
            extractDelayMs: 750,
            firstExtractDelayMs: 1200,
        },
    ];

    const SITE = SITES.find(s => s.match(HOST)) || SITES[0];
    const IS_ALI = SITE.id === 'aliexpress';

    const CONFIG = {
        // Shared history store, kept under the original key so existing Jumia
        // data survives. AliExpress entries are namespaced with "ali:".
        storageKey: 'jumia_gh_price_history',
        couponStorageKey: IS_ALI ? 'aliexpress_coupons' : 'jumia_gh_coupons',
        couponLastSyncKey: IS_ALI ? 'aliexpress_coupons_last_fetch' : 'jumia_gh_coupons_last_fetch',
        couponShowAllKey: IS_ALI ? 'aliexpress_coupons_show_all' : 'jumia_gh_coupons_show_all',
        maxSamplesPerProduct: 120,
        maxProducts: 200,
        dropThresholdPercent: 5,
        uiPanelId: 'price-tracker-panel',
        trackedModalId: 'price-tracker-modal',
        notificationTimeout: 10000,
        couponPageUrls: SITE.couponPageUrls,
        couponCacheTTLMs: 6 * 60 * 60 * 1000,
        maxCoupons: 500,
        extractAttempts: SITE.extractAttempts,
        extractDelayMs: SITE.extractDelayMs,
        firstExtractDelayMs: SITE.firstExtractDelayMs,

        // ── Smart watch (opt-in background price checks) ─────────────
        // Values are deliberately conservative: a few dozen page reads a
        // day, spread out, instead of polling every tracked product.
        smartWatchKey: 'jumia_gh_smart_watch',
        watchStateKey: 'jumia_gh_smart_watch_state',
        watch: {
            maxChecksPerDay: 40,          // hard daily request budget (all hosts)
            minGapMs: 8000,               // minimum spacing between checks
            tickMs: 5 * 60 * 1000,        // scheduler wake-up interval
            jitter: 0.2,                  // ±20% on every interval
            canaryCount: 3,               // signal products overall (Jumia-eligible)
            canaryIntervalMs: 6 * 60 * 60 * 1000,
            campaignThreshold: 2,         // canaries changed => campaign
            campaignWindowMs: 6 * 60 * 60 * 1000,
            campaignActiveMs: 12 * 60 * 60 * 1000,
            minIntervalMs: 6 * 60 * 60 * 1000,
            maxIntervalMs: 14 * 24 * 60 * 60 * 1000,
            targetNearRatio: 0.10,        // within 10% of target => daily
            changeHighlightMs: 7 * 24 * 60 * 60 * 1000, // flag recent changes for 7d
            requestTimeoutMs: 20000,
            fetchAliExpress: false,       // AliExpress blocks scripted fetches
            leaseMs: 90000,               // cross-tab lock lifetime
        },
    };

    const CURRENCY_SYMBOLS = {
        GHS: 'GH₵', USD: 'US$', EUR: '€', GBP: '£', NGN: '₦',
        KES: 'KSh', ZAR: 'R', CNY: 'CN¥', CAD: 'CA$', AUD: 'A$',
    };

    // ──────────────────────────────────────────────────────────────
    // 2. UTILS
    // ──────────────────────────────────────────────────────────────
    const log = (...a) => console.log('[Price Tracker]', ...a);
    const warn = (...a) => console.warn('[Price Tracker]', ...a);

    /**
     * Parses the FIRST number in a string, so "GHS 20.00 - 35.00" yields 20.00
     * instead of the old behaviour (20.0035). Handles both 1,234.56 and 1.234,56.
     */
    function parsePrice(text) {
        if (text == null) return null;
        const m = String(text).match(/\d[\d.,]*/);
        if (!m) return null;
        let raw = m[0];
        const lastComma = raw.lastIndexOf(',');
        const lastDot = raw.lastIndexOf('.');
        if (lastComma > -1 && lastDot > -1) {
            if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.');
            else raw = raw.replace(/,/g, '');
        } else if (lastComma > -1) {
            const decimals = raw.length - lastComma - 1;
            const thousands = decimals === 3 && !/^0/.test(raw.slice(lastComma + 1));
            raw = thousands ? raw.replace(/,/g, '') : raw.replace(',', '.');
        }
        const num = parseFloat(raw);
        return isNaN(num) ? null : num;
    }
    function formatPrice(num) {
        if (num == null) return '—';
        return num.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function detectCurrency(text, fallback) {
        const fb = fallback || SITE.currency;
        if (!text) return fb;
        const t = String(text).toUpperCase();
        if (t.includes('₵') || /\bGHS\b/.test(t)) return 'GHS';
        if (/\bUSD\b/.test(t) || /US\s*\$/.test(t)) return 'USD';
        if (t.includes('€') || /\bEUR\b/.test(t)) return 'EUR';
        if (t.includes('£') || /\bGBP\b/.test(t)) return 'GBP';
        if (t.includes('₦') || /\bNGN\b/.test(t)) return 'NGN';
        if (/\bKES\b/.test(t)) return 'KES';
        if (/\bZAR\b/.test(t) || /\bR\s?\d/.test(t)) return 'ZAR';
        if (/\bCNY\b/.test(t) || /CN\s*¥/.test(t)) return 'CNY';
        return fb;
    }
    function formatMoney(num, currency) {
        if (num == null) return '—';
        const cur = currency || SITE.currency;
        const sym = CURRENCY_SYMBOLS[cur];
        const n = formatPrice(num);
        return sym ? `${sym} ${n}` : `${cur} ${n}`;
    }
    function getProductKey() {
        const path = new URL(location.href).pathname;
        if (IS_ALI) {
            // /item/1005006187992416.html, /i/1005006187992416.html, m.aliexpress.com/item/…
            const m = path.match(/\/(?:item|i)\/(\d+)/);
            return SITE.keyPrefix + (m ? m[1] : path);
        }
        const m = path.match(/([a-zA-Z0-9\-]+)\.html$/);
        return m ? m[1] : path;
    }
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
    function truncate(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }
    /** Cleans a page-derived name; rejects challenge/blocked pages. */
    function cleanProductName(raw) {
        const name = String(raw || '')
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (name.length < 3) return '';
        if (/access denied|just a moment|captcha|are you a robot|robot check|request blocked|attention required/i.test(name))
            return '';
        return name;
    }
    function shortDuration(ms) {
        if (!ms || ms < 0) return 'now';
        const mins = Math.round(ms / 60000);
        if (mins < 1) return 'moments';
        if (mins < 60) return `${mins}m`;
        const hours = Math.round(mins / 60);
        if (hours < 48) return `${hours}h`;
        return `${Math.round(hours / 24)}d`;
    }
    /**
     * Most recent actual price movement in a product's samples. Scanning
     * backwards finds the last differing pair even when a later unchanged
     * baseline sample was appended.
     */
    function latestChange(p) {
        const s = p && p.samples;
        if (!Array.isArray(s) || s.length < 2) return null;
        for (let i = s.length - 1; i > 0; i--) {
            const to = s[i], from = s[i - 1];
            if (to && from && to.p !== from.p) {
                return {
                    t: to.t || 0,
                    from: from.p,
                    to: to.p,
                    pct: from.p ? ((to.p - from.p) / from.p) * 100 : 0,
                };
            }
        }
        return null;
    }
    /** Fallback for products whose stored name is missing/blank/invisible. */
    function displayName(key, p) {
        const raw = String((p && p.name) || '')
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
            .trim();
        return raw || String(key || '(untitled)');
    }
    /** Fills a thumbnail element; falls back to a bag emoji when missing/broken. */
    function setThumb(el, src, label) {
        if (!el) return;
        el.textContent = '';
        if (!src) {
            el.classList.add('jpt-thumb-empty');
            el.textContent = '🛍';
            return;
        }
        el.classList.remove('jpt-thumb-empty');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.alt = label ? truncate(label, 80) : '';
        img.addEventListener('error', () => {
            el.textContent = '🛍';
            el.classList.add('jpt-thumb-empty');
        }, { once: true });
        img.src = src;
        el.appendChild(img);
    }
    function timeAgo(ms) {
        if (!ms) return 'never';
        const s = Math.floor((Date.now() - ms) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
    }
    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy') ? resolve() : reject(); }
            catch (e) { reject(e); }
            finally { document.body.removeChild(ta); }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // 3. PRICE EXTRACTION
    // ──────────────────────────────────────────────────────────────
    function cleanUrl(u, base) {
        try { return new URL(u, base || location.href).href.split(/[?#]/)[0]; }
        catch { return ''; }
    }

    // ── Product images ───────────────────────────────────────────
    function absoluteImage(u, base) {
        if (!u) return '';
        let s = String(u).trim();
        if (!s || /^(data|blob):/i.test(s)) return '';
        try { s = new URL(s, base || location.href).href; } catch { return ''; }
        if (!/^https?:/i.test(s)) return '';
        // Skip obvious site chrome / tracking pixels.
        if (/(logo|sprite|placeholder|spacer|1x1|blank\.gif|pixel\.gif)/i.test(s)) return '';
        return s;
    }

    function productNodesOf(doc) {
        const out = [];
        for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
            let data;
            try { data = JSON.parse(script.textContent); } catch { continue; }
            const items = Array.isArray(data) ? data : [data];
            const graph = [];
            for (const it of items) {
                if (it && Array.isArray(it['@graph'])) graph.push(...it['@graph']);
                graph.push(it);
            }
            for (const item of graph) if (item && item['@type'] === 'Product') out.push(item);
        }
        return out;
    }

    /** Finds a product image URL in a document (live page or fetched HTML). */
    function imageFromDoc(doc, base, isAliPage = IS_ALI) {
        {
            const metaSelectors = [
                'meta[property="og:image:secure_url"]',
                'meta[property="og:image"]',
                'meta[name="twitter:image"]',
                'meta[property="twitter:image"]',
            ];
            for (const sel of metaSelectors) {
                const m = doc.querySelector(sel);
                const url = absoluteImage(m && m.getAttribute('content'), base);
                if (url) return url;
            }

            for (const item of productNodesOf(doc)) {
                const raw = Array.isArray(item.image) ? item.image[0] : item.image;
                const u = typeof raw === 'string' ? raw : (raw && (raw.url || raw.contentUrl));
                const url = absoluteImage(u, base);
                if (url) return url;
            }

            const selectors = isAliPage
                ? ['[class*="Product_Gallery"] img', '[class*="gallery"] img', '[class*="main-image"] img', 'main img']
                : ['#imgs img', '[class*="gallery"] img', 'main img', '.img img'];
            for (const sel of selectors) {
                for (const el of doc.querySelectorAll(sel)) {
                    const raw = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') ||
                        el.getAttribute('src') || el.currentSrc || el.src;
                    const url = absoluteImage(raw, base);
                    if (url) return url;
                }
            }
        }
        return '';
    }

    let imageCache = { url: null, value: '' };
    function extractImage() {
        if (imageCache.url === location.href) return imageCache.value;
        const value = imageFromDoc(document, location.href);
        imageCache = { url: location.href, value };
        return value;
    }


    function extractFromJsonLd(doc = document, base = location.href) {
        const here = cleanUrl(base);
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
        let best = null;
        for (const script of scripts) {
            let data;
            try { data = JSON.parse(script.textContent); } catch { continue; }
            const items = Array.isArray(data) ? data : [data];
            const graph = [];
            for (const it of items) {
                if (it && Array.isArray(it['@graph'])) graph.push(...it['@graph']);
                graph.push(it);
            }
            for (const item of graph) {
                if (!item || item['@type'] !== 'Product' || !item.offers) continue;
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                const price = parseFloat(offer.price);
                if (isNaN(price) || price <= 0) continue;
                const cand = {
                    price,
                    currency: offer.priceCurrency || SITE.currency,
                    oldPrice: null,
                    availability: offer.availability || '',
                    name: item.name || '',
                    url: item.url || item['@id'] || '',
                };
                if (cand.url && cleanUrl(cand.url, base) === here) return cand;
                if (cand.name) {
                    const slug = cand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25);
                    if (slug.length > 8 && here.toLowerCase().includes(slug)) return cand;
                }
                if (!best) best = cand;
            }
        }
        return best;
    }

    // ── Jumia ────────────────────────────────────────────────────
    function findMainProductContainer(doc = document) {
        const h1 = doc.querySelector('h1.name, h1.-fs20, main h1');
        if (!h1) return null;
        let el = h1.parentElement, depth = 0;
        while (el && el !== doc.body && depth < 8) {
            if (el.querySelector('.prc, [data-price], .price, .-b')) return el;
            el = el.parentElement; depth++;
        }
        return h1.parentElement;
    }

    function extractFromDomJumia(doc = document) {
        const h1 = doc.querySelector('h1.name, main h1, h1');
        const container = findMainProductContainer(doc);
        let priceEl = null;
        const BAD_ANCESTOR = '[class*="sponsor"], [class*="similar"], [class*="recommend"], section[data-track], aside';

        if (container) {
            const candidates = container.querySelectorAll('.prc');
            for (const c of candidates) if (!c.closest(BAD_ANCESTOR)) { priceEl = c; break; }
            if (!priceEl && candidates.length) priceEl = candidates[0];
        }
        if (!priceEl) {
            for (const s of ['main section .prc', 'main .prc', '.product-top .prc', '[data-product] .prc']) {
                const el = doc.querySelector(s);
                if (el && !el.closest(BAD_ANCESTOR)) { priceEl = el; break; }
            }
        }
        if (!priceEl) return null;
        const price = parsePrice(priceEl.textContent);
        if (price == null || price <= 0) return null;

        let oldPrice = null;
        const scope = priceEl.closest('div, section') || priceEl.parentElement;
        if (scope) {
            const oldEl = scope.querySelector('.old, .old-price, [class*="old"], .-old, .-mvs');
            if (oldEl) oldPrice = parsePrice(oldEl.textContent);
        }
        const name = h1 ? h1.textContent.trim() : '';
        return { price, oldPrice, name };
    }

    // ── AliExpress ───────────────────────────────────────────────
    // Class names are hashed and change often, so we match on substrings and
    // skip anything that belongs to a recommendation rail or a struck-through
    // "was" price.
    const ALI_BAD_ANCESTOR = [
        '[class*="recommend"]', '[class*="similar"]', '[class*="related"]',
        '[class*="also-view"]', '[class*="hot-product"]', '[class*="more-to-love"]',
        '[class*="bundle"]', '[class*="cross-sell"]',
        '[class*="originalPrice"]', '[class*="delPrice"]',
        '[class*="price--original"]', '.product-price-original',
        'aside', 'del',
    ].join(',');

    const ALI_PRICE_SELECTORS = [
        '[class*="currentPriceText"]',
        '[class*="price--current"]',
        '.product-price-current',
        '.product-price:not(.product-price-original) .product-price-value',
        '.product-price:not(.product-price-original)',
        '[class*="Product_Price__container"]',
        '.uniform-banner-box-price',
        '[data-pl="product-price"]',
        '[class*="Product_Price"]',
        '[class*="ProductPrice"]',
        '.es--m6',
    ];

    function queryInOrder(selectors, doc = document) {
        for (const s of selectors) {
            const el = doc.querySelector(s);
            if (el) return el;
        }
        return null;
    }

    function extractFromDomAliExpress(doc = document) {
        const h1 = queryInOrder([
            'h1[data-pl="product-title"]',
            'h1.product-title-text',
            '[class*="Product_Name__container"] h1',
            'main h1',
            'h1',
            '[class*="Product_Name__container"]',
        ], doc);
        let name = h1 ? h1.textContent.trim() : (doc.title || '');
        name = name.replace(/\s*[-|–]\s*AliExpress.*$/i, '').trim();

        for (const sel of ALI_PRICE_SELECTORS) {
            let nodes;
            try { nodes = doc.querySelectorAll(sel); } catch { continue; }
            for (const el of nodes) {
                if (el.closest(ALI_BAD_ANCESTOR)) continue;
                const text = (el.textContent || '').trim();
                if (!text || text.length > 120) continue;
                const price = parsePrice(text);
                if (price == null || price <= 0) continue;

                const OLD_SEL = '[class*="originalPrice"], [class*="delPrice"], .product-price-original, del';
                const parent = el.parentElement;
                const host = (el.querySelector(OLD_SEL) && el) || (parent && parent.querySelector(OLD_SEL) && parent) || null;
                const oldRaw = host ? parsePrice(host.querySelector(OLD_SEL).textContent) : null;
                return {
                    price,
                    oldPrice: oldRaw && oldRaw > price ? oldRaw : null,
                    name,
                    currency: detectCurrency(text),
                };
            }
        }
        return null;
    }

    // Fallback: price embedded in AliExpress' inline JSON state.
    let aliStateCache = { url: null, value: null };
    function extractFromAliExpressState(doc = document, base = location.href) {
        if (aliStateCache.url === base) return aliStateCache.value;

        let result = null;
        const scripts = doc.querySelectorAll('script:not([src])');
        for (const s of scripts) {
            const t = s.textContent;
            if (!t || t.length > 1500000) continue;
            if (t.indexOf('formatedPrice') === -1 && t.indexOf('formatedActivityPrice') === -1) continue;

            const act = t.match(/"formatedActivityPrice"\s*:\s*"([^"]+)"/);
            const baseMatch = t.match(/"formatedPrice"\s*:\s*"([^"]+)"/);
            const orig = t.match(/"formatedOriginalPrice"\s*:\s*"([^"]+)"/);
            const raw = (act && act[1]) || (baseMatch && baseMatch[1]);
            if (!raw) continue;

            const price = parsePrice(raw);
            if (price == null || price <= 0) continue;
            const oldPrice = orig ? parsePrice(orig[1]) : null;
            result = {
                price,
                oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
                name: doc.title || '',
                currency: detectCurrency(raw),
            };
            break;
        }
        aliStateCache = { url: base, value: result };
        return result;
    }

    function extractFromMeta(doc = document) {
        const amount = doc.querySelector(
            'meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"]'
        );
        if (!amount) return null;
        const price = parsePrice(amount.content);
        if (price == null || price <= 0) return null;
        const curEl = doc.querySelector(
            'meta[property="product:price:currency"], meta[property="og:price:currency"], meta[itemprop="priceCurrency"]'
        );
        return {
            price,
            oldPrice: null,
            name: doc.title,
            currency: detectCurrency(curEl && curEl.content, SITE.currency),
        };
    }

    function extractPrice(doc = document, base = location.href) {
        if (IS_ALI) {
            // DOM first: it reflects the actual sale price the buyer sees.
            const d = extractFromDomAliExpress(doc);
            if (d && d.price) return { ...d, source: 'dom' };
            const j = extractFromJsonLd(doc, base);
            if (j && j.price) return { ...j, source: 'json-ld' };
            const s = extractFromAliExpressState(doc, base);
            if (s && s.price) return { ...s, source: 'state' };
            const m = extractFromMeta(doc);
            if (m && m.price) return { ...m, source: 'meta' };
            return null;
        }
        const j = extractFromJsonLd(doc, base);
        if (j && j.price) return { ...j, source: 'json-ld' };
        const d = extractFromDomJumia(doc);
        if (d && d.price) return { ...d, currency: SITE.currency, source: 'dom' };
        const m = extractFromMeta(doc);
        if (m && m.price) return { ...m, currency: SITE.currency, source: 'meta' };
        return null;
    }

    // ──────────────────────────────────────────────────────────────
    // 4. PRICE STORAGE
    // ──────────────────────────────────────────────────────────────
    function loadHistory() {
        try { return JSON.parse(GM_getValue(CONFIG.storageKey, '{}')); }
        catch { return {}; }
    }
    function saveHistory(h) {
        try {
            const keys = Object.keys(h);
            if (keys.length > CONFIG.maxProducts) {
                const sorted = keys.sort((a, b) =>
                    (h[b].samples.at(-1)?.t || 0) - (h[a].samples.at(-1)?.t || 0));
                const kept = {};
                sorted.slice(0, CONFIG.maxProducts).forEach(k => kept[k] = h[k]);
                h = kept;
            }
            GM_setValue(CONFIG.storageKey, JSON.stringify(h));
        } catch (e) { warn('saveHistory failed', e); }
    }

    /**
     * Merges an exported history object into the current store without
     * discarding anything. Used by the dashboard's Import JSON button.
     */
    function mergeHistoryData(incoming) {
        const h = loadHistory();
        let products = 0, samples = 0;
        for (const [key, p] of Object.entries(incoming || {})) {
            if (!p || !Array.isArray(p.samples) || !p.samples.length) continue;
            if (!h[key]) { h[key] = p; products++; samples += p.samples.length; continue; }
            const ex = h[key];
            const seen = new Set(ex.samples.map(s => s.t));
            for (const s of p.samples) {
                if (!s || typeof s.p !== 'number' || seen.has(s.t)) continue;
                ex.samples.push(s); samples++;
            }
            ex.samples.sort((a, b) => (a.t || 0) - (b.t || 0));
            if (ex.samples.length > CONFIG.maxSamplesPerProduct)
                ex.samples = ex.samples.slice(-CONFIG.maxSamplesPerProduct);
            ex.name = ex.name || p.name;
            ex.url = ex.url || p.url;
            ex.currency = ex.currency || p.currency || SITE.currency;
            ex.site = ex.site || p.site;
            ex.image = ex.image || p.image;
            if (ex.target == null && typeof p.target === 'number') ex.target = p.target;
            ex.created = Math.min(ex.created || Date.now(), p.created || Date.now());
        }
        saveHistory(h);
        return { products, samples };
    }

    function recordPrice() {
        const key = getProductKey();
        const info = extractPrice();
        if (!info || info.price == null) return null;

        const history = loadHistory();
        const now = Date.now();
        const image = extractImage();
        const cleanName = cleanProductName(info.name);

        if (!history[key]) {
            history[key] = {
                name: cleanName, url: location.href,
                site: SITE.id,
                currency: info.currency || SITE.currency,
                image: image || '',
                samples: [], created: now,
            };
        }
        const product = history[key];
        const last = product.samples.at(-1);

        product.samples.push({ p: info.price, op: info.oldPrice || null, t: now, src: info.source });
        if (product.samples.length > CONFIG.maxSamplesPerProduct)
            product.samples = product.samples.slice(-CONFIG.maxSamplesPerProduct);

        if (cleanName) product.name = cleanName;
        if (image) product.image = image;
        product.url = location.href;
        product.currency = info.currency || product.currency || SITE.currency;
        product.site = SITE.id;
        saveHistory(history);

        const changed = !!(last && last.p !== info.price);
        try { noteLivePrice(key, product, changed); } catch (e) { warn('watch state update failed', e); }
        if (changed) refreshDashboardIfOpen();

        let dropPercent = null;
        if (last && info.price < last.p) dropPercent = ((last.p - info.price) / last.p) * 100;
        return { product, isNew: !last, dropPercent, info };
    }

    // ──────────────────────────────────────────────────────────────
    // 4b. SMART WATCH — canary-gated, budgeted background checks
    // ──────────────────────────────────────────────────────────────
    // Design: price changes are correlated (campaigns, category sales), so
    // checking a few volatile "canaries" tells us whether a sweep is worth it.
    // Every product also has a hazard-based due date and a hard staleness
    // bound. A global daily budget and per-host cooldown prevent bursts.
    const MIN_MS = 60e3;
    const HOUR_MS = 60 * MIN_MS;
    const DAY_MS = 24 * HOUR_MS;
    const WATCH_TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let watchTimer = null;
    let watchBusy = false;

    function isAliProduct(key, p) {
        return (p && p.site === 'aliexpress') || String(key || '').startsWith('ali:');
    }
    function siteLabelOf(key, p) {
        return isAliProduct(key, p) ? 'AliExpress Ghana' : 'Jumia Ghana';
    }
    function priceOf(p) {
        return p && Array.isArray(p.samples) && p.samples.length ? p.samples.at(-1).p : null;
    }
    function targetOf(p) {
        return p && typeof p.target === 'number' && isFinite(p.target) ? p.target : null;
    }
    function targetMet(p) {
        const t = targetOf(p), c = priceOf(p);
        return t != null && c != null && c <= t;
    }
    function targetNear(p) {
        const t = targetOf(p), c = priceOf(p);
        return t != null && c != null && c > t && c <= t * (1 + CONFIG.watch.targetNearRatio);
    }

    function newWatchMeta() {
        return {
            lastCheck: 0, nextCheck: 0, misses: 0, failures: 0,
            etag: null, lastModified: null, lastPrice: null, rechecksLeft: 0,
        };
    }

    function loadWatchState() {
        let s;
        try { s = JSON.parse(GM_getValue(CONFIG.watchStateKey, '{}')); }
        catch { s = {}; }
        if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
        if (!s.products || typeof s.products !== 'object') s.products = {};
        if (!s.hosts || typeof s.hosts !== 'object') s.hosts = {};
        if (!s.canaries || typeof s.canaries !== 'object') s.canaries = {};
        if (!s.budget || typeof s.budget !== 'object') s.budget = { day: '', used: 0 };
        if (typeof s.campaignUntil !== 'number') s.campaignUntil = 0;
        if (typeof s.campaignSince !== 'number') s.campaignSince = 0;
        if (typeof s.lastRequestAt !== 'number') s.lastRequestAt = 0;
        if (!s.lease || typeof s.lease !== 'object') s.lease = null;
        return s;
    }

    function saveWatchState(s) {
        try { GM_setValue(CONFIG.watchStateKey, JSON.stringify(s)); }
        catch (e) { warn('saveWatchState failed', e); }
    }

    function swEnabled() { return !!GM_getValue(CONFIG.smartWatchKey, false); }

    function ensureWatchMeta(state, key, spread = true) {
        if (!state.products[key]) {
            const m = newWatchMeta();
            m.nextCheck = Date.now() + (spread ? Math.random() * CONFIG.watch.maxIntervalMs : 0);
            state.products[key] = m;
        }
        return state.products[key];
    }

    function watchDayKey() { return new Date().toDateString(); }
    function watchBudget(state) {
        if (!state.budget || state.budget.day !== watchDayKey())
            state.budget = { day: watchDayKey(), used: 0 };
        return state.budget;
    }

    function volatility(p) {
        const cutoff = Date.now() - 30 * DAY_MS;
        const recent = (p.samples || []).filter(s => (s.t || 0) >= cutoff);
        let n = 0;
        for (let i = 1; i < recent.length; i++)
            if (recent[i].p !== recent[i - 1].p) n++;
        return n;
    }

    /**
     * Canaries are the most volatile eligible products. A change in two or
     * more of them within the campaign window is treated as a site signal.
     */
    function selectCanaries(history) {
        const cutoff = Date.now() - 30 * DAY_MS;
        const pool = [];
        for (const [key, p] of Object.entries(history || {})) {
            if (!p || !Array.isArray(p.samples) || !p.samples.length) continue;
            if (isAliProduct(key, p) && !CONFIG.watch.fetchAliExpress) continue;
            if (targetMet(p)) continue;
            const recent = p.samples.filter(s => (s.t || 0) >= cutoff);
            let changes = 0;
            for (let i = 1; i < recent.length; i++)
                if (recent[i].p !== recent[i - 1].p) changes++;
            pool.push({ key, changes, last: p.samples.at(-1).t || 0 });
        }
        pool.sort((a, b) => b.changes - a.changes || b.last - a.last);
        return new Set(pool.slice(0, CONFIG.watch.canaryCount).map(x => x.key));
    }

    /** Interval until the next check, from volatility, misses and rechecks. */
    function watchNextDelay(key, p, meta, changed, canaries) {
        const w = CONFIG.watch;
        let interval;
        if (changed) {
            meta.rechecksLeft = 2;              // 1h, then 6h, then 24h
            interval = HOUR_MS;
        } else if (meta.rechecksLeft > 0) {
            interval = meta.rechecksLeft === 2 ? 6 * HOUR_MS : 24 * HOUR_MS;
            meta.rechecksLeft -= 1;
        } else {
            const n = volatility(p);
            interval = n >= 3 ? 6 * HOUR_MS
                : n === 2 ? 12 * HOUR_MS
                : n === 1 ? 48 * HOUR_MS
                : 7 * DAY_MS;
            // Consecutive unchanged checks earn exponential backoff.
            interval *= Math.pow(2, Math.min(meta.misses || 0, 2));
            if (canaries && canaries.has(key)) interval = Math.min(interval, w.canaryIntervalMs);
            if (targetNear(p)) interval = Math.min(interval, DAY_MS);
            if (targetMet(p)) interval = w.maxIntervalMs;
            interval = Math.max(w.minIntervalMs, Math.min(w.maxIntervalMs, interval));
        }
        const jitter = 1 + (Math.random() * 2 - 1) * w.jitter;
        return Math.max(5 * MIN_MS, Math.round(interval * jitter));
    }

    function noteCanaryChange(state, key) {
        const now = Date.now();
        const w = CONFIG.watch;
        state.canaries[key] = now;
        for (const [k, t] of Object.entries(state.canaries))
            if (now - t > w.campaignWindowMs) delete state.canaries[k];
        const signals = Object.keys(state.canaries).length;
        if (signals >= w.campaignThreshold) {
            if (!state.campaignSince || state.campaignSince < now - w.campaignActiveMs)
                state.campaignSince = now;
            state.campaignUntil = now + w.campaignActiveMs;
            log(`Smart watch: campaign signal (${signals} canaries) — scheduling a sweep.`);
        }
    }

    /** Keeps scheduler metadata in sync with a normal page visit. */
    function noteLivePrice(key, product, changed) {
        const state = loadWatchState();
        const tracked = !!state.products[key];
        if (!swEnabled() && !tracked) return;
        const meta = ensureWatchMeta(state, key, false);
        const now = Date.now();
        const canaries = selectCanaries(loadHistory());
        meta.lastCheck = now;
        meta.lastPrice = priceOf(product);
        meta.failures = 0;
        meta.misses = changed ? 0 : (meta.misses || 0) + 1;
        meta.nextCheck = now + watchNextDelay(key, product, meta, changed, canaries);
        if (changed && canaries.has(key)) noteCanaryChange(state, key);
        saveWatchState(state);
    }

    function seedWatchState() {
        const state = loadWatchState();
        const history = loadHistory();
        const now = Date.now();
        for (const key of Object.keys(history)) ensureWatchMeta(state, key, true);
        for (const key of selectCanaries(history)) {
            const m = state.products[key];
            if (m) m.nextCheck = Math.min(m.nextCheck || now, now + (1 + Math.random() * 4) * MIN_MS);
        }
        saveWatchState(state);
    }

    function setSwEnabled(value) {
        GM_setValue(CONFIG.smartWatchKey, !!value);
        if (value) {
            seedWatchState();
            scheduleWatchTick(5000);
            log('Smart watch enabled.');
        } else {
            if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
            log('Smart watch disabled.');
        }
        renderWatchStatus();
    }

    function resetWatchMeta(key) {
        const state = loadWatchState();
        const m = ensureWatchMeta(state, key, false);
        m.nextCheck = Date.now();
        m.failures = 0;
        saveWatchState(state);
        if (swEnabled()) scheduleWatchTick(5000);
    }

    // ── HTTP helpers ─────────────────────────────────────────────
    function parseHeaderMap(raw) {
        const map = {};
        String(raw || '').split(/\r?\n/).forEach(line => {
            const i = line.indexOf(':');
            if (i > 0) map[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        });
        return map;
    }

    function parseRetryAfter(headers) {
        const v = headers && headers['retry-after'];
        if (!v) return 0;
        const seconds = Number(v);
        if (!isNaN(seconds)) return Math.max(0, seconds * 1000);
        const at = Date.parse(v);
        return isNaN(at) ? 0 : Math.max(0, at - Date.now());
    }

    /** GET with conditional validators; resolves 304s instead of rejecting. */
    function fetchWatchPage(url, meta) {
        return new Promise((resolve, reject) => {
            const headers = { 'User-Agent': navigator.userAgent };
            if (meta.etag) headers['If-None-Match'] = meta.etag;
            if (meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: CONFIG.watch.requestTimeoutMs, headers,
                onload: r => resolve({
                    status: r.status,
                    text: r.responseText || '',
                    headers: parseHeaderMap(r.responseHeaders || ''),
                }),
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('timeout')),
            });
        });
    }

    function hostOf(key, p) { return isAliProduct(key, p) ? 'aliexpress' : 'jumia'; }
    function hostReady(state, host) {
        const h = state.hosts[host];
        return !h || !h.blockedUntil || h.blockedUntil <= Date.now();
    }
    function noteHostSuccess(state, host) {
        const h = state.hosts[host];
        if (h) { h.failures = 0; h.blockedUntil = 0; }
    }
    function noteHostFailure(state, host, retryAfterMs) {
        const h = state.hosts[host] || (state.hosts[host] = { failures: 0, blockedUntil: 0 });
        h.failures = (h.failures || 0) + 1;
        const backoff = retryAfterMs ||
            Math.min(24 * HOUR_MS, 30 * MIN_MS * Math.pow(2, Math.min(h.failures, 5)));
        h.blockedUntil = Date.now() + backoff;
        return h.blockedUntil;
    }

    function pruneWatchState(state, history) {
        for (const key of Object.keys(state.products))
            if (!history[key]) delete state.products[key];
        const cutoff = Date.now() - CONFIG.watch.campaignWindowMs;
        for (const [key, t] of Object.entries(state.canaries))
            if (!t || t < cutoff) delete state.canaries[key];
        if (state.campaignUntil && state.campaignUntil < Date.now()) {
            state.campaignUntil = 0;
            state.campaignSince = 0;
            state.canaries = {};
        }
    }

    // ── Applying a background result ─────────────────────────────
    function applyWatchedPrice(key, info, doc, url) {
        const history = loadHistory();
        const product = history[key];
        if (!product) return null;
        const now = Date.now();
        const last = product.samples.at(-1) || null;
        const changed = !last || last.p !== info.price;
        const stale = !last || now - (last.t || 0) >= DAY_MS;

        // Record a sample on changes, plus one baseline sample per day so a
        // quiet product doesn't bloat storage with identical points.
        if (changed || stale) {
            product.samples.push({ p: info.price, op: info.oldPrice || null, t: now, src: 'watch' });
            if (product.samples.length > CONFIG.maxSamplesPerProduct)
                product.samples = product.samples.slice(-CONFIG.maxSamplesPerProduct);
        }

        const image = imageFromDoc(doc, url, isAliProduct(key, product));
        if (image) product.image = image;
        const name = cleanProductName(info.name);
        if (name) product.name = name;
        product.url = url;
        product.currency = info.currency || product.currency || SITE.currency;
        product.site = product.site || (isAliProduct(key, product) ? 'aliexpress' : 'jumia');
        saveHistory(history);

        return {
            changed, stale, product,
            dropPercent: changed && last && info.price < last.p
                ? ((last.p - info.price) / last.p) * 100
                : null,
        };
    }

    async function checkWatchedProduct(key, product, state, canaries) {
        const w = CONFIG.watch;
        const host = hostOf(key, product);
        const meta = ensureWatchMeta(state, key, false);
        const url = product.url;
        if (!/^https?:/i.test(url || '')) return { ok: false, changed: false };

        let res;
        try {
            res = await fetchWatchPage(url, meta);
        } catch (e) {
            meta.failures = (meta.failures || 0) + 1;
            meta.nextCheck = Date.now() + 15 * MIN_MS;
            noteHostFailure(state, host, 10 * MIN_MS);
            warn('Smart watch fetch failed:', url, e.message);
            return { ok: false, changed: false };
        }

        const now = Date.now();
        if (res.status === 304) {
            noteHostSuccess(state, host);
            meta.lastCheck = now;
            meta.failures = 0;
            meta.misses = (meta.misses || 0) + 1;
            meta.etag = res.headers['etag'] || meta.etag;
            meta.lastModified = res.headers['last-modified'] || meta.lastModified;
            meta.nextCheck = now + watchNextDelay(key, product, meta, false, canaries);
            return { ok: true, changed: false };
        }

        if (res.status === 403 || res.status === 429 || res.status >= 500) {
            const retry = Math.max(
                parseRetryAfter(res.headers),
                res.status === 403 ? 6 * HOUR_MS : 30 * MIN_MS
            );
            const until = noteHostFailure(state, host, retry);
            meta.failures = (meta.failures || 0) + 1;
            meta.nextCheck = until;
            warn('Smart watch blocked:', url, 'HTTP ' + res.status);
            return { ok: false, changed: false };
        }

        if (res.status < 200 || res.status >= 300) {
            meta.failures = (meta.failures || 0) + 1;
            meta.nextCheck = noteHostFailure(state, host, 30 * MIN_MS);
            return { ok: false, changed: false };
        }

        const doc = new DOMParser().parseFromString(res.text, 'text/html');
        const info = extractPrice(doc, url);
        if (!info || info.price == null) {
            meta.failures = (meta.failures || 0) + 1;
            meta.nextCheck = now + Math.min(
                24 * HOUR_MS,
                30 * MIN_MS * Math.pow(2, Math.min(meta.failures, 4))
            );
            noteHostFailure(state, host, 30 * MIN_MS);
            warn('Smart watch: no price found at', url);
            return { ok: false, changed: false };
        }

        const applied = applyWatchedPrice(key, info, doc, url);
        if (!applied) return { ok: false, changed: false };

        noteHostSuccess(state, host);
        meta.lastCheck = now;
        meta.lastPrice = info.price;
        meta.failures = 0;
        meta.etag = res.headers['etag'] || null;
        meta.lastModified = res.headers['last-modified'] || null;
        meta.misses = applied.changed ? 0 : (meta.misses || 0) + 1;
        meta.nextCheck = now + watchNextDelay(key, applied.product, meta, applied.changed, canaries);

        if (applied.changed && canaries.has(key)) noteCanaryChange(state, key);

        if (applied.changed) {
            log('Smart watch:', key, info.price,
                applied.dropPercent != null ? `(-${applied.dropPercent.toFixed(1)}%)` : '');
            notifyDrop({
                product: applied.product, info,
                dropPercent: applied.dropPercent,
                siteLabel: siteLabelOf(key, applied.product),
            });
            const target = targetOf(applied.product);
            const prev = applied.product.samples.at(-2)?.p;
            if (target != null && info.price <= target && (prev == null || prev > target)) {
                notify(
                    `${siteLabelOf(key, applied.product)}: target reached`,
                    `${displayName(key, applied.product)}\n` +
                    `${formatMoney(info.price, info.currency || applied.product.currency)} ` +
                    `≤ target ${formatMoney(target, applied.product.currency)}`
                );
            }
        }
        return { ok: true, changed: !!applied.changed };
    }

    // ── Scheduling ───────────────────────────────────────────────
    function dueCandidates(history, state, canaries, now, currentKey) {
        const w = CONFIG.watch;
        const campaign = state.campaignUntil > now;
        const out = [];
        for (const [key, product] of Object.entries(history || {})) {
            if (key === currentKey) continue;
            if (!product || !Array.isArray(product.samples) || !product.samples.length) continue;
            if (!/^https?:/i.test(product.url || '')) continue;
            if (isAliProduct(key, product) && !w.fetchAliExpress) continue;
            if (!hostReady(state, hostOf(key, product))) continue;

            const meta = ensureWatchMeta(state, key, true);
            const canary = canaries.has(key);
            let dueAt = meta.nextCheck || 0;
            if (canary) dueAt = Math.min(dueAt, (meta.lastCheck || 0) + w.canaryIntervalMs);
            if (campaign && (meta.lastCheck || 0) < (state.campaignSince || 0))
                dueAt = Math.min(dueAt, now);
            if (dueAt > now) continue;

            const stale = now - (meta.lastCheck || 0) > w.maxIntervalMs;
            let priority = 0;
            if (canary) priority = 3;
            else if (campaign) priority = 2;
            else if (targetNear(product)) priority = 2;
            else if (meta.rechecksLeft > 0) priority = 2;
            else if (stale) priority = 1;

            out.push({ key, product, meta, priority, dueAt, canary, stale });
        }
        out.sort((a, b) => b.priority - a.priority || a.dueAt - b.dueAt);
        return out;
    }

    function chooseWatchCandidate(due, state, now) {
        if (!due.length) return null;
        const canary = due.find(c => c.canary);
        if (canary) return canary;
        if (state.campaignUntil > now) return due[0];
        return due.find(c => c.priority >= 2 || c.stale) || null;
    }

    function forcedCandidate(history, state, now, currentKey) {
        const canaries = selectCanaries(history);
        let best = null;
        for (const [key, product] of Object.entries(history || {})) {
            if (key === currentKey) continue;
            if (!product || !Array.isArray(product.samples) || !product.samples.length) continue;
            if (!/^https?:/i.test(product.url || '')) continue;
            if (isAliProduct(key, product) && !CONFIG.watch.fetchAliExpress) continue;
            if (!hostReady(state, hostOf(key, product))) continue;
            const meta = ensureWatchMeta(state, key, true);
            const cand = {
                key, product, meta,
                priority: canaries.has(key) ? 3 : 0,
                dueAt: meta.nextCheck || 0,
                canary: canaries.has(key),
                stale: false,
            };
            if (!best || (meta.lastCheck || 0) < (best.meta.lastCheck || 0)) best = cand;
        }
        return best;
    }

    function canRunWatch() {
        try {
            if (document.visibilityState !== 'visible') return false;
            if (navigator.onLine === false) return false;
            if (navigator.connection && navigator.connection.saveData) return false;
        } catch { /* ignore */ }
        return true;
    }

    async function smartWatchTick(force = false) {
        if (watchBusy) return;
        if (!swEnabled()) { renderWatchStatus(); return; }
        if (!canRunWatch()) return;

        const state = loadWatchState();
        const now = Date.now();
        if (state.lease && state.lease.until > now && state.lease.id !== WATCH_TAB_ID) return;
        if (!force && now - (state.lastRequestAt || 0) < CONFIG.watch.minGapMs) return;

        const budget = watchBudget(state);
        if (!force && budget.used >= CONFIG.watch.maxChecksPerDay) { renderWatchStatus(); return; }

        const history = loadHistory();
        pruneWatchState(state, history);
        const canaries = selectCanaries(history);
        const currentKey = isProductPage() ? getProductKey() : null;
        const due = dueCandidates(history, state, canaries, now, currentKey);
        let candidate = chooseWatchCandidate(due, state, now);
        if (!candidate && force) candidate = forcedCandidate(history, state, now, currentKey);
        if (!candidate) { saveWatchState(state); renderWatchStatus(); return; }

        watchBusy = true;
        state.lease = { id: WATCH_TAB_ID, until: now + CONFIG.watch.leaseMs };
        state.lastRequestAt = now;
        budget.used += 1;
        saveWatchState(state);

        let changed = false;
        try {
            const result = await checkWatchedProduct(candidate.key, candidate.product, state, canaries);
            changed = !!(result && result.changed);
        } catch (e) {
            warn('Smart watch check crashed:', e.message);
        } finally {
            watchBusy = false;
            state.lease = null;
            saveWatchState(state);
            updateTrackedBadge();
            if (changed) refreshDashboardIfOpen();
            else renderWatchStatus();
        }
    }

    function scheduleWatchTick(delay) {
        if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
        if (!swEnabled()) return;
        const base = delay != null ? delay : CONFIG.watch.tickMs;
        const wait = Math.max(
            2000,
            Math.round(base * (1 + (Math.random() * 2 - 1) * CONFIG.watch.jitter))
        );
        watchTimer = setTimeout(() => {
            watchTimer = null;
            smartWatchTick().finally(() => scheduleWatchTick());
        }, wait);
    }

    function initSmartWatch() {
        document.addEventListener('visibilitychange', () => {
            if (swEnabled() && document.visibilityState === 'visible') scheduleWatchTick(8000);
        });
        window.addEventListener('online', () => {
            if (swEnabled()) scheduleWatchTick(8000);
        });
        if (swEnabled()) scheduleWatchTick(12000);
    }

    function watchStatusText() {
        if (!swEnabled()) return 'Off — prices update only when you visit a product page.';
        const history = loadHistory();
        const eligible = Object.entries(history).filter(([key, p]) =>
            p && Array.isArray(p.samples) && p.samples.length &&
            (!isAliProduct(key, p) || CONFIG.watch.fetchAliExpress)
        );
        if (!eligible.length) {
            return Object.keys(history).length
                ? 'No background-checkable products — AliExpress is visit-only.'
                : 'No products tracked yet.';
        }

        const state = loadWatchState();
        const budget = watchBudget(state);
        const now = Date.now();
        const canaries = selectCanaries(history);
        let next = Infinity;
        for (const [key] of eligible) {
            const meta = state.products[key];
            if (!meta) continue;
            const due = canaries.has(key)
                ? Math.min(meta.nextCheck || 0, (meta.lastCheck || 0) + CONFIG.watch.canaryIntervalMs)
                : (meta.nextCheck || 0);
            if (due > now) next = Math.min(next, due);
        }

        const parts = [`${budget.used}/${CONFIG.watch.maxChecksPerDay} checks today`];
        parts.push(`${canaries.size} canar${canaries.size === 1 ? 'y' : 'ies'}`);
        if (next !== Infinity) parts.push(`next in ${shortDuration(next - now)}`);
        const blocked = ['jumia', 'aliexpress']
            .map(host => state.hosts[host] && state.hosts[host].blockedUntil)
            .filter(t => t > now)
            .sort((a, b) => a - b)[0];
        if (blocked) parts.push(`paused ${shortDuration(blocked - now)}`);
        if (state.campaignUntil > now) parts.push('campaign sweep');
        return parts.join(' · ');
    }

    function renderWatchStatus() {
        const modal = document.getElementById(CONFIG.trackedModalId);
        if (!modal) return;
        const cb = modal.querySelector('.jtm-watch-cb');
        if (cb) cb.checked = swEnabled();
        const status = modal.querySelector('.jtm-watch-status');
        if (status) status.textContent = watchStatusText();
        const checkNow = modal.querySelector('.jtm-watch-now');
        if (checkNow) checkNow.disabled = !swEnabled();
    }

    // ──────────────────────────────────────────────────────────────
    // 5. COUPONS — strict validator + two-tier extraction
    // ──────────────────────────────────────────────────────────────

    // Full-token rejections. If the code equals one of these, drop it.
    const NOISE_EXACT = new Set([
        'CODE','COUPON','COUPONS','VOUCHER','VOUCHERS','PROMO','PROMOS',
        'APPLY','APPLIED','USED','USE','USES',
        'SAVE','OFF','FREE','SHOP','SHOPPING','VIEW','MORE','LESS','DEAL','DEALS',
        'OFFER','OFFERS','SALE','DISCOUNT','CLEARANCE',
        'NEW','OLD','BEST','TOP','HOT','TRENDING','POPULAR',
        'LOGIN','LOGOUT','SIGNIN','SIGNOUT','REGISTER','SIGNUP','ACCOUNT','PROFILE',
        'HELP','MENU','HOME','SEARCH','CART','BASKET','CHECKOUT','ORDER','ORDERS',
        'RETURN','RETURNS','POLICY','CONTACT','ABOUT','TERMS','PRIVACY','COOKIE','COOKIES',
        'NEWSLETTER','SUBSCRIBE','FOLLOW','SHARE','COMMENT','COMMENTS',
        'LOADING','ERROR','WARNING','SUCCESS','FAILED','FAIL',
        'PRODUCT','PRODUCTS','CATEGORY','CATEGORIES','ITEM','ITEMS',
        'PAYMENT','PAYMENTS','DELIVERY','SHIPPING','DELIVER','DELIVERED',
        'PRICE','PRICES','TOTAL','SUBTOTAL','AMOUNT',
        'BUTTON','SUBMIT','CANCEL','CLOSE','NEXT','PREV','PREVIOUS',
        'IMAGE','IMAGES','PHOTO','PHOTOS','VIDEO','VIDEOS',
        'MODULE','MODULES','CONTENT','NAVBAR','SIDEBAR','HEADER','FOOTER','BODY',
        'JUMIA','JUMIAGH','GHANA',
        'ALIEXPRESS','ALIBABA','EXPRESS','SUPERDEALS',
        'INFO','SHOW','HIDE','EDIT','DELETE','REMOVE','ADD','UPDATE','CHANGE',
        'SELECT','CHOOSE','YES','NO','OK','BACK','FORWARD',
        'SKIP','MAIN','NAVIGATE','NAVIGATION','SIGN',
    ]);

    // Substring rejections — only long, unambiguous UI phrases that could not
    // reasonably appear inside a real coupon code.
    const NOISE_SUBSTRINGS = [
        'LOGIN','LOGOUT','SIGNIN','SIGNOUT',
        'MODULE','MODULES',
        'NAVBAR','SIDEBAR',
        'NEWSLETTER','SUBSCRIBE',
        'JUMIA','ALIEXPRESS',
    ];

    // Context patterns. \b around keyword + tight window + \b around code.
    // Supports full-width colon so AliExpress campaign pages ("Code：AE10") match.
    const CONTEXT_RE = /\b(?:promo\s*code|coupon\s*code|voucher\s*code|discount\s*code|code|coupon|voucher|promo)\b[\s:：\-=]{0,4}([A-Z0-9][A-Z0-9\-_]{3,15})\b/gi;

    // Elements likely to hold a coupon code.
    const COUPON_SELECTORS = [
        '[class*="coupon"]', '[class*="voucher"]', '[class*="promo"]',
        '[id*="coupon"]', '[id*="voucher"]', '[id*="promo"]',
    ].join(',');

    /** Detects repeated substrings: HELPHELP, ABCABC, ABABAB… */
    function hasRepeatPattern(s) {
        if (!s) return false;
        for (let len = 1; len <= s.length / 2; len++) {
            if (s.length % len !== 0) continue;
            const sub = s.slice(0, len);
            let same = true;
            for (let i = len; i < s.length; i += len) {
                if (s.slice(i, i + len) !== sub) { same = false; break; }
            }
            if (same) return true;
        }
        return false;
    }

    /**
     * The gatekeeper. Every candidate — regardless of source — must pass this.
     * @param {string} raw
     * @param {{strict?: boolean}} [opts] - strict = require a digit (body-text tier)
     */
    function isPlausibleCoupon(raw, opts = {}) {
        if (!raw) return false;
        const s = String(raw).toUpperCase().trim();

        // Length bounds
        if (s.length < 4 || s.length > 16) return false;

        // Char set — alnum with optional -/_ inside, alnum at both ends
        if (!/^[A-Z0-9][A-Z0-9\-_]*[A-Z0-9]$/.test(s)) return false;

        // Reject pure-digit strings longer than 6 (SKUs, barcodes, order IDs)
        if (/^\d{7,}$/.test(s)) return false;

        // Exact-word noise
        if (NOISE_EXACT.has(s)) return false;

        // Substring noise (catches SLOGOUTHELPHELP, MYMODULECODE, …)
        for (const n of NOISE_SUBSTRINGS) if (s.includes(n)) return false;

        // Repeated-substring patterns
        if (hasRepeatPattern(s)) return false;

        const hasDigit = /\d/.test(s);
        const hasPunct = /[-_]/.test(s);

        // Strict tier: body-text matches MUST contain a digit.
        if (opts.strict && !hasDigit) return false;

        // Lenient tier: no digit AND no punctuation → cap at 10 chars.
        // Blocks "CONGRATULATIONS", "WELCOMETOSTORE", etc.
        if (!hasDigit && !hasPunct && s.length > 10) return false;

        return true;
    }

    function findDescription(el, code) {
        if (!el) return '';
        const t = (el.textContent || '').trim();
        return t.replace(new RegExp(code, 'i'), '').replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    /**
     * Only stores codes that pass isPlausibleCoupon.
     * Caller is responsible for validation; this is a pure insert.
     */
    function addCoupon(map, raw, el, source, now) {
        const code = String(raw).toUpperCase().trim();
        if (!isPlausibleCoupon(code, { strict: false })) return;
        if (map.has(code)) { map.get(code).lastSeen = now; return; }

        const description = el ? findDescription(el, code) : '';
        // Parse a display-only expiry from surrounding text (never used to delete).
        const expiry = parseExpiry(description || (el?.textContent || ''));
        map.set(code, {
            code, description, source,
            firstSeen: now, lastSeen: now,
            expiry: expiry || null,
            hits: 1,
        });
    }

    function parseExpiry(text) {
        if (!text) return null;
        let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime();
        m = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i);
        if (m) {
            const mo = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            return new Date(+m[3], mo[m[2].toLowerCase().slice(0,3)], +m[1], 23, 59, 59).getTime();
        }
        m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2], 23, 59, 59).getTime();
        return null;
    }

    /**
     * Two-tier extraction:
     *   Tier A — elements whose class/id clearly marks them as coupon fields.
     *   Tier B — page body text, but ONLY when the digit requirement is met.
     * Nothing else is accepted.
     */
    function extractCouponsFromDom(root, source) {
        const found = new Map();
        const now = Date.now();
        const isDoc = !!root.body;
        const doc = isDoc ? root : (root.ownerDocument || document);

        // ── Tier A: dedicated coupon elements ────────────────────
        const couponNodes = doc.querySelectorAll ? doc.querySelectorAll(COUPON_SELECTORS) : [];
        couponNodes.forEach(el => {
            const text = (el.textContent || '').trim();
            if (!text || text.length > 400) return;

            const cls = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();

            // A1. Direct code field: <span class="coupon-code">SAVE10</span>
            //     Only the FIRST token is considered — no paragraph leaks.
            const looksLikeCodeField =
                /(?:^|[\s_-])(?:code|coupon[-_]?code|voucher[-_]?code|promo[-_]?code)(?:$|[\s_-])/.test(cls);

            if (looksLikeCodeField) {
                const candidate = text.split(/\s+/)[0];
                if (isPlausibleCoupon(candidate, { strict: false })) {
                    addCoupon(found, candidate, el, source, now);
                }
            }

            // A2. Contextual patterns inside the element: "code XXXX"
            CONTEXT_RE.lastIndex = 0;
            let m;
            while ((m = CONTEXT_RE.exec(text)) !== null) {
                if (isPlausibleCoupon(m[1], { strict: false })) {
                    addCoupon(found, m[1], el, source, now);
                }
            }
        });

        // ── Tier B: body text — strict, digit required ───────────
        const bodyText = (doc.body || doc.documentElement)?.innerText || '';
        if (bodyText) {
            CONTEXT_RE.lastIndex = 0;
            let m;
            while ((m = CONTEXT_RE.exec(bodyText)) !== null) {
                if (isPlausibleCoupon(m[1], { strict: true })) {
                    addCoupon(found, m[1], null, source, now);
                }
            }
        }

        return [...found.values()];
    }

    function loadCoupons() {
        try { return JSON.parse(GM_getValue(CONFIG.couponStorageKey, '[]')); }
        catch { return []; }
    }
    function saveCoupons(list) {
        let f = list.slice();
        if (f.length > CONFIG.maxCoupons) {
            f.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
            f = f.slice(0, CONFIG.maxCoupons);
        }
        try { GM_setValue(CONFIG.couponStorageKey, JSON.stringify(f)); }
        catch (e) { warn('saveCoupons failed', e); }
    }

    /** Removes any previously-stored coupons that fail current validation. */
    function purgeInvalidCoupons() {
        const store = loadCoupons();
        if (!store.length) return 0;
        const cleaned = store.filter(c => isPlausibleCoupon(c.code, { strict: false }));
        const removed = store.length - cleaned.length;
        if (removed > 0) {
            log(`Purged ${removed} invalid coupon(s) from store.`);
            saveCoupons(cleaned);
        }
        return removed;
    }

    function mergeCoupons(newOnes) {
        const store = loadCoupons();
        const byCode = new Map(store.map(c => [c.code, c]));
        let added = 0, updated = 0;
        for (const nc of newOnes) {
            if (!isPlausibleCoupon(nc.code, { strict: false })) continue;
            if (byCode.has(nc.code)) {
                const ex = byCode.get(nc.code);
                ex.lastSeen = Math.max(ex.lastSeen || 0, nc.lastSeen || 0);
                ex.firstSeen = ex.firstSeen || nc.firstSeen;
                if ((nc.description || '').length > (ex.description || '').length)
                    ex.description = nc.description;
                // Expiry can only be extended, never shrunk
                if (nc.expiry && (!ex.expiry || nc.expiry > ex.expiry))
                    ex.expiry = nc.expiry;
                ex.hits = (ex.hits || 1) + 1;
                updated++;
            } else {
                byCode.set(nc.code, nc);
                added++;
            }
        }
        saveCoupons([...byCode.values()]);
        return { added, updated };
    }

    function fetchHtml(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                headers: { 'User-Agent': navigator.userAgent },
                onload: r => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
                onerror: reject, ontimeout: () => reject(new Error('timeout')),
            });
        });
    }

    async function refreshCouponsFromWeb(force = false) {
        const last = GM_getValue(CONFIG.couponLastSyncKey, 0);
        if (!force && Date.now() - last < CONFIG.couponCacheTTLMs)
            return { added: 0, updated: 0, cached: true };

        let added = 0, updated = 0;
        for (const url of CONFIG.couponPageUrls) {
            try {
                const html = await fetchHtml(url);
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const list = extractCouponsFromDom(doc, url);
                if (list.length) {
                    const r = mergeCoupons(list);
                    added += r.added; updated += r.updated;
                    break;
                }
            } catch (e) { warn('Coupon fetch failed:', url, e.message); }
        }
        GM_setValue(CONFIG.couponLastSyncKey, Date.now());
        return { added, updated, cached: false };
    }

    function scanCurrentPageForCoupons() {
        const found = extractCouponsFromDom(document, location.href);
        if (found.length) return mergeCoupons(found);
        return { added: 0, updated: 0 };
    }

    function rankCoupons(productName) {
        const all = loadCoupons();
        const tokens = (productName || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const scored = all.map(c => {
            let s = 0;
            const desc = (c.description || '').toLowerCase();
            const ageH = (Date.now() - (c.lastSeen || 0)) / 3.6e6;
            s += Math.max(0, 30 - ageH / 24);
            if (c.expiry) {
                const dLeft = (c.expiry - Date.now()) / 8.64e7;
                if (dLeft > 0) s += Math.min(20, dLeft / 2);
                else s -= 30;
            }
            for (const t of tokens) if (desc.includes(t)) s += 15;
            if (/all|any|site.?wide|everything|store/i.test(desc)) s += 10;
            if (/free\s*ship/i.test(desc)) s += 5;
            s += Math.min(5, (c.hits || 1));
            return { c, s };
        });
        scored.sort((a, b) => b.s - a.s);
        return scored.map(x => x.c);
    }

    function isShowAll() { return !!GM_getValue(CONFIG.couponShowAllKey, false); }
    function setShowAll(v) { GM_setValue(CONFIG.couponShowAllKey, !!v); }

    // ──────────────────────────────────────────────────────────────
    // 6. MAIN PANEL
    // ──────────────────────────────────────────────────────────────
    function createPanel() {
        if (document.getElementById(CONFIG.uiPanelId)) return;
        const panel = document.createElement('div');
        panel.id = CONFIG.uiPanelId;
        panel.innerHTML = `
            <div class="jpt-header">
                <span class="jpt-title">💰 Price Tracker</span>
                <span class="jpt-site">${escapeHtml(SITE.shortLabel)}</span>
                <button class="jpt-tracked-btn" title="View all tracked products">📊 <span class="jpt-tracked-count">0</span></button>
                <button class="jpt-close" title="Close">×</button>
            </div>
            <div class="jpt-body">
                <div class="jpt-product">
                    <span class="jpt-thumb jpt-thumb-empty">🛍</span>
                    <span class="jpt-product-name"></span>
                </div>
                <div class="jpt-current">Detecting…</div>
                <div class="jpt-stats"></div>
                <div class="jpt-actions">
                    <button class="jpt-btn jpt-refresh">Refresh</button>
                    <button class="jpt-btn jpt-find-coupons">Find Coupons</button>
                    <button class="jpt-btn jpt-clear">Clear</button>
                </div>
                <div class="jpt-coupons-section">
                    <div class="jpt-coupons-header">
                        <span>🎟 Coupons <span class="jpt-coupons-count"></span></span>
                        <label class="jpt-showall">
                            <input type="checkbox" class="jpt-showall-cb" /> all
                        </label>
                    </div>
                    <div class="jpt-coupons-status"></div>
                    <div class="jpt-coupons-list"></div>
                </div>
            </div>
            <div class="jpt-toast"></div>
        `;
        document.body.appendChild(panel);

        GM_addStyle(`
            #${CONFIG.uiPanelId} {
                position: fixed; bottom: 20px; right: 20px; z-index: 99999;
                width: 330px; max-height: 80vh; background: #fff; border: 1px solid #ddd;
                border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                font-family: system-ui, -apple-system, sans-serif; font-size: 13px; color: #333;
                display: flex; flex-direction: column;
                color-scheme: only light;
            }
            #${CONFIG.uiPanelId} .jpt-header {
                display: flex; align-items: center; gap: 6px;
                padding: 8px 12px; background: #f5f5f5; border-bottom: 1px solid #ddd;
                border-radius: 8px 8px 0 0; font-weight: 600;
            }
            #${CONFIG.uiPanelId} .jpt-title { flex: 1; }
            #${CONFIG.uiPanelId} .jpt-site {
                font-size: 10px; font-weight: 700; letter-spacing: .3px;
                background: #eaf1ff; color: #2456a6; border: 1px solid #cfdcff;
                padding: 1px 5px; border-radius: 3px; white-space: nowrap;
            }
            #${CONFIG.uiPanelId} .jpt-tracked-btn {
                background: #fff; border: 1px solid #ccc; border-radius: 4px;
                font-size: 11px; padding: 2px 7px; cursor: pointer; font-weight: 700;
                color: #333;
            }
            #${CONFIG.uiPanelId} .jpt-tracked-btn:hover { background: #f0f0f0; }
            #${CONFIG.uiPanelId} .jpt-close {
                background: none; border: none; font-size: 18px; cursor: pointer;
                color: #999; line-height: 1;
            }
            #${CONFIG.uiPanelId} .jpt-close:hover { color: #333; }
            #${CONFIG.uiPanelId} .jpt-body { padding: 12px; overflow-y: auto; }
            #${CONFIG.uiPanelId} .jpt-product {
                display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
            }
            #${CONFIG.uiPanelId} .jpt-thumb {
                flex: 0 0 40px; width: 40px; height: 40px;
                display: flex; align-items: center; justify-content: center;
                border: 1px solid #e5e5e5; border-radius: 6px; background: #fafafa;
                overflow: hidden; font-size: 18px; color: #b5b5b5;
            }
            #${CONFIG.uiPanelId} .jpt-thumb img {
                width: 100%; height: 100%; object-fit: contain; display: block;
            }
            #${CONFIG.uiPanelId} .jpt-product-name {
                flex: 1; min-width: 0; font-size: 12px; font-weight: 600;
                color: #333; line-height: 1.25;
                display: -webkit-box; -webkit-line-clamp: 2;
                -webkit-box-orient: vertical; overflow: hidden;
            }
            #${CONFIG.uiPanelId} .jpt-current { margin-bottom: 6px; font-weight: 600; }
            #${CONFIG.uiPanelId} .jpt-stats { margin-bottom: 10px; color: #666; font-size: 12px; }
            #${CONFIG.uiPanelId} .jpt-actions { display: flex; gap: 6px; margin-bottom: 10px; }
            #${CONFIG.uiPanelId} .jpt-btn {
                flex: 1; padding: 6px 4px; border: 1px solid #ccc;
                border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px;
                color: #333;
            }
            #${CONFIG.uiPanelId} .jpt-btn:hover { background: #f0f0f0; }
            #${CONFIG.uiPanelId} .jpt-btn:disabled { opacity: .6; cursor: wait; }
            #${CONFIG.uiPanelId} .jpt-coupons-section { border-top: 1px solid #eee; padding-top: 8px; }
            #${CONFIG.uiPanelId} .jpt-coupons-header {
                display: flex; justify-content: space-between; align-items: center;
                font-size: 12px; font-weight: 600; margin-bottom: 4px; color: #555;
            }
            #${CONFIG.uiPanelId} .jpt-showall {
                font-weight: 500; font-size: 11px; color: #777;
                display: flex; align-items: center; gap: 4px; cursor: pointer;
            }
            #${CONFIG.uiPanelId} .jpt-coupons-status { font-size: 10px; color: #999; margin-bottom: 6px; }
            #${CONFIG.uiPanelId} .jpt-coupons-list { max-height: 240px; overflow-y: auto; }
            #${CONFIG.uiPanelId} .jpt-coupon {
                background: #fff8ef; border: 1px dashed #ffb066;
                border-radius: 6px; padding: 6px 8px; margin-bottom: 6px;
            }
            #${CONFIG.uiPanelId} .jpt-coupon.jpt-expired { background: #f5f5f5; border-color: #ccc; opacity: .7; }
            #${CONFIG.uiPanelId} .jpt-coupon-row1 { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
            #${CONFIG.uiPanelId} .jpt-coupon-code {
                font-family: ui-monospace, Menlo, monospace; font-weight: 700;
                color: #d35400; cursor: pointer; font-size: 13px; letter-spacing: .5px;
                background: #fff; border: 1px solid #ffb066; padding: 1px 5px; border-radius: 3px;
            }
            #${CONFIG.uiPanelId} .jpt-coupon-code:hover { background: #ffeedd; }
            #${CONFIG.uiPanelId} .jpt-coupon-expiry { font-size: 10px; color: #a05a1a; margin-left: auto; }
            #${CONFIG.uiPanelId} .jpt-coupon-desc { font-size: 11px; color: #666; line-height: 1.3; }
            #${CONFIG.uiPanelId} .jpt-no-coupons { color: #999; font-size: 12px; padding: 6px 0; text-align: center; }
            #${CONFIG.uiPanelId} .jpt-toast {
                position: fixed; bottom: 30px; right: 370px;
                background: #333; color: #fff; padding: 8px 14px;
                border-radius: 6px; font-size: 12px; opacity: 0;
                transition: opacity .25s; pointer-events: none; z-index: 100000;
            }
            #${CONFIG.uiPanelId} .jpt-toast.show { opacity: 1; }
        `);

        const toast = panel.querySelector('.jpt-toast');
        panel.querySelector('.jpt-close').addEventListener('click', () => panel.remove());
        panel.querySelector('.jpt-refresh').addEventListener('click', () => {
            const r = recordPrice(); updatePanel(r); updateTrackedBadge();
        });
        panel.querySelector('.jpt-find-coupons').addEventListener('click', async () => {
            const b = panel.querySelector('.jpt-find-coupons');
            b.textContent = 'Searching…'; b.disabled = true;
            const local = scanCurrentPageForCoupons();
            const web = await refreshCouponsFromWeb(true);
            renderCoupons();
            b.textContent = 'Find Coupons'; b.disabled = false;
            toast.textContent = `+${(local.added||0) + (web.added||0)} new, ${(local.updated||0) + (web.updated||0)} updated`;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        });
        panel.querySelector('.jpt-clear').addEventListener('click', () => {
            if (!confirm('Clear price history and cached coupons for this site?')) return;
            const k = getProductKey();
            const h = loadHistory(); delete h[k]; saveHistory(h);
            GM_setValue(CONFIG.couponStorageKey, '[]');
            GM_setValue(CONFIG.couponLastSyncKey, 0);
            updatePanel(null); updateTrackedBadge(); renderCoupons();
        });
        panel.querySelector('.jpt-tracked-btn').addEventListener('click', openTrackedModal);

        const showAllCb = panel.querySelector('.jpt-showall-cb');
        showAllCb.checked = isShowAll();
        showAllCb.addEventListener('change', () => { setShowAll(showAllCb.checked); renderCoupons(); });

        panel.querySelector('.jpt-coupons-list').addEventListener('click', e => {
            const el = e.target.closest('.jpt-coupon-code');
            if (!el) return;
            copyToClipboard(el.dataset.code).then(() => {
                toast.textContent = `Copied: ${el.dataset.code}`;
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 1400);
            });
        });
    }

    function updateTrackedBadge() {
        const el = document.querySelector(`#${CONFIG.uiPanelId} .jpt-tracked-count`);
        if (el) el.textContent = Object.keys(loadHistory()).length;
    }
    function updatePanel(result) {
        const panel = document.getElementById(CONFIG.uiPanelId);
        if (!panel) return;
        const cur = panel.querySelector('.jpt-current');
        const st = panel.querySelector('.jpt-stats');
        const nameEl = panel.querySelector('.jpt-product-name');
        const thumbEl = panel.querySelector('.jpt-thumb');
        if (!result) {
            cur.textContent = 'No price data on this page.';
            st.textContent = '';
            if (nameEl) nameEl.textContent = '';
            setThumb(thumbEl, '');
            return;
        }
        const { product, dropPercent, info } = result;
        const curCode = info.currency || product.currency || SITE.currency;
        if (nameEl) nameEl.textContent = displayName(product.url || '', product);
        setThumb(thumbEl, product.image, product.name);
        cur.textContent = `Current: ${formatMoney(info.price, curCode)}`;
        if (info.oldPrice) cur.textContent += `  (was ${formatMoney(info.oldPrice, curCode)})`;
        let s = `Samples: ${product.samples.length}`;
        if (product.samples.length > 1) {
            const first = product.samples[0].p, last = product.samples.at(-1).p;
            const ch = ((last - first) / first) * 100;
            s += `  |  Change: ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`;
        }
        if (dropPercent != null && dropPercent >= CONFIG.dropThresholdPercent)
            s += `  |  🎉 Drop: -${dropPercent.toFixed(1)}%`;
        st.textContent = s;
    }

    function renderCoupons() {
        const panel = document.getElementById(CONFIG.uiPanelId);
        if (!panel) return;
        const list = panel.querySelector('.jpt-coupons-list');
        const countEl = panel.querySelector('.jpt-coupons-count');
        const statusEl = panel.querySelector('.jpt-coupons-status');
        const showAll = isShowAll();

        const productName = document.querySelector('h1.name, h1[data-pl="product-title"], h1')?.textContent.trim() || '';
        const ranked = rankCoupons(productName);
        const total = ranked.length;

        const lastSync = GM_getValue(CONFIG.couponLastSyncKey, 0);
        statusEl.textContent = `${total} stored · synced ${timeAgo(lastSync)}`;

        let view = ranked;
        if (!showAll) view = ranked.slice(0, 10);
        countEl.textContent = showAll ? `(${view.length}/${total})` : `(${Math.min(view.length, total)})`;

        if (!view.length) {
            list.innerHTML = total
                ? '<div class="jpt-no-coupons">No relevant coupons for this product.<br>Tick <b>all</b> to see the full list.</div>'
                : (IS_ALI
                    ? '<div class="jpt-no-coupons">No AliExpress codes cached yet.<br>Visit a sale/campaign page or click "Find Coupons".</div>'
                    : '<div class="jpt-no-coupons">No coupons cached yet.<br>Click "Find Coupons".</div>');
            return;
        }

        const now = Date.now();
        list.innerHTML = view.map(c => {
            const expired = c.expiry && c.expiry < now;
            const exp = c.expiry
                ? new Date(c.expiry).toLocaleDateString('en-GH', { day: '2-digit', month: 'short' })
                : '';
            return `
                <div class="jpt-coupon ${expired ? 'jpt-expired' : ''}">
                    <div class="jpt-coupon-row1">
                        <span class="jpt-coupon-code" data-code="${escapeHtml(c.code)}" title="Click to copy">${escapeHtml(c.code)}</span>
                        ${exp ? `<span class="jpt-coupon-expiry">${expired ? 'expired ' : 'exp '}${escapeHtml(exp)}</span>` : ''}
                    </div>
                    ${c.description ? `<div class="jpt-coupon-desc">${escapeHtml(c.description)}</div>` : ''}
                </div>`;
        }).join('');
    }

    // ──────────────────────────────────────────────────────────────
    // 7. TRACKED PRODUCTS DASHBOARD
    // ──────────────────────────────────────────────────────────────
    /**
     * Fetches product pages for tracked items that have no image yet and
     * stores the first usable image URL. Limited per click so it can be
     * resumed; AliExpress pages often block these requests (they are
     * captured live instead, while you browse).
     */
    async function backfillImages(limit = 30) {
        const queue = Object.entries(loadHistory())
            .filter(([, p]) => p && !p.image)
            .filter(([, p]) => /^https?:/i.test(p.url || ''))
            .slice(0, limit);

        let ok = 0, failed = 0;
        const total = queue.length;

        const worker = async () => {
            for (;;) {
                const item = queue.shift();
                if (!item) return;
                const [key, p] = item;
                try {
                    const html = await fetchHtml(p.url);
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const isAliTarget = p.site === 'aliexpress' || key.startsWith('ali:');
                    const img = imageFromDoc(doc, p.url, isAliTarget);
                    if (img) {
                        const h = loadHistory();
                        if (h[key]) {
                            h[key].image = img;
                            saveHistory(h);
                        }
                        ok++;
                    } else failed++;
                } catch (e) {
                    failed++;
                    warn('Image backfill failed:', p.url, e.message);
                }
                // Be polite to the site between requests.
                await new Promise(r => setTimeout(r, 250));
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(2, total) }, worker)
        );

        const remaining = Object.values(loadHistory()).filter(p => !p || !p.image).length;
        return { ok, failed, remaining, total };
    }

    /**
     * Prompts for a target price. Targets drive smart-watch priority: products
     * near their target are checked more often; products at target are left
     * alone (what you'd buy anyway).
     */
    function editTarget(key) {
        const h = loadHistory();
        const p = h[key];
        if (!p) return;
        const code = p.currency || 'GHS';
        const cur = p.samples?.at(-1)?.p;
        const existing = typeof p.target === 'number' ? String(p.target) : '';
        const answer = prompt(
            `Target price in ${code} for:\n${displayName(key, p)}\n\n` +
            `Current: ${cur != null ? formatMoney(cur, code) : '—'}\n` +
            'Leave empty to remove the target.',
            existing
        );
        if (answer == null) return;
        const trimmed = answer.trim();
        if (!trimmed) {
            delete p.target;
        } else {
            const value = parsePrice(trimmed);
            if (value == null || value <= 0) {
                alert('Enter a valid price, for example 199.99');
                return;
            }
            p.target = value;
        }
        saveHistory(h);
        resetWatchMeta(key);
        renderTrackedModal();
    }

    function openTrackedModal() {
        if (document.getElementById(CONFIG.trackedModalId)) { renderTrackedModal(true); return; }
        const modal = document.createElement('div');
        modal.id = CONFIG.trackedModalId;
        modal.innerHTML = `
            <div class="jtm-backdrop"></div>
            <div class="jtm-content">
                <div class="jtm-header">
                    <span>📊 Tracked Products</span>
                    <span class="jtm-count"></span>
                    <button class="jtm-close">×</button>
                </div>
                <div class="jtm-watch">
                    <label class="jtm-watch-toggle" title="Background checks run only while a Jumia/AliExpress tab is open.">
                        <input type="checkbox" class="jtm-watch-cb">
                        <span>Smart watch</span>
                    </label>
                    <span class="jtm-watch-status">Off</span>
                    <button class="jtm-watch-now" disabled>Check now</button>
                </div>
                <div class="jtm-body"></div>
                <div class="jtm-footer">
                    <button class="jtm-export">Export JSON</button>
                    <button class="jtm-import">Import JSON</button>
                    <button class="jtm-backfill">Fetch images</button>
                    <button class="jtm-clear-all">Clear All</button>
                </div>
                <div class="jtm-import-wrap">
                    <div class="jtm-import-title">Paste JSON exported from the old script, then click Merge:</div>
                    <textarea class="jtm-import-ta" spellcheck="false" placeholder='{ "some-product-123": { "name": "…", "samples": [ … ] } }'></textarea>
                    <div class="jtm-import-actions">
                        <button class="jtm-import-ok">Merge</button>
                        <button class="jtm-import-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        GM_addStyle(`
            #${CONFIG.trackedModalId} .jtm-backdrop {
                position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100000;
            }
            #${CONFIG.trackedModalId} .jtm-content {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                width: min(720px, 92vw); max-height: 80vh;
                background: #fff; border-radius: 10px; z-index: 100001;
                display: flex; flex-direction: column; overflow: hidden;
                font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
                box-shadow: 0 12px 32px rgba(0,0,0,.25);
                color: #333;
                color-scheme: only light;
            }
            #${CONFIG.trackedModalId} .jtm-header {
                display: flex; align-items: center; gap: 10px;
                padding: 12px 16px; background: #f5f5f5; border-bottom: 1px solid #ddd;
                font-weight: 700; font-size: 14px;
            }
            #${CONFIG.trackedModalId} .jtm-count { color: #888; font-weight: 500; font-size: 12px; }
            #${CONFIG.trackedModalId} .jtm-close {
                margin-left: auto; background: none; border: none;
                font-size: 22px; line-height: 1; cursor: pointer; color: #999;
            }
            #${CONFIG.trackedModalId} .jtm-close:hover { color: #333; }
            #${CONFIG.trackedModalId} .jtm-body { flex: 1; overflow-y: auto; padding: 10px 16px; }
            #${CONFIG.trackedModalId} .jtm-watch {
                display: flex; align-items: center; gap: 10px;
                padding: 7px 16px; background: #fbfbfb;
                border-bottom: 1px solid #eee; font-size: 11px; color: #666;
            }
            #${CONFIG.trackedModalId} .jtm-watch-toggle {
                display: flex; align-items: center; gap: 5px;
                font-weight: 600; color: #333; cursor: pointer; white-space: nowrap;
            }
            #${CONFIG.trackedModalId} .jtm-watch-toggle input { margin: 0; cursor: pointer; }
            #${CONFIG.trackedModalId} .jtm-watch-status {
                flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${CONFIG.trackedModalId} .jtm-watch-now {
                padding: 4px 9px; border: 1px solid #ccc; background: #fff;
                border-radius: 4px; cursor: pointer; font-size: 11px; color: #333;
                white-space: nowrap;
            }
            #${CONFIG.trackedModalId} .jtm-watch-now:hover:not(:disabled) { background: #f0f0f0; }
            #${CONFIG.trackedModalId} .jtm-watch-now:disabled { opacity: .5; cursor: default; }
            #${CONFIG.trackedModalId} .jtm-footer {
                display: flex; gap: 8px; padding: 10px 16px;
                border-top: 1px solid #eee; background: #fafafa;
            }
            #${CONFIG.trackedModalId} .jtm-footer button {
                padding: 6px 12px; border: 1px solid #ccc; background: #fff;
                border-radius: 4px; cursor: pointer; font-size: 12px; color: #333;
            }
            #${CONFIG.trackedModalId} .jtm-footer button:hover { background: #f0f0f0; }
            #${CONFIG.trackedModalId} .jtm-footer .jtm-clear-all { margin-left: auto; color: #b00; border-color: #e2b3b3; }
            #${CONFIG.trackedModalId} .jtm-footer .jtm-clear-all:hover { background: #fdecec; }
            #${CONFIG.trackedModalId} .jtm-row {
                display: grid; grid-template-columns: 1fr auto auto auto auto auto auto;
                gap: 10px; align-items: center;
                padding: 8px 6px; border-bottom: 1px solid #f0f0f0;
            }
            #${CONFIG.trackedModalId} .jtm-row:last-child { border-bottom: none; }
            #${CONFIG.trackedModalId} .jtm-name {
                position: relative;
                display: flex; align-items: center; gap: 8px; min-width: 0;
                font-weight: 600; color: #222;
            }
            #${CONFIG.trackedModalId} .jtm-thumb {
                flex: 0 0 40px; width: 40px; height: 40px;
                display: flex; align-items: center; justify-content: center;
                border: 1px solid #e8e8e8; border-radius: 6px; background: #fafafa;
                overflow: hidden; font-size: 17px; color: #b5b5b5;
                font-weight: 400;
            }
            #${CONFIG.trackedModalId} .jtm-thumb img {
                width: 100%; height: 100%; object-fit: contain; display: block;
            }
            #${CONFIG.trackedModalId} .jtm-name-main {
                display: flex; align-items: center; min-width: 0; overflow: hidden;
            }
            #${CONFIG.trackedModalId} .jtm-name-text {
                color: inherit; min-width: 0;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            #${CONFIG.trackedModalId} .jtm-name:hover .jtm-name-text {
                color: #ff6a00; text-decoration: underline;
            }
            /* Invisible link overlay: keeps the row clickable without putting
               text inside an <a>, which some site/extension CSS affects. */
            #${CONFIG.trackedModalId} .jtm-name-link {
                position: absolute; inset: 0; z-index: 1;
                text-indent: -9999px; overflow: hidden; outline: none;
            }
            #${CONFIG.trackedModalId} .jtm-name-link:focus-visible {
                outline: 2px solid #ff6a00; outline-offset: 2px;
            }
            #${CONFIG.trackedModalId} .jtm-tag {
                display: inline-block; font-size: 9px; font-weight: 700; font-family: system-ui, sans-serif;
                color: #fff; background: #9a9a9a; border-radius: 3px;
                padding: 1px 4px; margin-right: 4px; vertical-align: 1px;
                letter-spacing: .3px;
            }
            #${CONFIG.trackedModalId} .jtm-tag.ali { background: #ff4747; }
            #${CONFIG.trackedModalId} .jtm-flag {
                flex: 0 0 auto; display: inline-block;
                font-size: 9px; font-weight: 700; font-family: ui-monospace, Menlo, monospace;
                border-radius: 3px; padding: 1px 4px; margin-right: 5px;
                letter-spacing: .2px; white-space: nowrap;
            }
            #${CONFIG.trackedModalId} .jtm-flag.down {
                color: #0f7434; background: #e7f6ec; border: 1px solid #bfe6cb;
            }
            #${CONFIG.trackedModalId} .jtm-flag.up {
                color: #b00; background: #fdecec; border: 1px solid #efc4c4;
            }
            #${CONFIG.trackedModalId} .jtm-row.changed { background: #fffdf8; }
            #${CONFIG.trackedModalId} .jtm-row.changed.down { background: #f7fcf8; }
            #${CONFIG.trackedModalId} .jtm-row.changed:hover { background: #fff7ec; }
            #${CONFIG.trackedModalId} .jtm-cell {
                font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #444;
                min-width: 66px; text-align: right;
            }
            #${CONFIG.trackedModalId} .jtm-cell.lbl::before {
                content: attr(data-label); display: block; font-size: 9px;
                color: #999; text-transform: uppercase; letter-spacing: .5px;
                font-family: system-ui, sans-serif;
            }
            #${CONFIG.trackedModalId} .jtm-cur { color: #d35400; font-weight: 700; }
            #${CONFIG.trackedModalId} .jtm-low { color: #128a3e; }
            #${CONFIG.trackedModalId} .jtm-high { color: #b00; }
            #${CONFIG.trackedModalId} .jtm-change.up { color: #b00; }
            #${CONFIG.trackedModalId} .jtm-change.down { color: #128a3e; }
            #${CONFIG.trackedModalId} .jtm-del {
                background: none; border: none; cursor: pointer; color: #b00;
                font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
            }
            #${CONFIG.trackedModalId} .jtm-del:hover { background: #fdecec; }
            #${CONFIG.trackedModalId} .jtm-target {
                background: none; border: 1px dashed #ccc; border-radius: 4px;
                cursor: pointer; font-size: 11px; color: #999;
                padding: 2px 6px; white-space: nowrap;
                font-family: ui-monospace, Menlo, monospace;
            }
            #${CONFIG.trackedModalId} .jtm-target:hover { border-color: #ff6a00; color: #d35400; }
            #${CONFIG.trackedModalId} .jtm-target.set { border-style: solid; color: #444; }
            #${CONFIG.trackedModalId} .jtm-target.met {
                border-color: #128a3e; background: #eaf7ef; color: #0f7434; font-weight: 700;
            }
            #${CONFIG.trackedModalId} .jtm-empty { padding: 40px 10px; text-align: center; color: #888; }
            #${CONFIG.trackedModalId} .jtm-toolbar {
                display: flex; gap: 8px; padding: 6px 6px 10px;
                border-bottom: 1px solid #eee; margin-bottom: 4px; align-items: center;
            }
            #${CONFIG.trackedModalId} .jtm-toolbar input {
                flex: 1; padding: 5px 8px; border: 1px solid #ccc;
                border-radius: 4px; font-size: 12px; color: #333; background: #fff;
            }
            #${CONFIG.trackedModalId} .jtm-toolbar select {
                padding: 5px 8px; border: 1px solid #ccc;
                border-radius: 4px; font-size: 12px; background: #fff; color: #333;
            }
            #${CONFIG.trackedModalId} .jtm-import-wrap {
                position: absolute; inset: 0; z-index: 5;
                background: rgba(255,255,255,.98);
                padding: 16px; display: none; flex-direction: column; gap: 8px;
            }
            #${CONFIG.trackedModalId} .jtm-import-wrap.show { display: flex; }
            #${CONFIG.trackedModalId} .jtm-import-title { font-weight: 600; font-size: 13px; color: #333; }
            #${CONFIG.trackedModalId} .jtm-import-ta {
                flex: 1; width: 100%; min-height: 180px; resize: none;
                font-family: ui-monospace, Menlo, monospace; font-size: 11px;
                padding: 8px; border: 1px solid #ccc; border-radius: 6px;
                color: #333; background: #fff;
            }
            #${CONFIG.trackedModalId} .jtm-import-actions { display: flex; gap: 8px; justify-content: flex-end; }
            #${CONFIG.trackedModalId} .jtm-import-actions button {
                padding: 6px 12px; border: 1px solid #ccc; background: #fff;
                border-radius: 4px; cursor: pointer; font-size: 12px; color: #333;
            }
            #${CONFIG.trackedModalId} .jtm-import-actions .jtm-import-ok {
                background: #128a3e; border-color: #128a3e; color: #fff; font-weight: 600;
            }
            #${CONFIG.trackedModalId} .jtm-import-actions .jtm-import-ok:hover { background: #0f7434; }
        `);

        modal.querySelector('.jtm-backdrop').addEventListener('click', () => modal.remove());
        modal.querySelector('.jtm-close').addEventListener('click', () => modal.remove());
        modal.querySelector('.jtm-clear-all').addEventListener('click', () => {
            if (confirm('Delete ALL tracked products and their price history (Jumia + AliExpress)?')) {
                GM_setValue(CONFIG.storageKey, '{}');
                renderTrackedModal(); updateTrackedBadge();
            }
        });
        modal.querySelector('.jtm-export').addEventListener('click', () => {
            const data = JSON.stringify(loadHistory(), null, 2);
            copyToClipboard(data).then(() => alert('Tracking data copied to clipboard as JSON.'));
        });
        const importWrap = modal.querySelector('.jtm-import-wrap');
        const importTa = modal.querySelector('.jtm-import-ta');
        modal.querySelector('.jtm-import').addEventListener('click', () => {
            importTa.value = '';
            importWrap.classList.add('show');
            importTa.focus();
        });
        modal.querySelector('.jtm-import-cancel').addEventListener('click', () => importWrap.classList.remove('show'));
        modal.querySelector('.jtm-import-ok').addEventListener('click', () => {
            let data;
            try { data = JSON.parse(importTa.value); }
            catch { alert('That is not valid JSON. Paste the full export, including the outer { }.'); return; }
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                alert('Expected a JSON object of products, e.g. { "product-key": { … } }.');
                return;
            }
            const r = mergeHistoryData(data);
            importWrap.classList.remove('show');
            renderTrackedModal(true);
            updateTrackedBadge();
            alert(`Merged ${r.products} new product(s) and ${r.samples} price sample(s).`);
        });
        // Broken/blocked thumbnails fall back to the placeholder instead of
        // showing a broken-image icon (capture phase: error doesn't bubble).
        modal.addEventListener('error', e => {
            const img = e.target;
            if (!img || img.tagName !== 'IMG') return;
            const host = img.closest('.jtm-thumb');
            if (!host) return;
            host.textContent = '🛍';
            host.classList.add('jtm-thumb-empty');
        }, true);
        const backfillBtn = modal.querySelector('.jtm-backfill');
        backfillBtn.addEventListener('click', async () => {
            backfillBtn.disabled = true;
            backfillBtn.textContent = 'Fetching…';
            const r = await backfillImages(30);
            backfillBtn.disabled = false;
            backfillBtn.textContent = 'Fetch images';
            renderTrackedModal(true);
            updateTrackedBadge();
            if (r.total === 0) {
                alert('All tracked products already have an image.');
            } else {
                alert(
                    `Fetched ${r.ok} image(s) from ${r.total} page(s). ` +
                    (r.failed ? `${r.failed} could not be fetched (AliExpress usually blocks this). ` : '') +
                    (r.remaining ? `${r.remaining} still missing — click again to continue.` : 'All done.')
                );
            }
        });
        modal.querySelector('.jtm-body').addEventListener('click', e => {
            const target = e.target.closest('.jtm-target');
            if (target) { editTarget(target.dataset.key); return; }
            const del = e.target.closest('.jtm-del');
            if (!del) return;
            const key = del.dataset.key;
            if (!confirm('Stop tracking this product?')) return;
            const h = loadHistory(); delete h[key]; saveHistory(h);
            resetWatchMeta(key);
            renderTrackedModal(true); updateTrackedBadge();
        });

        const watchCb = modal.querySelector('.jtm-watch-cb');
        watchCb.addEventListener('change', () => setSwEnabled(watchCb.checked));
        const watchNow = modal.querySelector('.jtm-watch-now');
        watchNow.addEventListener('click', async () => {
            watchNow.disabled = true;
            watchNow.textContent = 'Checking…';
            try { await smartWatchTick(true); }
            finally {
                watchNow.textContent = 'Check now';
                renderTrackedModal(true);
                updateTrackedBadge();
            }
        });

        renderTrackedModal();
    }

    /** Re-renders the dashboard list in place, if it is open. */
    function refreshDashboardIfOpen() {
        if (!document.getElementById(CONFIG.trackedModalId)) return false;
        renderTrackedModal(true);
        return true;
    }

    function renderTrackedModal(preserve = false) {
        const modal = document.getElementById(CONFIG.trackedModalId);
        if (!modal) return;
        const body = modal.querySelector('.jtm-body');
        const countEl = modal.querySelector('.jtm-count');
        const prevSearch = preserve ? (modal.querySelector('.jtm-search')?.value || '') : '';
        const prevSort = preserve ? (modal.querySelector('.jtm-sort')?.value || 'recent') : 'recent';
        const prevScroll = preserve ? body.scrollTop : 0;
        const history = loadHistory();
        const now = Date.now();

        const rows = Object.entries(history).map(([key, p]) => {
            const ps = p.samples.map(s => s.p);
            const cur = ps.at(-1);
            const first = ps[0];
            const low = Math.min(...ps);
            const high = Math.max(...ps);
            const change = first ? ((cur - first) / first) * 100 : 0;
            const lastT = p.samples.at(-1)?.t || 0;
            const moved = latestChange(p);
            return {
                key, p, cur, low, high, change, lastT, moved,
                recentChange: !!moved && now - moved.t <= CONFIG.watch.changeHighlightMs,
            };
        }).sort((a, b) => b.lastT - a.lastT);

        countEl.textContent = `(${rows.length})`;

        if (!rows.length) {
            body.innerHTML = '<div class="jtm-empty">No products tracked yet.<br>Visit a product page to start tracking.</div>';
            renderWatchStatus();
            return;
        }
        body.innerHTML = `
            <div class="jtm-toolbar">
                <input type="search" class="jtm-search" placeholder="Filter by name…" />
                <select class="jtm-sort">
                    <option value="recent">Recent</option>
                    <option value="changed">Recent changes</option>
                    <option value="change-down">Biggest drop</option>
                    <option value="change-up">Biggest rise</option>
                    <option value="price-low">Lowest price</option>
                    <option value="price-high">Highest price</option>
                    <option value="name">Name</option>
                </select>
            </div>
            <div class="jtm-list"></div>
        `;
        const list = body.querySelector('.jtm-list');
        const search = body.querySelector('.jtm-search');
        const sortSel = body.querySelector('.jtm-sort');
        search.value = prevSearch;
        sortSel.value = prevSort;

        function renderList() {
            let view = rows.slice();
            const q = search.value.trim().toLowerCase();
            if (q) view = view.filter(r => displayName(r.key, r.p).toLowerCase().includes(q));
            const s = sortSel.value;
            if (s === 'changed') view.sort((a, b) => (b.moved?.t || 0) - (a.moved?.t || 0) || b.lastT - a.lastT);
            else if (s === 'change-down') view.sort((a, b) => a.change - b.change);
            else if (s === 'change-up') view.sort((a, b) => b.change - a.change);
            else if (s === 'price-low') view.sort((a, b) => a.cur - b.cur);
            else if (s === 'price-high') view.sort((a, b) => b.cur - a.cur);
            else if (s === 'name') view.sort((a, b) => displayName(a.key, a.p).localeCompare(displayName(b.key, b.p)));
            if (!view.length) { list.innerHTML = '<div class="jtm-empty">No matches.</div>'; return; }
            list.innerHTML = view.map(r => {
                const cls = r.change > 0.05 ? 'up' : r.change < -0.05 ? 'down' : '';
                const sign = r.change >= 0 ? '+' : '';
                const siteId = r.p.site || (r.key.startsWith('ali:') ? 'aliexpress' : 'jumia');
                const isAli = siteId === 'aliexpress';
                const tag = isAli ? 'AliExpress' : 'Jumia';
                const code = r.p.currency || 'GHS';
                const label = displayName(r.key, r.p);
                const image = r.p.image ? escapeHtml(r.p.image) : '';
                const target = typeof r.p.target === 'number' && isFinite(r.p.target) ? r.p.target : null;
                const atTarget = target != null && r.cur != null && r.cur <= target;
                const targetCls = target != null ? (atTarget ? ' set met' : ' set') : '';
                const targetText = target != null ? formatMoney(target, code) : '🎯 set';
                const moved = r.recentChange ? r.moved : null;
                const movedDir = moved && moved.pct < 0 ? 'down' : 'up';
                const movedFlag = moved
                    ? `<span class="jtm-flag ${movedDir}" title="Changed ${timeAgo(moved.t)}: ${
                        formatMoney(moved.from, code)} → ${formatMoney(moved.to, code)}">${
                        movedDir === 'down' ? '↓' : '↑'}${Math.abs(moved.pct).toFixed(1)}%</span>`
                    : '';
                const rowCls = moved ? ` changed ${movedDir}` : '';
                return `
                    <div class="jtm-row${rowCls}">
                        <div class="jtm-name" title="${escapeHtml(label)}">
                            <span class="jtm-thumb${image ? '' : ' jtm-thumb-empty'}">${
                                image
                                    ? `<img src="${image}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                                    : '🛍'
                            }</span>
                            <span class="jtm-name-main">
                                <span class="jtm-tag ${isAli ? 'ali' : ''}">${tag}</span>
                                ${movedFlag}
                                <span class="jtm-name-text">${escapeHtml(truncate(label, 60))}</span>
                            </span>
                            <a class="jtm-name-link" href="${escapeHtml(r.p.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}"></a>
                        </div>
                        <button class="jtm-target${targetCls}" data-key="${escapeHtml(r.key)}" title="Set a target price">${targetText}</button>
                        <div class="jtm-cell lbl jtm-cur" data-label="Current">${formatMoney(r.cur, code)}</div>
                        <div class="jtm-cell lbl jtm-low"  data-label="Low">${formatMoney(r.low, code)}</div>
                        <div class="jtm-cell lbl jtm-high" data-label="High">${formatMoney(r.high, code)}</div>
                        <div class="jtm-cell lbl jtm-change ${cls}" data-label="Change">${sign}${r.change.toFixed(1)}%</div>
                        <button class="jtm-del" data-key="${escapeHtml(r.key)}" title="Delete">×</button>
                    </div>`;
            }).join('');
        }
        search.addEventListener('input', renderList);
        sortSel.addEventListener('change', renderList);
        renderList();
        body.scrollTop = prevScroll;
        renderWatchStatus();
    }

    // ──────────────────────────────────────────────────────────────
    // 8. NOTIFICATIONS
    // ──────────────────────────────────────────────────────────────
    function notify(title, message) {
        if (typeof GM_notification === 'function') {
            GM_notification({ title, text: message, timeout: CONFIG.notificationTimeout });
        } else if (Notification.permission === 'granted') {
            new Notification(title, { body: message });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => {
                if (p === 'granted') new Notification(title, { body: message });
            });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 9. MAIN
    // ──────────────────────────────────────────────────────────────
    const isProductPage = () => IS_ALI
        ? /\/(?:item|i)\/\d+/.test(location.pathname)
        : /\.html($|\?)/.test(location.pathname);

    function notifyDrop(r) {
        if (r.dropPercent == null || r.dropPercent < CONFIG.dropThresholdPercent) return;
        const prev = r.product.samples.at(-2)?.p;
        const code = r.info.currency || r.product.currency || SITE.currency;
        notify(
            `Price Drop on ${r.siteLabel || SITE.label}!`,
            `${displayName('', r.product)}\nNew: ${formatMoney(r.info.price, code)}` +
            (prev ? ` (was ${formatMoney(prev, code)})` : '') +
            `\nDrop: -${r.dropPercent.toFixed(1)}%`
        );
    }

    let lastTrackedKey = null;
    let trackingKey = null;

    function trackCurrentPage() {
        const key = getProductKey();
        if (trackingKey === key) return;
        trackingKey = key;

        let attempts = 0;
        const tryExtract = () => {
            // Bail out if the SPA moved to a different product mid-retry.
            if (getProductKey() !== key) {
                if (trackingKey === key) trackingKey = null;
                return;
            }
            attempts++;
            const r = recordPrice();
            if (r) {
                lastTrackedKey = key;
                trackingKey = null;
                log('Recorded:', r.info, '(source:', r.info.source + ')');
                updatePanel(r); updateTrackedBadge();
                notifyDrop(r);
            } else if (attempts < CONFIG.extractAttempts) {
                setTimeout(tryExtract, CONFIG.extractDelayMs);
            } else {
                trackingKey = null;
                warn(`Could not extract price after ${attempts} attempts.`);
            }
        };
        setTimeout(tryExtract, CONFIG.firstExtractDelayMs);
    }

    // AliExpress is a SPA: the URL can change without a reload.
    function watchSpaNavigation() {
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            log('URL changed →', location.pathname);

            scanCurrentPageForCoupons();
            renderCoupons();

            if (!isProductPage()) return;
            if (getProductKey() === lastTrackedKey) return; // same product, don't duplicate samples
            trackCurrentPage();
        }, 2000);
    }

    async function init() {
        // 0. Purge garbage stored by older versions BEFORE anything else.
        const purged = purgeInvalidCoupons();
        if (purged) {
            log(`Cleaned up ${purged} junk coupons on startup.`);
        }

        createPanel();
        updateTrackedBadge();

        // Scan this page (strictly validated) and merge into the store.
        scanCurrentPageForCoupons();
        renderCoupons();

        // Background web sync (respects 6h TTL).
        refreshCouponsFromWeb().then(result => {
            if (result.added || result.updated)
                log(`Coupons sync: +${result.added} new, ${result.updated} updated`);
            renderCoupons();
        });

        watchSpaNavigation();
        initSmartWatch();

        if (!isProductPage()) {
            log('Not a product page — coupon + dashboard mode.');
            return;
        }
        log('Product page:', SITE.id, getProductKey());

        trackCurrentPage();

        setInterval(() => {
            scanCurrentPageForCoupons();
            refreshCouponsFromWeb().then(() => renderCoupons());
        }, CONFIG.couponCacheTTLMs);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
