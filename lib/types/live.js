/**
 * Live Browser panel (v1.9.0) — the Typert remote behind the right-Sidebar tab.
 *
 * The official cross-half RPC channel (dsh-api-gateway + dsh-typert-registry +
 * dsh-typert-protocol): the host half registers strict descriptors (face 'host' +
 * invocations, src-json codec) on ctx.typert and serves them from a Service bound
 * with bindTypertRemote; the Web client half (client/index.js) mounts the same-shaped
 * descriptors and calls ctx.remote['browser-live'].<method>().
 *
 * Every endpoint is the user's own action in the panel, so it goes through the same
 * BridgeController.execute gate as the model's tools (read-only / no-script policy
 * included) and lands in the same audit trail. Business failures throw; the gateway
 * turns them into { ok:false, error } for the panel. Results are compacted (no
 * undefined-valued own property) because the gateway's boundary check rejects those.
 * @module @angelky7/dsh-browser-control/src/live
 */
import { Service } from '@deepseek-ai/cordis';
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
/** npm package name (descriptor id prefix). */
export const LIVE_PACKAGE = '@angelky7/dsh-browser-control';
/** Cordis service key. */
export const LIVE_SERVICE = 'browser-live';
/** Wire namespace (client side ctx.remote['browser-live']). */
export const LIVE_NAMESPACE = 'browser-live';
const SRC_JSON = { mode: 'src-json' };
/** One host-half invocation descriptor (direct call, json parameters, src-json result). */
function hostInvocation(method, parameters) {
    return {
        id: `${LIVE_PACKAGE}#${LIVE_NAMESPACE}/${method}`,
        service: LIVE_SERVICE,
        namespace: LIVE_NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters: parameters.map((name) => ({ name, wire: name, source: 'json', codec: SRC_JSON })),
        result: SRC_JSON,
    };
}
/** The typert registry stores the model verbatim; this plugin has no generated reflection. */
const EMPTY_MODEL = { services: [], events: [], objects: [] };
/** host half contribution (ctx.typert.register). Parameter names are the wire names. */
export const LIVE_TYPERT_CONTRIBUTION = {
    package: LIVE_PACKAGE,
    face: 'host',
    schemas: [],
    invocations: [
        hostInvocation('status', []),
        hostInvocation('listTabs', []),
        hostInvocation('navigate', ['url', 'tabId']),
        hostInvocation('openTab', ['url']),
        hostInvocation('activateTab', ['tabId']),
        hostInvocation('history', ['tabId', 'direction']),
        hostInvocation('reload', ['tabId']),
        hostInvocation('screenshot', ['tabId']),
        hostInvocation('viewport', ['tabId']),
        hostInvocation('click', ['tabId', 'x', 'y']),
        hostInvocation('scroll', ['tabId', 'x', 'y']),
        hostInvocation('press', ['tabId', 'key']),
        hostInvocation('typeText', ['tabId', 'text']),
    ],
    model: EMPTY_MODEL,
};
/** Navigation budget for panel-driven navigations; the bridge gets a margin like the tools do. */
const NAV_BUDGET_MS = 15_000;
const BRIDGE_MARGIN_MS = 2_000;
/** Hard ceiling for one panel call so a hung bridge never leaves the tab spinning. */
const CALL_DEADLINE_MS = 45_000;
/** Panel screenshots are a live view, not evidence: JPEG at a modest quality keeps frames small. */
const SHOT_QUALITY = 60;
/** Drop `undefined`-valued own properties at every depth (gateway boundary check rejects them). */
function compact(value) {
    if (Array.isArray(value))
        return value.map((item) => compact(item));
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined)
                continue;
            out[key] = compact(item);
        }
        return out;
    }
    return value;
}
/** `null` (client) and `undefined` (omitted) both mean "the browser's active tab". */
function normalizeTabId(tabId) {
    if (tabId === null || tabId === undefined)
        return undefined;
    if (!Number.isInteger(tabId))
        throw new Error(`tabId must be an integer, got ${JSON.stringify(tabId)}`);
    return tabId;
}
/**
 * The panel's remote service: one method per endpoint, positional parameters in the
 * descriptor's order. Endpoints return the bare business value (the gateway wraps it
 * in { ok, value }); failures throw. bindTypertRemote is required by the gateway's
 * validateBinding.
 */
export class LiveViewService extends Service {
    bridge;
    /** Binding declaration — the gateway's validateBinding checks this reflection name. */
    typertRemote;
    constructor(ctx, bridge) {
        super(ctx, LIVE_SERVICE);
        this.bridge = bridge;
        this.typertRemote = bindTypertRemote(this, LIVE_SERVICE);
    }
    async run(command, params, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`${command} did not answer within ${CALL_DEADLINE_MS} ms`)), CALL_DEADLINE_MS);
        try {
            return await this.bridge.execute(command, params, controller.signal, timeoutMs);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async cdp(method, params, tabId) {
        return await this.run('cdp', { method, params, ...(tabId === undefined ? {} : { tabId }) });
    }
    // ------------------------------------------------------------ endpoints
    /** Bridge link state plus the read-only flag (the panel disables its controls). */
    status() {
        return compact(this.bridge.liveStatus());
    }
    /** Every tab of the connected browser, plus the one that is active right now. */
    async listTabs() {
        const raw = await this.run('tabs.list', {});
        return {
            ...(raw.activeTabId === undefined ? {} : { activeTabId: raw.activeTabId }),
            tabs: (raw.tabs ?? []).map((t) => ({ id: t.id, url: t.url ?? '', title: t.title ?? '', active: t.active === true })),
        };
    }
    /** Navigate a tab (default: the active one) and wait for the DOM to settle. */
    async navigate(url, tabId) {
        const id = normalizeTabId(tabId);
        const raw = await this.run('nav', { url, waitUntil: 'domcontentloaded', timeoutMs: NAV_BUDGET_MS, ...(id === undefined ? {} : { tabId: id }) }, NAV_BUDGET_MS + BRIDGE_MARGIN_MS);
        return compact({
            tabId: raw.tabId ?? id,
            url: raw.url,
            title: raw.title,
            unreachable: raw.siteUnreachable === true || (typeof raw.siteUnreachable === 'object' && raw.siteUnreachable !== null),
        });
    }
    /** Open a new tab in the foreground and return it (the panel then pins its view to it). */
    async openTab(url) {
        const raw = await this.run('tabs.open', { url, waitUntil: 'domcontentloaded', timeoutMs: NAV_BUDGET_MS, active: true }, NAV_BUDGET_MS + BRIDGE_MARGIN_MS);
        return compact({ tabId: raw.tabId, url: raw.url, title: raw.title });
    }
    /** Bring a tab to the front (input events need the tab active to be fast). */
    async activateTab(tabId) {
        const id = normalizeTabId(tabId);
        if (id === undefined)
            throw new Error('activateTab requires tabId');
        await this.run('tabs.activate', { tabId: id });
        return { tabId: id };
    }
    /** Reload a tab through the page's own reload (the toolbar's Reload page button). */
    async reload(tabId) {
        const id = normalizeTabId(tabId);
        await this.cdp('Page.reload', {}, id);
        return compact({ tabId: id });
    }
    /** History navigation for one tab. */
    async history(tabId, direction) {
        const id = normalizeTabId(tabId);
        if (id === undefined)
            throw new Error('history requires tabId');
        if (direction !== 'back' && direction !== 'forward')
            throw new Error(`direction must be back or forward, got ${JSON.stringify(direction)}`);
        this.bridge.requireExtensionCommand(`tabs.${direction}`, '1.7.0');
        await this.run(`tabs.${direction}`, { tabId: id, waitUntil: 'domcontentloaded', timeoutMs: NAV_BUDGET_MS }, NAV_BUDGET_MS + BRIDGE_MARGIN_MS);
        return { tabId: id, direction };
    }
    /** One JPEG frame of the tab's viewport as a data URL, with the tab's title and URL. */
    async screenshot(tabId) {
        const id = normalizeTabId(tabId);
        const shot = await this.run('screenshot', { format: 'jpeg', quality: SHOT_QUALITY, ...(id === undefined ? {} : { tabId: id }) });
        return compact({
            tabId: shot.tabId,
            dataUrl: `data:image/${shot.format === 'png' ? 'png' : 'jpeg'};base64,${shot.base64}`,
            title: shot.tabTitle,
            url: shot.tabUrl,
        });
    }
    /** The tab's viewport in CSS pixels — the coordinate system of click/scroll. */
    async viewport(tabId) {
        const id = normalizeTabId(tabId);
        const metrics = await this.cdp('Page.getLayoutMetrics', {}, id);
        return { width: metrics.cssVisualViewport?.clientWidth ?? 0, height: metrics.cssVisualViewport?.clientHeight ?? 0 };
    }
    /** Click at a viewport point in CSS pixels: the same three trusted mouse events the click command sends. */
    async click(tabId, x, y) {
        const id = normalizeTabId(tabId);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error('click needs finite x and y (CSS pixels from the viewport origin)');
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, id);
        await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, id);
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, id);
        return compact({ tabId: id, x, y });
    }
    /** Scroll the viewport by a delta in CSS pixels (positive y scrolls down). */
    async scroll(tabId, x, y) {
        const id = normalizeTabId(tabId);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error('scroll needs finite x and y deltas');
        await this.run('scroll', { x, y, ...(id === undefined ? {} : { tabId: id }) });
        return compact({ tabId: id, x, y });
    }
    /** One named key or combination ("Enter", "Escape", "Ctrl+A"), exactly as browser_press spells them. */
    async press(tabId, key) {
        const id = normalizeTabId(tabId);
        if (typeof key !== 'string' || key.trim() === '')
            throw new Error('press needs a key');
        await this.run('press', { key, ...(id === undefined ? {} : { tabId: id }) });
        return compact({ tabId: id, key });
    }
    /** Insert text into the focused element (no key events; use press for those). */
    async typeText(tabId, text) {
        const id = normalizeTabId(tabId);
        if (typeof text !== 'string' || text === '')
            throw new Error('typeText needs non-empty text');
        await this.cdp('Input.insertText', { text }, id);
        return compact({ tabId: id, chars: text.length });
    }
}
