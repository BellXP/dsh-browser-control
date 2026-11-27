// 空闲解除的台子（v1.7.7）。
//   背景：Chrome 在调试器挂着的标签页顶上常驻一条自己的「“DSH Browser Control”已开始
//   调试此浏览器」信息栏，扩展藏不掉它。1.7.6 及以前是「第一次 CDP 调用挂上、一直挂着」，
//   于是用户自己浏览时也一直看着那条栏。1.7.7 起最后一次 CDP 调用后空闲 idleDetachMs
//   （默认 20 秒）就解除，下一条命令再挂上；图标替信息栏说话：蓝色 RUN = 正在操作，
//   绿色 ON = 空闲。
//   这里用真的 setTimeout 和有状态的假 chrome.debugger 把节奏、不丢东西、图标优先级逐条钉住：
//   1. 节奏：挂上 → 空闲到期解除 → 下一条命令重新挂上，图标跟着变
//   2. idleDetachMs = 0 是旧行为；非法值回落默认
//   3. 连续命令：倒计时从**最后一次**调用起算，不在中间被解除
//   4. 在飞的命令绝不被解除；它结束后才开始倒计时
//   5. 控制台 / 网络日志跨空闲解除保留（agent 想一会儿再来读，不是空的）
//   6. 仿真（视口 / UA / 触摸 / 网络与 CPU 节流）重新挂上时原样重放，reset 之后不再重放
//   7. 记录的寿命：用户断开桥就清，重连不替上一任还愿
//   8. 图标优先级：只读档的红色 RO 压过「操作中」
//   9. 设置改了即时生效（0 取消倒计时，正数从现在起重新计时）
//  10. 弹窗把「操作中 / 空闲」和图标颜色的含义写出来
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootBackground } from "./ext_harness.mjs";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "#2563eb";
const ON = "#16a34a";
const RO = "#dc2626";
const badge = (model) => `${model.badgeText}/${model.badgeColor}`;

/** 假的到桥的 WebSocket：扩展只用到 readyState / send / close 和 onopen 回调。 */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
}
FakeSocket.OPEN = 1;

/** 让后台脚本认为桥已连上（图标的 RUN / ON 只在已连接时才有意义）。 */
function openBridge(ctx) {
  ctx.WebSocket = FakeSocket;
  ctx.connect();
  const sock = FakeSocket.last;
  sock.readyState = FakeSocket.OPEN;
  sock.onopen();
  return sock;
}
const status = (model) => model.sendRuntimeMessage({ type: "bridgeStatus" });
const emulating = (log) => log.filter((e) => e.method.startsWith("Emulation.") || e.method === "Network.emulateNetworkConditions");

/* ============ 1. 节奏 ============ */
{
  const IDLE = 150;
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: IDLE } });
  const sock = openBridge(ctx);
  check("hello 报的是 manifest 里的版本（1.7.7，不是写死的）", sock.sent[0]?.version === "1.7.7" && sock.sent[0]?.type === "hello", JSON.stringify(sock.sent[0]));
  check("刚连上：没有挂着调试器，图标绿色 ON", badge(model) === `ON/${ON}`, badge(model));
  const tabId = model.addTab(1, "https://idle.test/");
  await ctx.cmdMetrics({ tabId });
  check("第一条命令挂上调试器，图标转蓝色 RUN", model.dbg.attached.has(tabId) && badge(model) === `RUN/${RUN}`, `${model.dbg.attached.has(tabId)} ${badge(model)}`);
  const s1 = await status(model);
  check("弹窗状态：attached 列出该标签页，idleDetachMs 如设置", Array.isArray(s1.attached) && s1.attached.includes(tabId) && s1.cfg.idleDetachMs === IDLE, JSON.stringify({ attached: s1.attached, idleDetachMs: s1.cfg.idleDetachMs }));
  await sleep(IDLE - 60);
  check("还没到期：调试器仍在", model.dbg.attached.has(tabId) && model.dbg.detachCount === 0, String(model.dbg.detachCount));
  await sleep(60 + 80);
  check("空闲到期：调试器解除（Chrome 的调试信息栏随之消失）", !model.dbg.attached.has(tabId) && model.dbg.detachCount === 1, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  check("解除后图标回到绿色 ON", badge(model) === `ON/${ON}`, badge(model));
  const s2 = await status(model);
  check("弹窗状态：attached 为空", Array.isArray(s2.attached) && s2.attached.length === 0, JSON.stringify(s2.attached));
  await ctx.cmdMetrics({ tabId });
  check("下一条命令重新挂上，图标又是蓝色 RUN", model.dbg.attachCount === 2 && model.dbg.attached.has(tabId) && badge(model) === `RUN/${RUN}`, `attach ${model.dbg.attachCount}`);
  ctx.disconnectNow();
}

/* ============ 2. 0 = 旧行为；非法值回落默认 ============ */
{
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: 0 } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://always.test/");
  await ctx.cmdMetrics({ tabId });
  await sleep(320);
  check("idleDetachMs = 0：不自动解除（一直挂着，和 1.7.6 一样）", model.dbg.attached.has(tabId) && model.dbg.detachCount === 0, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  ctx.disconnectNow();
}
for (const bad of ["soon", -5, null]) {
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: bad } });
  const s = await status(model);
  check(`非法的 idleDetachMs（${JSON.stringify(bad)}）回落到默认 20000，而不是 NaN 定时器`, s.cfg.idleDetachMs === 20_000, JSON.stringify(s.cfg.idleDetachMs));
  ctx.disconnectNow();
}

/* ============ 3. 连续命令：倒计时从最后一次调用起算 ============ */
{
  const IDLE = 200;
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: IDLE } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://burst.test/");
  await ctx.cmdMetrics({ tabId });          // t = 0：倒计时 A 将在 200 触发
  await sleep(80);
  await ctx.cmdMetrics({ tabId });          // t = 80：A 取消，倒计时 B 将在 280 触发
  await sleep(160);                         // t ≈ 240：A 若没取消，这里已经解除了
  check("两条命令之间不到期：倒计时被第二条重置（没有在 200ms 处被解除）", model.dbg.attached.has(tabId) && model.dbg.detachCount === 0, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  await sleep(160);                         // t ≈ 400：B 已在 280 触发
  check("最后一条命令之后到期才解除", !model.dbg.attached.has(tabId) && model.dbg.detachCount === 1, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  ctx.disconnectNow();
}

/* ============ 4. 在飞的命令绝不被解除 ============ */
{
  const IDLE = 150;
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: IDLE } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://inflight.test/");
  const running = ctx.withCDP(tabId, async () => { await sleep(250); return "done"; });
  await sleep(210);                         // 命令已跑 210ms，超过 150 的阈值
  check("命令还在跑（已超过空闲阈值）：调试器仍在", model.dbg.attached.has(tabId) && model.dbg.detachCount === 0, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  const out = await running;
  check("在飞的命令正常跑完", out === "done", String(out));
  await sleep(60);
  check("命令刚结束：倒计时从这一刻才开始，还没解除", model.dbg.attached.has(tabId), String(model.dbg.attached.has(tabId)));
  await sleep(IDLE + 60);
  check("命令结束后满 idleDetachMs 才解除", !model.dbg.attached.has(tabId) && model.dbg.detachCount === 1, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  ctx.disconnectNow();
}

/* ============ 5. 日志跨空闲解除保留 ============ */
{
  const IDLE = 120;
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: IDLE } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://logs.test/");
  await ctx.cmdMetrics({ tabId });
  model.fireCDP(tabId, "Runtime.consoleAPICalled", { type: "error", args: [{ value: "boom after click" }], timestamp: 1.5 });
  model.fireCDP(tabId, "Network.requestWillBeSent", { requestId: "r-1", request: { method: "POST", url: "https://logs.test/api" }, type: "Fetch", wallTime: 2 });
  await ctx.cmdMetrics({ tabId });
  await sleep(IDLE + 80);
  check("前提：已空闲解除", !model.dbg.attached.has(tabId));
  const log = await ctx.cmdConsoleLog({ tabId });
  check("控制台日志还在（agent 想一会儿再来读，读到的不是空的）", log.entries.some((e) => e.level === "error" && e.text === "boom after click"), JSON.stringify(log));
  const net = await ctx.cmdNetworkLog({ tabId });
  check("网络日志还在", net.requests.some((r) => r.method === "POST" && r.url === "https://logs.test/api"), JSON.stringify(net));
  ctx.disconnectNow();
}

/* ============ 6. 仿真重新挂上时重放 ============ */
{
  const IDLE = 120;
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: IDLE } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://emulated.test/");
  await ctx.cmdEmulate({ tabId, device: "mobile-iphone-13", network: "slow3g", cpuThrottlingRate: 4 });
  await sleep(IDLE + 80);
  check("前提：已空闲解除（Chrome 侧的仿真随之失效）", !model.dbg.attached.has(tabId));
  model.dbg.log.length = 0;
  await ctx.cmdMetrics({ tabId });
  const again = model.dbg.log;
  const net = again.find((e) => e.method === "Network.emulateNetworkConditions");
  check("重放网络节流 slow3g（400ms / 51200 / 51200）", Boolean(net) && net.params.latency === 400 && net.params.downloadThroughput === 51_200 && net.params.uploadThroughput === 51_200, JSON.stringify(net?.params));
  const cpu = again.find((e) => e.method === "Emulation.setCPUThrottlingRate");
  check("重放 CPU 节流 ×4", Boolean(cpu) && cpu.params.rate === 4, JSON.stringify(cpu?.params));
  const metrics = again.find((e) => e.method === "Emulation.setDeviceMetricsOverride");
  check("重放设备视口 390×844（mobile）", Boolean(metrics) && metrics.params.width === 390 && metrics.params.height === 844 && metrics.params.mobile === true, JSON.stringify(metrics?.params));
  const ua = again.find((e) => e.method === "Emulation.setUserAgentOverride");
  check("重放 UA", Boolean(ua) && /iPhone/.test(ua.params.userAgent), JSON.stringify(ua?.params));
  const touch = again.find((e) => e.method === "Emulation.setTouchEmulationEnabled");
  check("重放触摸", Boolean(touch) && touch.params.enabled === true, JSON.stringify(touch?.params));
  const order = again.map((e) => e.method);
  check("重放发生在域启用之后", order.indexOf("Page.enable") !== -1 && order.indexOf("Page.enable") < order.indexOf("Network.emulateNetworkConditions"), JSON.stringify(order));
  check("重放只有一条调试器会话（attach 一次）", model.dbg.attachCount === 2, String(model.dbg.attachCount));
  check("重放不夹带 reset 才有的清场调用", !again.some((e) => e.method === "Emulation.clearDeviceMetricsOverride"), JSON.stringify(emulating(again).map((e) => e.method)));

  // 部分更新：只清网络节流；视口 / UA / CPU 是累计状态里没动的维度，照样重放
  await ctx.cmdEmulate({ tabId, network: "reset" });
  await sleep(IDLE + 80);
  model.dbg.log.length = 0;
  await ctx.cmdMetrics({ tabId });
  check("network reset 之后：重放不再带网络节流", !model.dbg.log.some((e) => e.method === "Network.emulateNetworkConditions"), JSON.stringify(emulating(model.dbg.log).map((e) => e.method)));
  const keptMetrics = model.dbg.log.find((e) => e.method === "Emulation.setDeviceMetricsOverride");
  const keptCpu = model.dbg.log.find((e) => e.method === "Emulation.setCPUThrottlingRate");
  check("network reset 之后：视口与 CPU 节流仍重放（只动被改的那个维度）", Boolean(keptMetrics) && keptMetrics.params.width === 390 && Boolean(keptCpu) && keptCpu.params.rate === 4, JSON.stringify(emulating(model.dbg.log).map((e) => [e.method, e.params])));

  // device:"reset" 是全部还原：之后重新挂上什么都不重放
  await ctx.cmdEmulate({ tabId, device: "reset" });
  await sleep(IDLE + 80);
  model.dbg.log.length = 0;
  await ctx.cmdMetrics({ tabId });
  check("device reset 之后：重新挂上不再重放任何仿真", emulating(model.dbg.log).length === 0, JSON.stringify(emulating(model.dbg.log).map((e) => e.method)));
  ctx.disconnectNow();
}

/* ============ 7. 记录的寿命：用户断开桥 ============ */
{
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: 5000 } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://reconnect.test/");
  await ctx.cmdEmulate({ tabId, network: "offline" });
  check("前提：调试器挂着", model.dbg.attached.has(tabId));
  ctx.disconnectNow();
  check("用户断开桥：调试器解除、图标熄灭", !model.dbg.attached.has(tabId) && badge(model) === "OFF/#6b7280", `${model.dbg.attached.has(tabId)} ${badge(model)}`);
  openBridge(ctx);
  model.dbg.log.length = 0;
  await ctx.cmdMetrics({ tabId });
  check("重连后不重放断开前的仿真（下一次连接不替上一任还愿）", emulating(model.dbg.log).length === 0, JSON.stringify(emulating(model.dbg.log).map((e) => e.method)));
  ctx.disconnectNow();
}

/* ============ 8. 图标优先级：只读档压过「操作中」 ============ */
{
  const { model, ctx } = await bootBackground({ storage: { idleDetachMs: 5000, hardLock: true } });
  openBridge(ctx);
  check("已连接但只读：图标是红色 RO，不是绿色 ON", badge(model) === `RO/${RO}`, badge(model));
  const tabId = model.addTab(1, "https://locked.test/");
  const out = await ctx.cmdMetrics({ tabId });
  check("只读档下读命令照跑并挂上调试器", out.tabId === tabId && model.dbg.attached.has(tabId));
  check("挂着调试器时图标仍是 RO（「已连接但只读」不能看起来像正常）", badge(model) === `RO/${RO}`, badge(model));
  ctx.disconnectNow();
}

/* ============ 9. 设置改了即时生效 ============ */
{
  const { model, ctx, sandbox } = await bootBackground({ storage: { idleDetachMs: 0 } });
  openBridge(ctx);
  const tabId = model.addTab(1, "https://setting.test/");
  await ctx.cmdMetrics({ tabId });
  await sandbox.chrome.storage.local.set({ idleDetachMs: 120 });          // 0 → 120：已经挂着的标签页从现在起计时
  await sleep(200);
  check("0 改成正数：已挂着的标签页从改动那一刻起计时并解除", !model.dbg.attached.has(tabId) && model.dbg.detachCount === 1, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  await ctx.cmdMetrics({ tabId });
  await sandbox.chrome.storage.local.set({ idleDetachMs: 0 });            // 120 → 0：倒计时取消
  await sleep(260);
  check("正数改成 0：倒计时取消，调试器留着", model.dbg.attached.has(tabId) && model.dbg.detachCount === 1, `${model.dbg.attached.has(tabId)} ${model.dbg.detachCount}`);
  await sandbox.chrome.storage.local.set({ idleDetachMs: -1 });           // 非法：按默认 20 秒，而不是被当成 0
  const s = await status(model);
  check("改成非法值：回落默认 20000（既不是 0 也不是 NaN）", s.cfg.idleDetachMs === 20_000, JSON.stringify(s.cfg.idleDetachMs));
  await sleep(60);
  check("回落默认后调试器仍挂着（20 秒远未到）", model.dbg.attached.has(tabId), String(model.dbg.attached.has(tabId)));
  ctx.disconnectNow();
}

/* ============ 10. 弹窗 ============ */
{
  const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extension");
  const html = await readFile(path.join(EXT_DIR, "popup.html"), "utf8");
  const js = await readFile(path.join(EXT_DIR, "popup.js"), "utf8");
  check("popup.html 有「操作中 / 空闲」那一行（drive）", /id="drive"/.test(html) && /\.drive\.run\b/.test(html) && /\.drive\.idle\b/.test(html));
  check("popup.html 的圆环跟徽标同一套颜色（蓝 = 操作中）", /\.ring\.open\.run\b/.test(html) && /#2563eb/.test(html));
  check("popup.js 按 attached 区分两种状态，并写出图标颜色与自动解除的含义", /status\.attached/.test(js) && /蓝色 RUN/.test(js) && /绿色 ON/.test(js) && /idleDetachMs/.test(js) && /自动解除/.test(js));
  check("manifest 版本是 1.7.7", JSON.parse(await readFile(path.join(EXT_DIR, "manifest.json"), "utf8")).version === "1.7.7");
}

console.log(fails === 0 ? "\n全部通过" : `\n失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
