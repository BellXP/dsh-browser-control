// Live Browser panel（v1.9.0）离线冒烟：不起浏览器、不占端口。
//  1) client 半的 typert 描述符与 host 半贡献逐方法、逐参数对齐（名字与顺序）；
//  2) LiveViewService 用假桥跑一遍每个端点：参数形状（tabId 缺省 / cdp 三连鼠标事件）、
//     结果里没有 undefined 自有属性（网关边界校验会拒）、非法输入抛错；
//  3) 地址栏归一化：URL 原样、裸域名补 https、其余进搜索。
// 用法: node verify/verify_live_panel.mjs
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Context } from "@deepseek-ai/cordis";
import { LIVE_TYPERT_CONTRIBUTION, LiveViewService } from "../lib/types/live.js";

let failed = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

// ---- 1) client / host descriptors
let clientModule;
const fakeReact = { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn) => fn, useSyncExternalStore: (_s, get) => get() };
vm.runInNewContext(
  await readFile(new URL("../client/index.js", import.meta.url), "utf8"),
  {
    window: { __ModuleLoader__: { load: (mod) => { clientModule = mod; } } },
    setTimeout, clearTimeout, console, Promise, Date,
  },
  { filename: "client/index.js" },
);
check(clientModule?.id === LIVE_TYPERT_CONTRIBUTION.package, `client module id === host package (${clientModule?.id})`);
const plugin = clientModule.factory((name) => { if (name === "react") return fakeReact; throw new Error("unexpected require: " + name); });
const clientRemote = plugin.__test.CLIENT_TYPERT_REMOTE;
const hostMethods = LIVE_TYPERT_CONTRIBUTION.invocations.map((i) => `${i.method}(${i.parameters.map((p) => p.name).join(",")})`).sort();
const clientMethods = clientRemote.descriptors.map((d) => `${d.method}(${d.parameters.map((p) => p.name).join(",")})`).sort();
check(hostMethods.length === 13, `host exposes 13 invocations (${hostMethods.length})`);
check(JSON.stringify(hostMethods) === JSON.stringify(clientMethods), "client descriptors match host invocations (method + parameter order)");
check(JSON.stringify(hostMethods) !== "[]", `methods: ${hostMethods.join(" ")}`);
check(LIVE_TYPERT_CONTRIBUTION.package === "@angelky7/dsh-browser-control" && LIVE_TYPERT_CONTRIBUTION.face === "host", "contribution package / face");
check(plugin.inject.includes("remote") && plugin.inject.includes("sidebarRightTabs") && plugin.inject.includes("slots"), `client inject: ${plugin.inject.join(",")}`);

// ---- 2) the service against a fake bridge
const calls = [];
const fakeBridge = {
  async execute(command, params, signal, timeoutMs) {
    calls.push({ command, params, timeoutMs, aborted: signal?.aborted });
    if (command === "tabs.list") return { count: 2, activeTabId: 5, tabs: [{ id: 5, url: "https://a.example/", title: "A", active: true }, { id: 6 }] };
    if (command === "nav") return { tabId: params.tabId ?? 5, url: params.url, title: "N", siteUnreachable: { reason: "dns" } };
    if (command === "tabs.open") return { tabId: 9, url: params.url, title: "New" };
    if (command === "screenshot") return { tabId: params.tabId ?? 5, format: "jpeg", base64: "QUJD", tabTitle: "T", tabUrl: "https://x.example/" };
    if (command === "cdp") return params.method === "Page.getLayoutMetrics" ? { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } } : {};
    return {};
  },
  requireExtensionCommand(command, since) { calls.push({ gate: command, since }); },
  liveStatus: () => ({ listening: true, extensionConnected: false, extensionVersion: undefined, browser: undefined, lastError: undefined, pendingCommands: 0, readOnly: false }),
};
const ctx = new Context();
const svc = new LiveViewService(ctx, fakeBridge);
check(typeof svc.typertRemote === "object", "service carries the typertRemote binding the gateway validates");

const hasUndefined = (value) => JSON.stringify(value, (_k, v) => (v === undefined ? "<<undefined>>" : v)).includes("<<undefined>>");
const jsonSafeResults = [];
const status = svc.status();
jsonSafeResults.push(["status", status]);
check(status.listening === true && status.extensionConnected === false && status.readOnly === false, "status(): listening/connected/readOnly");
const tabs = await svc.listTabs();
jsonSafeResults.push(["listTabs", tabs]);
check(tabs.activeTabId === 5 && tabs.tabs.length === 2 && tabs.tabs[1].title === "" && tabs.tabs[1].active === false, "listTabs(): defaults missing title/url/active");
const nav = await svc.navigate("https://n.example/", null);
jsonSafeResults.push(["navigate", nav]);
check(nav.tabId === 5 && nav.unreachable === true, "navigate(null): active tab, unreachable flag from the object form");
check(calls.at(-1).params.tabId === undefined && calls.at(-1).params.waitUntil === "domcontentloaded" && calls.at(-1).timeoutMs === 17000, "navigate(null): no tabId on the wire, bridge budget 17 s");
const navPinned = await svc.navigate("https://n.example/", 8);
check(navPinned.tabId === 8 && calls.at(-1).params.tabId === 8, "navigate(8): tabId on the wire");
const opened = await svc.openTab("https://o.example/");
jsonSafeResults.push(["openTab", opened]);
check(opened.tabId === 9 && calls.at(-1).params.active === true, "openTab(): foreground tab returned");
await svc.activateTab(6);
check(calls.at(-1).command === "tabs.activate" && calls.at(-1).params.tabId === 6, "activateTab(6)");
await svc.history(6, "back");
const histCall = calls.at(-1);
check(histCall.command === "tabs.back" && callsCall(calls, "gate").since === "1.7.0", "history(back): extension capability gate + tabs.back");
function callsCall(list, key) { for (let i = list.length - 1; i >= 0; i--) if (list[i][key]) return list[i]; return {}; }
let threw = "";
try { await svc.history(6, "sideways"); } catch (error) { threw = error.message; }
check(threw.includes("back or forward"), `history(sideways) refused: ${threw}`);
const shot = await svc.screenshot();
jsonSafeResults.push(["screenshot", shot]);
check(shot.tabId === 5 && shot.dataUrl === "data:image/jpeg;base64,QUJD" && shot.title === "T", "screenshot(): data URL + title");
check(calls.at(-1).params.quality === 60 && calls.at(-1).params.format === "jpeg", "screenshot(): jpeg quality 60 on the wire");
const vp = await svc.viewport();
check(vp.width === 1280 && vp.height === 720 && calls.at(-1).command === "cdp" && calls.at(-1).params.method === "Page.getLayoutMetrics", "viewport(): Page.getLayoutMetrics cssVisualViewport");
await svc.click(3, 100.5, 200.25);
const cdpCalls = calls.filter((c) => c.command === "cdp").slice(-3).map((c) => c.params);
check(cdpCalls.map((p) => p.method).every((m) => m === "Input.dispatchMouseEvent") && JSON.stringify(cdpCalls.map((p) => p.params.type)) === JSON.stringify(["mouseMoved", "mousePressed", "mouseReleased"]), "click(): moved → pressed → released");
check(cdpCalls.every((p) => p.tabId === 3 && p.params.x === 100.5 && p.params.button === undefined || p.params.button === "left"), "click(): tabId + coordinates carried on every event");
threw = "";
try { await svc.click(null, Number.NaN, 1); } catch (error) { threw = error.message; }
check(threw.includes("finite"), `click(NaN) refused: ${threw}`);
await svc.scroll(null, 0, 240);
check(calls.at(-1).command === "scroll" && calls.at(-1).params.x === 0 && calls.at(-1).params.y === 240 && calls.at(-1).params.tabId === undefined, "scroll(): no tabId when following the active tab");
await svc.press(null, "Ctrl+A");
check(calls.at(-1).command === "press" && calls.at(-1).params.key === "Ctrl+A", "press(Ctrl+A)");
await svc.typeText(2, "hello");
check(calls.at(-1).command === "cdp" && calls.at(-1).params.method === "Input.insertText" && calls.at(-1).params.params.text === "hello", "typeText(): Input.insertText");
threw = "";
try { await svc.typeText(2, ""); } catch (error) { threw = error.message; }
check(threw.includes("non-empty"), `typeText("") refused: ${threw}`);
await svc.reload(null);
check(calls.at(-1).command === "cdp" && calls.at(-1).params.method === "Page.reload", "reload(): Page.reload");
threw = "";
try { await svc.activateTab(null); } catch (error) { threw = error.message; }
check(threw.includes("requires tabId"), `activateTab(null) refused: ${threw}`);
for (const [name, value] of jsonSafeResults) check(!hasUndefined(value), `${name}(): no undefined own property`);
check(calls.every((c) => c.timeoutMs === undefined || c.timeoutMs >= 1000), "timeouts only on navigation-shaped calls");

// ---- 3) address normalisation
const norm = plugin.__test.normalizeAddress;
check(norm("https://x.example/p") === "https://x.example/p", "address: URL kept");
check(norm("example.com/a?b=1") === "https://example.com/a?b=1", "address: bare host gets https");
check(norm("localhost:3000") === "http://localhost:3000", "address: host:port without a dot gets http");
check(norm("intranet:8080/x") === "http://intranet:8080/x", "address: intranet host:port gets http");
check(norm("gmail") === "https://www.bing.com/search?q=gmail", "address: a bare word is a search, not a host");
check(norm("deepseek harness") === "https://www.bing.com/search?q=deepseek%20harness", "address: free text becomes a search");
check(norm("   ") === "", "address: blank stays blank");

console.log(failed === 0 ? "\n结论：Live Browser 面板的 host/client 契约一致" : `\n结论：${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
