// ==UserScript==
// @name         净阅 ClearRead — 多站阅读增强器
// @namespace    https://local.invalid/clearread
// @version      0.3.3
// @description  多站网页阅读增强器；当前支持清理微博广告、荐读和侧栏噪音，并提供专注模式与 J/K 阅读导航。
// @author       Desnowy (sakaman)
// @license      MIT
// @homepageURL  https://github.com/sakaman/ClearRead
// @supportURL   https://github.com/sakaman/ClearRead/issues
// @updateURL    https://raw.githubusercontent.com/sakaman/ClearRead/main/clearread.user.js
// @downloadURL  https://raw.githubusercontent.com/sakaman/ClearRead/main/clearread.user.js
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.3.3';
    const INSTANCE_KEY = '__CLEARREAD_INSTANCE__';
    const STORAGE_KEY = 'clearread.settings.v1';
    const LEGACY_STORAGE_KEYS = Object.freeze(['weibo-reader-enhancer.settings.v1']);
    const ROOT_ID = 'clearread-root';
    const HIDDEN_CLASS = 'wre-hidden';
    const VIRTUAL_HIDDEN_CLASS = 'wre-virtual-hidden';
    const VIRTUAL_ITEM_CLASS = 'wre-virtual-item-hidden';

    if (window[INSTANCE_KEY]) {
        return;
    }

    const DEFAULTS = Object.freeze({
        hideAds: true,
        hideRecommendedFeed: true,
        hideSidebarRecommendations: true,
        hideHotSearch: false,
        hideSidebarFooter: true,
        compactComposer: true,
        widenFeed: true,
        enhanceTypography: true,
        focusMode: false,
        reduceMotion: true,
        disableAutoplay: true,
        keyboardNavigation: true,
        feedWidth: 720,
        fontSize: 16,
        blockedKeywords: [],
        blockedAuthors: [],
    });

    const BOOLEAN_KEYS = Object.freeze([
        'hideAds',
        'hideRecommendedFeed',
        'hideSidebarRecommendations',
        'hideHotSearch',
        'hideSidebarFooter',
        'compactComposer',
        'widenFeed',
        'enhanceTypography',
        'focusMode',
        'reduceMotion',
        'disableAutoplay',
        'keyboardNavigation',
    ]);

    const PANEL_TOGGLES = Object.freeze([
        ['hideAds', '广告与商业推广'],
        ['hideRecommendedFeed', '荐读与推荐微博'],
        ['hideSidebarRecommendations', '侧栏推荐内容'],
        ['hideHotSearch', '微博热搜'],
        ['hideSidebarFooter', '侧栏页脚信息'],
        ['compactComposer', '折叠发微博区域'],
        ['widenFeed', '加宽正文栏'],
        ['enhanceTypography', '增强正文排版'],
        ['focusMode', '专注模式'],
        ['reduceMotion', '减少动画'],
        ['disableAutoplay', '阻止视频自动播放'],
        ['keyboardNavigation', 'J / K 阅读导航'],
    ]);

    const PROMOTED_LABELS = new Set(['广告', '推广', '商业推广', '赞助']);
    const RECOMMENDED_LABELS = new Set(['荐读', '推荐', '热门推荐', '相关推荐', '为你推荐']);
    const SIDEBAR_RECOMMENDATION_TITLES = new Set([
        '你可能感兴趣的人',
        '可能感兴趣的人',
        '猜你喜欢',
        '热门推荐',
        '相关推荐',
        '大家正在看',
        '创作者中心',
        '会员专区',
    ]);
    const HOT_SEARCH_TITLES = new Set(['微博热搜']);
    const SIDEBAR_FOOTER_TITLES = new Set(['帮助中心', '合作&服务', '举报中心', '关于微博']);

    // Only attributes that are explicit ad contracts are treated as strong signals.
    const STRONG_AD_SELECTOR = [
        '[feedtype="ad"]',
        '[data-feedtype="ad"]',
        '[data-adid]',
        '[data-ad-id]',
        '[data-ad-type]',
        '[data-is-ad="true"]',
        '[data-ad="true"]',
        '[data-testid="ad"]',
        '[data-testid^="ad-"]',
        '[data-testid$="-ad"]',
    ].join(',');

    const GLOBAL_CSS = String.raw`
        html.wre-enabled {
            --wre-feed-width: 720px;
            --wre-font-size: 16px;
            --wre-accent: #ff8200;
        }

        html.wre-enabled .${HIDDEN_CLASS} {
            display: none !important;
        }

        /*
         * Weibo observes .wbpro-scroller-item when updating the virtual list.
         * A zero measurement is ignored, so collapse that observed wrapper to
         * one invisible pixel and let the scroller rewrite its cached offsets.
         */
        html.wre-enabled .wbpro-scroller-item.${VIRTUAL_ITEM_CLASS} {
            display: flex !important;
            box-sizing: border-box !important;
            width: 100% !important;
            height: 1px !important;
            min-height: 1px !important;
            max-height: 1px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            overflow: hidden !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }

        html.wre-enabled .wbpro-scroller-item.${VIRTUAL_ITEM_CLASS} > * {
            display: none !important;
        }

        html.wre-enabled article {
            border-radius: 12px !important;
            scroll-margin-top: 88px;
        }

        html.wre-enhance-typography .wbpro-feed-content,
        html.wre-enhance-typography .wbpro-feed-ogText,
        html.wre-enhance-typography .wbpro-feed-reText {
            font-size: var(--wre-font-size) !important;
            line-height: 1.78 !important;
            overflow-wrap: anywhere;
        }

        html.wre-enhance-typography article img {
            image-rendering: auto;
        }

        html.wre-compact-composer .wre-composer {
            max-height: 58px !important;
            overflow: hidden !important;
            opacity: 0.76;
            transition: max-height 180ms ease, opacity 180ms ease;
        }

        html.wre-compact-composer .wre-composer:hover,
        html.wre-compact-composer .wre-composer:focus-within {
            max-height: 520px !important;
            opacity: 1;
        }

        @media (min-width: 1180px) {
            html.wre-widen-feed .wre-main > .wre-primary-column {
                flex: 0 0 var(--wre-feed-width) !important;
                width: var(--wre-feed-width) !important;
                max-width: var(--wre-feed-width) !important;
            }

            html.wre-widen-feed .wre-primary-column .wre-feed-column {
                box-sizing: border-box !important;
                width: 100% !important;
                max-width: 100% !important;
            }
        }

        html.wre-focus-mode #__sidebar {
            display: none !important;
        }

        html.wre-focus-mode .wre-main {
            justify-content: center !important;
        }

        html.wre-focus-mode .wre-main > .wre-primary-column {
            flex: 0 1 var(--wre-feed-width) !important;
            width: min(var(--wre-feed-width), calc(100vw - 32px)) !important;
            max-width: min(var(--wre-feed-width), calc(100vw - 32px)) !important;
        }

        html.wre-focus-mode .wre-composer {
            display: none !important;
        }

        html.wre-reduce-motion *,
        html.wre-reduce-motion *::before,
        html.wre-reduce-motion *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
        }

        html.wre-enabled article.wre-current-article {
            outline: 2px solid color-mix(in srgb, var(--wre-accent) 72%, transparent) !important;
            outline-offset: 2px;
        }

        @media (max-width: 1179px) {
            html.wre-enabled .wre-main > .wre-primary-column {
                max-width: calc(100vw - 24px) !important;
            }
        }
    `;

    let settings = loadSettings();
    let mutationObserver = null;
    let scanFrame = 0;
    let panelUi = null;
    let toastTimer = 0;
    let currentArticle = null;
    const manualVideoUntil = new WeakMap();

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function normalizeList(value) {
        const rawItems = Array.isArray(value) ? value : String(value || '').split(/[\n,，]+/);
        const result = [];
        const seen = new Set();

        for (const rawItem of rawItems) {
            const item = normalizeText(rawItem).slice(0, 80);
            const key = item.toLocaleLowerCase();
            if (!item || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(item);
            if (result.length >= 50) {
                break;
            }
        }

        return result;
    }

    function sanitizeSettings(input) {
        const source = input && typeof input === 'object' ? input : {};
        const next = { ...DEFAULTS };

        for (const key of BOOLEAN_KEYS) {
            if (typeof source[key] === 'boolean') {
                next[key] = source[key];
            }
        }

        const width = Number(source.feedWidth);
        const fontSize = Number(source.fontSize);
        next.feedWidth = Number.isFinite(width) ? clamp(Math.round(width), 620, 860) : DEFAULTS.feedWidth;
        next.fontSize = Number.isFinite(fontSize) ? clamp(Math.round(fontSize), 14, 20) : DEFAULTS.fontSize;
        next.blockedKeywords = normalizeList(source.blockedKeywords);
        next.blockedAuthors = normalizeList(source.blockedAuthors);
        return next;
    }

    function readStoredValue(key) {
        try {
            if (typeof GM_getValue === 'function') {
                return GM_getValue(key, null);
            }
            return localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
    }

    function loadSettings() {
        let stored = readStoredValue(STORAGE_KEY);
        if (stored === null || typeof stored === 'undefined') {
            for (const legacyKey of LEGACY_STORAGE_KEYS) {
                stored = readStoredValue(legacyKey);
                if (stored !== null && typeof stored !== 'undefined') {
                    break;
                }
            }
        }

        if (typeof stored === 'string') {
            try {
                stored = JSON.parse(stored);
            } catch (_error) {
                stored = null;
            }
        }

        return sanitizeSettings(stored);
    }

    function saveSettings() {
        const snapshot = sanitizeSettings(settings);
        settings = snapshot;
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, snapshot);
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            }
        } catch (_error) {
            // Storage failure should not disable page cleanup for the current session.
        }
    }

    function addGlobalStyle(cssText) {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(cssText);
            return;
        }

        const style = document.createElement('style');
        style.textContent = cssText;
        (document.head || document.documentElement).appendChild(style);
    }

    function toggleRootClass(className, enabled) {
        document.documentElement.classList.toggle(className, Boolean(enabled));
    }

    function applyRootState() {
        const root = document.documentElement;
        root.classList.add('wre-enabled');
        root.style.setProperty('--wre-feed-width', `${settings.feedWidth}px`);
        root.style.setProperty('--wre-font-size', `${settings.fontSize}px`);
        toggleRootClass('wre-compact-composer', settings.compactComposer);
        toggleRootClass('wre-widen-feed', settings.widenFeed);
        toggleRootClass('wre-enhance-typography', settings.enhanceTypography);
        toggleRootClass('wre-focus-mode', settings.focusMode);
        toggleRootClass('wre-reduce-motion', settings.reduceMotion);
    }

    function getOwnText(element) {
        let value = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                value += ` ${node.textContent || ''}`;
            }
        }
        return normalizeText(value);
    }

    function markerLooksLikeMetadata(marker, article, label) {
        let current = marker;
        for (let depth = 0; current && current !== article && depth < 5; depth += 1) {
            const className = typeof current.className === 'string' ? current.className : '';
            if (/(?:^|[_\s-])(tag|badge|label|info|meta|head)(?:[_\s-]|$)|wbpro-tag/i.test(className)) {
                return true;
            }
            current = current.parentElement;
        }

        // Hashed classes can change. As a fallback, accept an exact standalone label
        // only when it appears among the first few metadata tokens of the card.
        const leadingTokens = normalizeText(article.textContent).split(' ').slice(0, 3);
        return leadingTokens.includes(label);
    }

    function findExactMarker(article, labels) {
        for (const element of article.querySelectorAll('div, span')) {
            const label = getOwnText(element);
            if (labels.has(label) && markerLooksLikeMetadata(element, article, label)) {
                return label;
            }
        }
        return '';
    }

    function extractAuthor(article) {
        for (const link of article.querySelectorAll('a[href]')) {
            const href = link.getAttribute('href') || '';
            const name = normalizeText(link.textContent);
            if (name && name.length <= 80 && /^(?:https?:\/\/weibo\.com)?\/(?:u\/\d+|n\/)/i.test(href)) {
                return name;
            }
        }
        return '';
    }

    function classifyArticle(article) {
        if (settings.hideAds) {
            if (article.matches(STRONG_AD_SELECTOR) || article.querySelector(STRONG_AD_SELECTOR)) {
                return { category: 'ad', reason: '广告属性' };
            }
            const promotedLabel = findExactMarker(article, PROMOTED_LABELS);
            if (promotedLabel) {
                return { category: 'ad', reason: promotedLabel };
            }
        }

        if (settings.hideRecommendedFeed) {
            const recommendedLabel = findExactMarker(article, RECOMMENDED_LABELS);
            if (recommendedLabel) {
                return { category: 'recommendation', reason: recommendedLabel };
            }
        }

        const content = normalizeText(article.textContent).toLocaleLowerCase();
        for (const keyword of settings.blockedKeywords) {
            if (content.includes(keyword.toLocaleLowerCase())) {
                return { category: 'keyword', reason: `关键词：${keyword}` };
            }
        }

        const author = extractAuthor(article).toLocaleLowerCase();
        for (const blockedAuthor of settings.blockedAuthors) {
            if (author && author.includes(blockedAuthor.toLocaleLowerCase())) {
                return { category: 'author', reason: `用户：${blockedAuthor}` };
            }
        }

        return null;
    }

    function findVirtualScrollerItem(element) {
        const item = element.matches('.wbpro-scroller-item')
            ? element
            : element.closest('.wbpro-scroller-item');
        return item?.closest('.vue-recycle-scroller__item-view') ? item : null;
    }

    function markHidden(element, category, reason, source) {
        if (!(element instanceof Element) || element.id === ROOT_ID || element.closest(`#${ROOT_ID}`)) {
            return;
        }
        const virtualItem = (source === 'article' || source === 'legacy-ad')
            ? findVirtualScrollerItem(element)
            : null;
        element.classList.add(HIDDEN_CLASS);
        element.classList.toggle(VIRTUAL_HIDDEN_CLASS, Boolean(virtualItem));
        virtualItem?.classList.add(VIRTUAL_ITEM_CLASS);
        element.dataset.wreCategory = category;
        element.dataset.wreReason = reason;
        element.dataset.wreSource = source;
    }

    function restoreHidden(element) {
        if (!(element instanceof Element)) {
            return;
        }
        const virtualItem = findVirtualScrollerItem(element);
        element.classList.remove(HIDDEN_CLASS, VIRTUAL_HIDDEN_CLASS, VIRTUAL_ITEM_CLASS);
        virtualItem?.classList.remove(VIRTUAL_ITEM_CLASS);
        delete element.dataset.wreCategory;
        delete element.dataset.wreReason;
        delete element.dataset.wreSource;
    }

    function restoreBySource(source) {
        for (const element of document.querySelectorAll(`[data-wre-source="${source}"]`)) {
            restoreHidden(element);
        }
    }

    function restoreAllHidden() {
        for (const element of document.querySelectorAll('[data-wre-source]')) {
            restoreHidden(element);
        }
    }

    function reconcileVirtualItems() {
        const ownerSelector = `.${HIDDEN_CLASS}.${VIRTUAL_HIDDEN_CLASS}[data-wre-source]`;
        for (const item of document.querySelectorAll(`.${VIRTUAL_ITEM_CLASS}`)) {
            if (!item.matches(ownerSelector) && !item.querySelector(ownerSelector)) {
                item.classList.remove(VIRTUAL_ITEM_CLASS);
            }
        }
    }

    function processArticles() {
        for (const article of document.querySelectorAll('article')) {
            const classification = classifyArticle(article);
            if (classification) {
                markHidden(article, classification.category, classification.reason, 'article');
            } else if (article.dataset.wreSource === 'article') {
                restoreHidden(article);
            }
        }
    }

    function processLegacyAds() {
        restoreBySource('legacy-ad');
        if (!settings.hideAds) {
            return;
        }

        for (const signal of document.querySelectorAll(STRONG_AD_SELECTOR)) {
            const article = signal.closest('article');
            if (article) {
                continue;
            }
            const target = signal.closest('[feedtype], .WB_feed_type, [data-feed-id]') || signal;
            markHidden(target, 'ad', '广告属性', 'legacy-ad');
        }
    }

    function processSponsoredTopics() {
        restoreBySource('sponsored-topic');
        if (!settings.hideAds) {
            return;
        }

        for (const link of document.querySelectorAll('a[href*="topic_ad=1"]')) {
            markHidden(link, 'ad', '商业热搜', 'sponsored-topic');
        }
    }

    function findSidebarPanel(element, sidebar) {
        const panel = element.closest('.wbpro-side, .woo-panel-main, section, aside');
        return panel && sidebar.contains(panel) ? panel : null;
    }

    function processSidebar() {
        restoreBySource('sidebar');
        const sidebar = document.querySelector('#__sidebar');
        if (!sidebar) {
            return;
        }

        const candidates = sidebar.querySelectorAll('div, span, h2, h3, a');
        for (const candidate of candidates) {
            const ownText = getOwnText(candidate);
            const label = ownText || (candidate.children.length === 0 ? normalizeText(candidate.textContent) : '');
            if (!label || label.length > 24) {
                continue;
            }

            let shouldHide = false;
            let reason = '';
            if (settings.hideSidebarRecommendations && SIDEBAR_RECOMMENDATION_TITLES.has(label)) {
                shouldHide = true;
                reason = label;
            } else if (settings.hideHotSearch && HOT_SEARCH_TITLES.has(label)) {
                shouldHide = true;
                reason = label;
            } else if (settings.hideSidebarFooter && SIDEBAR_FOOTER_TITLES.has(label)) {
                shouldHide = true;
                reason = label;
            }

            if (shouldHide) {
                const panel = findSidebarPanel(candidate, sidebar);
                if (panel) {
                    markHidden(panel, 'sidebar', reason, 'sidebar');
                }
            }
        }

        if (settings.hideSidebarFooter) {
            for (const footer of sidebar.querySelectorAll('.wbpro-side-copy')) {
                markHidden(footer, 'sidebar', '侧栏页脚', 'sidebar');
            }
        }
    }

    function processComposer() {
        const input = document.querySelector('textarea[placeholder*="新鲜事"], input[placeholder*="新鲜事"]');
        if (!input) {
            return;
        }
        const card = input.closest('.woo-panel-main') || input.parentElement;
        if (card) {
            card.classList.add('wre-composer');
        }
    }

    function processLayout() {
        const scroller = document.querySelector('#scroller');
        const main = scroller ? scroller.closest('main') : document.querySelector('main');
        if (!scroller || !main) {
            return;
        }

        main.classList.add('wre-main');
        let current = scroller;
        while (current && current !== main) {
            current.classList.add('wre-feed-column');
            if (current.parentElement === main) {
                current.classList.add('wre-primary-column');
                break;
            }
            current = current.parentElement;
        }
    }

    function prepareVideo(video) {
        if (video.dataset.wreVideoPrepared === '1') {
            return;
        }
        video.dataset.wreVideoPrepared = '1';
        video.dataset.wreOriginalAutoplay = video.hasAttribute('autoplay') ? '1' : '0';
        video.removeAttribute('autoplay');
        video.autoplay = false;
        video.preload = 'metadata';
        if (!video.paused) {
            video.pause();
        }
    }

    function restoreVideo(video) {
        if (video.dataset.wreVideoPrepared !== '1') {
            return;
        }
        if (video.dataset.wreOriginalAutoplay === '1') {
            video.setAttribute('autoplay', '');
            video.autoplay = true;
        }
        delete video.dataset.wreVideoPrepared;
        delete video.dataset.wreOriginalAutoplay;
    }

    function processVideos() {
        for (const video of document.querySelectorAll('video')) {
            if (settings.disableAutoplay) {
                prepareVideo(video);
            } else {
                restoreVideo(video);
            }
        }
    }

    function getStats() {
        const result = { ad: 0, recommendation: 0, keyword: 0, author: 0, sidebar: 0, total: 0 };
        for (const element of document.querySelectorAll('[data-wre-category]')) {
            const category = element.dataset.wreCategory;
            if (Object.prototype.hasOwnProperty.call(result, category)) {
                result[category] += 1;
            }
            result.total += 1;
        }
        return result;
    }

    function scanNow() {
        scanFrame = 0;
        processLayout();
        processComposer();
        processArticles();
        processLegacyAds();
        processSponsoredTopics();
        processSidebar();
        processVideos();
        reconcileVirtualItems();
        updatePanel();
    }

    function queueScan() {
        if (scanFrame) {
            return;
        }
        scanFrame = requestAnimationFrame(scanNow);
    }

    function applySettings({ persist = true, message = '' } = {}) {
        settings = sanitizeSettings(settings);
        if (persist) {
            saveSettings();
        }
        applyRootState();
        restoreAllHidden();
        queueScan();
        updatePanel();
        if (message) {
            showToast(message);
        }
    }

    function setBooleanSetting(key, value) {
        if (!BOOLEAN_KEYS.includes(key)) {
            return;
        }
        settings[key] = Boolean(value);
        applySettings({ message: '设置已保存' });
    }

    function editListSetting(key, title) {
        const current = settings[key].join('\n');
        const value = window.prompt(`${title}\n每行一个，也可用逗号分隔；留空表示清除。`, current);
        if (value === null) {
            return;
        }
        settings[key] = normalizeList(value);
        applySettings({ message: `${title}已更新` });
    }

    function resetSettings() {
        if (!window.confirm('恢复 ClearRead 默认设置？已保存的屏蔽词和用户也会被清空。')) {
            return;
        }
        settings = sanitizeSettings(DEFAULTS);
        applySettings({ message: '已恢复默认设置' });
    }

    function panelToggleMarkup() {
        return PANEL_TOGGLES.map(([key, label]) => `
            <label class="toggle-row">
                <span>${label}</span>
                <input type="checkbox" data-setting="${key}">
            </label>
        `).join('');
    }

    function mountPanel() {
        if (panelUi || !document.body) {
            return;
        }

        const host = document.createElement('div');
        host.id = ROOT_ID;
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; color-scheme: light dark; }
                * { box-sizing: border-box; }
                button, input { font: inherit; }
                .launcher {
                    min-width: 54px; height: 42px; padding: 0 14px; border: 0; border-radius: 999px;
                    color: #fff; background: linear-gradient(135deg, #ff9a2f, #ff6a00); cursor: pointer;
                    box-shadow: 0 9px 28px rgba(255, 106, 0, .28); font: 600 14px/1 system-ui, sans-serif;
                }
                .launcher:hover { transform: translateY(-1px); }
                .panel {
                    position: absolute; right: 0; bottom: 52px; width: min(330px, calc(100vw - 24px)); max-height: min(680px, calc(100vh - 92px));
                    overflow: auto; border: 1px solid rgba(127,127,127,.22); border-radius: 16px;
                    background: color-mix(in srgb, Canvas 95%, transparent); color: CanvasText;
                    box-shadow: 0 18px 54px rgba(0,0,0,.22); backdrop-filter: blur(18px);
                    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
                }
                .panel[hidden] { display: none; }
                header { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; padding: 15px 16px 11px; background: Canvas; z-index: 1; }
                h2 { margin: 0; font-size: 17px; }
                .close { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 20px; line-height: 1; }
                .summary { margin: 0 16px 12px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, #ff8200 10%, Canvas); color: color-mix(in srgb, CanvasText 78%, transparent); }
                .toggles { padding: 0 10px; }
                .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 6px; cursor: pointer; }
                .toggle-row input { width: 34px; height: 20px; accent-color: #ff8200; cursor: pointer; }
                .range-row { padding: 10px 16px 4px; }
                .range-head { display: flex; justify-content: space-between; margin-bottom: 5px; }
                input[type="range"] { width: 100%; accent-color: #ff8200; }
                .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 14px 16px 10px; }
                .actions button { border: 1px solid rgba(127,127,127,.28); border-radius: 9px; padding: 8px; background: color-mix(in srgb, Canvas 90%, CanvasText 6%); color: inherit; cursor: pointer; }
                .actions button:hover { border-color: #ff8200; }
                .reset { grid-column: 1 / -1; }
                footer { padding: 4px 16px 14px; color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 12px; }
                .toast { position: absolute; right: 0; bottom: 54px; padding: 8px 12px; border-radius: 9px; background: #222; color: #fff; opacity: 0; transform: translateY(5px); transition: .16s ease; pointer-events: none; white-space: nowrap; font: 13px/1.3 system-ui, sans-serif; }
                .toast.visible { opacity: .94; transform: translateY(0); }
                @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
            </style>
            <button class="launcher" type="button" aria-haspopup="dialog" aria-expanded="false" title="打开 ClearRead 设置">净阅</button>
            <section class="panel" role="dialog" aria-label="ClearRead 设置" hidden>
                <header><h2>净阅 ClearRead <small>v${VERSION}</small></h2><button class="close" type="button" aria-label="关闭">×</button></header>
                <p class="summary" aria-live="polite">正在检查页面…</p>
                <div class="toggles">${panelToggleMarkup()}</div>
                <div class="range-row">
                    <div class="range-head"><span>正文栏宽度</span><output data-output="feedWidth"></output></div>
                    <input type="range" min="620" max="860" step="10" data-setting="feedWidth">
                </div>
                <div class="range-row">
                    <div class="range-head"><span>正文字号</span><output data-output="fontSize"></output></div>
                    <input type="range" min="14" max="20" step="1" data-setting="fontSize">
                </div>
                <div class="actions">
                    <button type="button" data-action="keywords">屏蔽词（<span data-count="keywords">0</span>）</button>
                    <button type="button" data-action="authors">屏蔽用户（<span data-count="authors">0</span>）</button>
                    <button class="reset" type="button" data-action="reset">恢复默认设置</button>
                </div>
                <footer>快捷键：J / K 切换微博，Alt + R 切换专注模式。所有设置仅保存在本机。</footer>
            </section>
            <div class="toast" role="status"></div>
        `;

        document.body.appendChild(host);

        const launcher = shadow.querySelector('.launcher');
        const panel = shadow.querySelector('.panel');
        const close = shadow.querySelector('.close');

        launcher.addEventListener('click', () => togglePanel());
        close.addEventListener('click', () => togglePanel(false));

        shadow.addEventListener('change', (event) => {
            const input = event.target.closest('[data-setting]');
            if (!input) {
                return;
            }
            const key = input.dataset.setting;
            if (BOOLEAN_KEYS.includes(key)) {
                setBooleanSetting(key, input.checked);
            } else if (key === 'feedWidth' || key === 'fontSize') {
                settings[key] = Number(input.value);
                applySettings({ message: '排版设置已保存' });
            }
        });

        shadow.addEventListener('input', (event) => {
            const input = event.target.closest('input[type="range"][data-setting]');
            if (!input) {
                return;
            }
            settings[input.dataset.setting] = Number(input.value);
            applyRootState();
            updatePanel();
        });

        shadow.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) {
                return;
            }
            if (button.dataset.action === 'keywords') {
                editListSetting('blockedKeywords', '屏蔽词');
            } else if (button.dataset.action === 'authors') {
                editListSetting('blockedAuthors', '屏蔽用户');
            } else if (button.dataset.action === 'reset') {
                resetSettings();
            }
        });

        panelUi = { host, shadow, launcher, panel };
        updatePanel();
    }

    function togglePanel(force) {
        mountPanel();
        if (!panelUi) {
            return;
        }
        const open = typeof force === 'boolean' ? force : panelUi.panel.hidden;
        panelUi.panel.hidden = !open;
        panelUi.launcher.setAttribute('aria-expanded', String(open));
        if (open) {
            updatePanel();
        }
    }

    function updatePanel() {
        if (!panelUi) {
            return;
        }

        for (const [key] of PANEL_TOGGLES) {
            const input = panelUi.shadow.querySelector(`[data-setting="${key}"]`);
            if (input) {
                input.checked = Boolean(settings[key]);
            }
        }

        for (const key of ['feedWidth', 'fontSize']) {
            const input = panelUi.shadow.querySelector(`input[data-setting="${key}"]`);
            const output = panelUi.shadow.querySelector(`[data-output="${key}"]`);
            if (input) {
                input.value = String(settings[key]);
            }
            if (output) {
                output.textContent = `${settings[key]}px`;
            }
        }

        const keywordCount = panelUi.shadow.querySelector('[data-count="keywords"]');
        const authorCount = panelUi.shadow.querySelector('[data-count="authors"]');
        if (keywordCount) {
            keywordCount.textContent = String(settings.blockedKeywords.length);
        }
        if (authorCount) {
            authorCount.textContent = String(settings.blockedAuthors.length);
        }

        const stats = getStats();
        const summary = panelUi.shadow.querySelector('.summary');
        summary.textContent = `已隐藏 ${stats.total} 项 · 广告 ${stats.ad} · 荐读 ${stats.recommendation} · 规则 ${stats.keyword + stats.author} · 侧栏 ${stats.sidebar}`;
        panelUi.launcher.textContent = stats.total ? `净阅 · ${stats.total}` : '净阅';
    }

    function showToast(message) {
        if (!message) {
            return;
        }
        mountPanel();
        if (!panelUi) {
            return;
        }
        const toast = panelUi.shadow.querySelector('.toast');
        toast.textContent = message;
        toast.classList.add('visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1600);
    }

    function isTypingTarget(target) {
        return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function navigateArticles(direction) {
        const articles = Array.from(document.querySelectorAll(`main article:not(.${HIDDEN_CLASS})`)).filter((article) => {
            const rect = article.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        if (!articles.length) {
            return;
        }

        let index = currentArticle ? articles.indexOf(currentArticle) : -1;
        if (index < 0) {
            let bestDistance = Number.POSITIVE_INFINITY;
            for (let candidateIndex = 0; candidateIndex < articles.length; candidateIndex += 1) {
                const distance = Math.abs(articles[candidateIndex].getBoundingClientRect().top - 96);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    index = candidateIndex;
                }
            }
        }

        const targetIndex = clamp(index + direction, 0, articles.length - 1);
        const target = articles[targetIndex];
        if (currentArticle && currentArticle !== target) {
            currentArticle.classList.remove('wre-current-article');
        }
        currentArticle = target;
        currentArticle.classList.add('wre-current-article');
        currentArticle.scrollIntoView({
            block: 'start',
            behavior: settings.reduceMotion ? 'auto' : 'smooth',
        });
    }

    function handleKeyboard(event) {
        if (event.defaultPrevented || isTypingTarget(event.target)) {
            return;
        }

        const key = event.key.toLocaleLowerCase();
        if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'r') {
            event.preventDefault();
            settings.focusMode = !settings.focusMode;
            applySettings({ message: settings.focusMode ? '已开启专注模式' : '已关闭专注模式' });
            return;
        }

        if (!settings.keyboardNavigation || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }
        if (key === 'j' || key === 'k') {
            event.preventDefault();
            navigateArticles(key === 'j' ? 1 : -1);
        }
    }

    function rememberManualVideoIntent(target) {
        if (!(target instanceof Element)) {
            return;
        }
        const container = target.closest('article') || target.closest('video');
        if (!container) {
            return;
        }
        for (const video of container.matches('video') ? [container] : container.querySelectorAll('video')) {
            manualVideoUntil.set(video, Date.now() + 2500);
        }
    }

    function handleVideoPlay(event) {
        const video = event.target;
        if (!settings.disableAutoplay || !(video instanceof HTMLVideoElement)) {
            return;
        }
        if ((manualVideoUntil.get(video) || 0) >= Date.now()) {
            return;
        }
        queueMicrotask(() => {
            if (!video.paused) {
                video.pause();
            }
        });
    }

    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') {
            return;
        }
        GM_registerMenuCommand('打开 ClearRead 设置', () => togglePanel(true));
        GM_registerMenuCommand('切换专注模式（Alt + R）', () => {
            settings.focusMode = !settings.focusMode;
            applySettings({ message: settings.focusMode ? '已开启专注模式' : '已关闭专注模式' });
        });
        GM_registerMenuCommand('编辑屏蔽词', () => editListSetting('blockedKeywords', '屏蔽词'));
        GM_registerMenuCommand('编辑屏蔽用户', () => editListSetting('blockedAuthors', '屏蔽用户'));
        GM_registerMenuCommand('重新检查当前页面', () => {
            scanNow();
            showToast('页面检查完成');
        });
    }

    function exposeApi() {
        const api = Object.freeze({
            version: VERSION,
            getSettings: () => JSON.parse(JSON.stringify(settings)),
            getStats: () => ({ ...getStats() }),
            rescan: () => scanNow(),
            setSettings: (patch) => {
                settings = sanitizeSettings({ ...settings, ...(patch || {}) });
                applySettings();
                return JSON.parse(JSON.stringify(settings));
            },
        });
        Object.defineProperty(window, INSTANCE_KEY, {
            value: api,
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }

    function initialize() {
        addGlobalStyle(GLOBAL_CSS);
        applyRootState();
        exposeApi();
        registerMenus();

        document.addEventListener('keydown', handleKeyboard, true);
        document.addEventListener('pointerdown', (event) => rememberManualVideoIntent(event.target), true);
        document.addEventListener('play', handleVideoPlay, true);
        window.addEventListener('popstate', queueScan);
        window.addEventListener('hashchange', queueScan);

        mutationObserver = new MutationObserver(queueScan);
        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['feedtype', 'data-feedtype', 'data-adid', 'data-ad-id', 'data-ad-type', 'data-is-ad', 'data-ad'],
        });

        if (document.body) {
            mountPanel();
        } else {
            document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
        }
        queueScan();
    }

    initialize();
})();
