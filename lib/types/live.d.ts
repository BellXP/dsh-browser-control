/**
 * Live Browser panel (v1.9.0) — the Typert remote behind the right-Sidebar tab.
 *
 * The official cross-half RPC channel (dsh-api-gateway + dsh-typert-registry +
 * dsh-typert-protocol): the host half registers strict descriptors (face 'host' +
 * invocations, src-json codec) on ctx.typert and serves them from a Service bound
 * with bindTypertRemote; the Web client half (client/index.js) mounts the same-shaped
 * descriptors and calls ctx.remote['browser-live'].<method>().
 *
 * Every endpoint is the user's own action in the panel: it goes through the same
 * BridgeController.execute path as the model's tools and lands in the same audit trail
 * (marked `[panel]`), but passes `origin: 'panel'` so the read-only / no-script policy —
 * which binds the model — does not apply: read-only means "the agent must not touch my
 * browser", not "I must not". The extension popup's lock still stops the panel too,
 * because the extension cannot tell who sent a command. Business failures throw; the
 * gateway turns them into { ok:false, error } for the panel. Results are compacted (no
 * undefined-valued own property) because the gateway's boundary check rejects those.
 * @module @angelky7/dsh-browser-control/src/live
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
/** npm package name (descriptor id prefix). */
export declare const LIVE_PACKAGE = "@angelky7/dsh-browser-control";
/** Cordis service key. */
export declare const LIVE_SERVICE = "browser-live";
/** Wire namespace (client side ctx.remote['browser-live']). */
export declare const LIVE_NAMESPACE = "browser-live";
/** host half contribution (ctx.typert.register). Parameter names are the wire names. */
export declare const LIVE_TYPERT_CONTRIBUTION: TypertContribution;
/** Link snapshot for the panel: the bridge's status page reduced to what the tab shows. */
export interface LiveBridgeStatus {
    listening: boolean;
    extensionConnected: boolean;
    extensionVersion: string | undefined;
    browser: string | undefined;
    lastError: string | undefined;
    pendingCommands: number;
    /** The profile's read-only gate (`readOnly`): binds the agent's tools, never the panel. */
    readOnly: boolean;
}
/** What the panel needs from the bridge controller (structural, so the class stays module-private). */
export interface LiveBridge {
    execute(command: string, params: Record<string, unknown>, signal: AbortSignal, timeoutMs?: number, options?: {
        origin?: 'tool' | 'panel';
    }): Promise<unknown>;
    requireExtensionCommand(command: string, since: string): void;
    liveStatus(): LiveBridgeStatus;
}
/**
 * The panel's remote service: one method per endpoint, positional parameters in the
 * descriptor's order. Endpoints return the bare business value (the gateway wraps it
 * in { ok, value }); failures throw. bindTypertRemote is required by the gateway's
 * validateBinding.
 */
export declare class LiveViewService extends Service {
    private readonly bridge;
    /** Binding declaration — the gateway's validateBinding checks this reflection name. */
    readonly typertRemote: unknown;
    constructor(ctx: Context, bridge: LiveBridge);
    private run;
    private cdp;
    /**
     * Bridge link state plus both read-only flags: `readOnly` is the profile's gate on
     * the agent's tools, `extensionReadOnly` the popup's switch (extension v1.7.6+,
     * reported by browser.info; false when the extension is offline or older). Neither
     * applies to the panel — the panel says so instead of disabling its controls.
     */
    status(): Promise<LiveBridgeStatus & {
        extensionReadOnly: boolean;
    }>;
    /** Every tab of the connected browser, plus the one that is active right now. */
    listTabs(): Promise<{
        activeTabId?: number;
        tabs: Array<{
            id: number;
            url: string;
            title: string;
            active: boolean;
        }>;
    }>;
    /** Navigate a tab (default: the active one) and wait for the DOM to settle. */
    navigate(url: string, tabId?: number | null): Promise<{
        tabId: number | undefined;
        url?: string;
        title?: string;
        unreachable: boolean;
    }>;
    /** Open a new tab in the foreground and return it (the panel then pins its view to it). */
    openTab(url: string): Promise<{
        tabId: number;
        url?: string;
        title?: string;
    }>;
    /** Bring a tab to the front (input events need the tab active to be fast). */
    activateTab(tabId: number | null | undefined): Promise<{
        tabId: number;
    }>;
    /** Reload a tab through the page's own reload (the toolbar's Reload page button). */
    reload(tabId: number | null | undefined): Promise<{
        tabId: number | undefined;
    }>;
    /** History navigation for one tab. */
    history(tabId: number | null | undefined, direction: string): Promise<{
        tabId: number;
        direction: string;
    }>;
    /** One JPEG frame of the tab's viewport as a data URL, with the tab's title and URL. */
    screenshot(tabId?: number | null): Promise<{
        tabId: number;
        dataUrl: string;
        title?: string;
        url?: string;
    }>;
    /** The tab's viewport in CSS pixels — the coordinate system of click/scroll. */
    viewport(tabId?: number | null): Promise<{
        width: number;
        height: number;
    }>;
    /** Click at a viewport point in CSS pixels: the same three trusted mouse events the click command sends. */
    click(tabId: number | null | undefined, x: number, y: number): Promise<{
        tabId: number | undefined;
        x: number;
        y: number;
    }>;
    /** Scroll the viewport by a delta in CSS pixels (positive y scrolls down). */
    scroll(tabId: number | null | undefined, x: number, y: number): Promise<{
        tabId: number | undefined;
        x: number;
        y: number;
    }>;
    /** One named key or combination ("Enter", "Escape", "Ctrl+A"), exactly as browser_press spells them. */
    press(tabId: number | null | undefined, key: string): Promise<{
        tabId: number | undefined;
        key: string;
    }>;
    /** Insert text into the focused element (no key events; use press for those). */
    typeText(tabId: number | null | undefined, text: string): Promise<{
        tabId: number | undefined;
        chars: number;
    }>;
}
