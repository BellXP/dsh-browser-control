// 本地只读开关台：断言「用户从扩展弹窗一键设为只读后，模型发不出任何会改变页面或
// 浏览器状态的命令；读类命令照常；用户自己在 dsh 侧栏面板里的操作（origin:'panel'）照常」。
//
// 由来：桥接的唯一实际边界是 127.0.0.1 + token，而 token 就明写在 profile 的
// cordis.patch.yml 里、模型能读到（也能改）。也就是说「模型自己把自己关掉」这件事
// 在当前架构里是可能的：只要它想，它能改配置重启桥接。这个开关把否决放到浏览器
// 扩展里、并且**只能从扩展弹窗解除**——模型没有那条通道。
//
// v1.7.6 起它从「全部冻结」改成「只读」：开关的含义是「模型别动我的浏览器」，不是
// 「谁都别动」。所以读命令放行，命令帧带 origin:'panel'（dsh 侧栏 Live Browser 面板，
// 桥只给它自己的 Typert 服务打这个标记，HTTP 面从不转发）的也放行。
//
// 它同时钉住一个 MV3 特有的坑：service worker 空闲约 30 秒被回收，内存里的
// 布尔值会悄悄丢失，开关等于没开过。所以 flag 必须落 chrome.storage.local，
// 台子里真的重启一次 service worker 来验它。
//
// 用法：
//   node verify/verify_hard_lock.mjs                       # 跑仓库里的扩展
//   node verify/verify_hard_lock.mjs ../../old/background.js  # 对未修版本判红
import { readFile } from "node:fs/promises";
import { runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bootBackground, makeModel } from "./ext_harness.mjs";

const CANDIDATE = process.argv[2];
/** 换一份背景脚本跑时，弹窗也读那一份旁边的（否则结构断言测的还是本地仓库）。 */
const EXT_DIR = CANDIDATE
  ? path.dirname(path.resolve(CANDIDATE))
  : fileURLToPath(new URL("../extension/", import.meta.url));
let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const errOf = (p) => p.then(() => null, (e) => String(e?.message ?? e));
/** 这句话只出自只读开关的拒绝；别的原因（没有标签页、调试器没连上）都不算。 */
const refusedBySwitch = (message) => message !== null && /已被用户设为只读|已按「只读」处理/.test(message);
/**
 * 顶层 `function` 声明会变成沙箱属性（所以能直接 `ctx.runCommand`），
 * 但 `const`/`let` 只在 context 的词法环境里 —— 要读 COMMANDS / PROTOCOL_VERSION
 * 得在同一台 context 上再跑一句。
 */
const evalIn = (ctx, expr) => runInContext(expr, ctx);

/**
 * 起一份扩展代码。`model`/`storage` 传同一个对象就等价于
 * 「service worker 被回收后重新唤醒（缓存没了，浏览器状态与本地存储还在）」。
 */
async function boot({ model, storage } = {}) {
  const opts = {};
  if (CANDIDATE) opts.backgroundPath = CANDIDATE;
  if (model) opts.model = model;
  if (storage) opts.storage = storage;
  return bootBackground(opts);
}

// ---- 1) 默认必须是关着的（开关不能自己开，也不能一装就只读）----
{
  const { model, ctx } = await boot();
  const ping = await ctx.runCommand("ping", {});
  check("默认未开：命令照常执行", ping?.pong === true, JSON.stringify(ping));
  check("默认未开：bridgeStatus 报 locked:false",
    (await model.sendRuntimeMessage({ type: "bridgeStatus" }))?.locked === false);
  check("默认未开：browser.info 报 readOnly:false", (await ctx.runCommand("browser.info", {}))?.readOnly === false);
}

// ---- 2) 弹窗一键只读：返回状态、落盘、徽标变 RO ----
const store = {};
const model = undefined; // 见下：用同一个 model 模拟重启
let m1 = await boot({ storage: store });
const sharedModel = m1.model;
{
  const { ctx } = m1;
  const res = await sharedModel.sendRuntimeMessage({ type: "lockSet", locked: true });
  check("lockSet{locked:true}：弹窗拿到回执", res?.locked === true, JSON.stringify(res));
  check("开启后立刻落盘（chrome.storage.local.hardLock，沿用旧键：老用户的锁自然变成只读）", store.hardLock === true, JSON.stringify(store));
  check("开启后徽标变成 RO（绿色 ON 会骗人）", sharedModel.badgeText === "RO",
    JSON.stringify({ text: sharedModel.badgeText, color: sharedModel.badgeColor }));
  check("bridgeStatus 跟着报 locked:true",
    (await sharedModel.sendRuntimeMessage({ type: "bridgeStatus" }))?.locked === true);
  check("browser.info 报 readOnly:true（面板和模型看到同一个事实）", (await ctx.runCommand("browser.info", {}))?.readOnly === true);
  check("开启不掐连接：仍允许 popup 断/连（那是 WS 控制，不是命令）",
    typeof ctx.connect === "function" && typeof ctx.disconnectNow === "function");
}

// ---- 3) 逐条扫 COMMANDS 表：写命令全部被拦，读命令全部放行 ----
{
  const { model: m, ctx } = m1;
  const commands = Object.keys(evalIn(ctx, "COMMANDS"));
  const isReadOnlyCall = (command, params) => runInContext(`isReadOnlyCall(${JSON.stringify(command)}, ${JSON.stringify(params)})`, ctx);
  const probe = { selector: "#q", key: "a" };
  const writes = [];
  const reads = [];
  for (const command of commands) (isReadOnlyCall(command, probe) ? reads : writes).push(command);
  check(`读/写分类读得出来（读 ${reads.length} 条，写 ${writes.length} 条）`, reads.length >= 10 && writes.length >= 10,
    `读：${reads.join(",")}`);

  // 写命令：先跑，此刻必须一次 CDP 都没发、一个标签页都没碰。
  const leaked = [];
  for (const command of writes) {
    const message = await errOf(ctx.runCommand(command, probe));
    if (!refusedBySwitch(message) || !message.includes(command)) leaked.push(`${command}: ${message === null ? "居然执行了" : message}`);
  }
  check(`写命令 ${writes.length} 条全部被只读开关拦下`, leaked.length === 0, leaked.join(" | "));
  check("拦截发生在执行之前：一次 CDP 调用都没发出", m.dbg.log.length === 0, `dbg.log=${m.dbg.log.length}`);
  check("拦截发生在执行之前：一个标签页都没被动过", m.tabs.size === 0, `tabs=${m.tabs.size}`);

  // 读命令：一条都不许被开关拦下（在台子里它们会因「没有标签页」之类失败，那不是开关的事）。
  const blockedReads = [];
  for (const command of reads) {
    const message = await errOf(ctx.runCommand(command, probe));
    if (refusedBySwitch(message)) blockedReads.push(`${command}: ${message}`);
  }
  check(`读命令 ${reads.length} 条全部放行（含 content/snapshot/screenshot/tabs.list）`, blockedReads.length === 0, blockedReads.join(" | "));
  check("ping 真的执行了", (await ctx.runCommand("ping", {}))?.pong === true);

  const clickMsg = await errOf(ctx.runCommand("click", { selector: "#q" }));
  check("拒绝文案点名被拦的命令", clickMsg?.includes("click") === true, String(clickMsg));
  check("拒绝文案说清解除只能由用户在扩展弹窗做（模型照着做不成就别试）",
    /解除只能由用户在浏览器工具栏的扩展弹窗里点「已只读」完成/.test(clickMsg ?? ""), String(clickMsg));
  check("拒绝文案明确劝退重试", /不要重试/.test(clickMsg ?? ""), String(clickMsg));
  check("拒绝文案告诉模型读类命令仍可用（好让它改用只读工具，而不是干等）", /读页面、截图、列标签页这类只读命令仍然可用/.test(clickMsg ?? ""));

  // 参数级规则与插件只读档一致：hold 只放 status，wait 不带 fn。
  check("hold action=on 被拦（它改页面 DOM）", refusedBySwitch(await errOf(ctx.runCommand("hold", { action: "on", note: "x" }))));
  check("hold action=status 放行", !refusedBySwitch(await errOf(ctx.runCommand("hold", { action: "status" }))));
  check("wait(fn) 被拦（谓词是任意 JS）", refusedBySwitch(await errOf(ctx.runCommand("wait", { fn: "() => true", timeoutMs: 50 }))));
  check("wait(selector) 放行", !refusedBySwitch(await errOf(ctx.runCommand("wait", { selector: "#ready", timeoutMs: 50 }))));

  // 面板：命令帧带 origin:'panel' 的是用户自己的手，开关不拦。
  check("origin:'panel' 的写命令放行（面板是用户的手）", !refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }, "panel"))));
  check("origin:'tool' 照拦", refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }, "tool"))));
  check("origin 大小写/拼写不对不算面板（'Panel' 照拦）", refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }, "Panel"))));
  const frames = [];
  const originalSend = ctx.send;
  ctx.send = (frame) => frames.push(frame);
  try {
    ctx.handleBridgeMessage({ type: "command", id: "p1", command: "click", params: { selector: "#q" }, origin: "panel" });
    ctx.handleBridgeMessage({ type: "command", id: "a1", command: "click", params: { selector: "#q" } });
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    ctx.send = originalSend;
  }
  const p1 = frames.find((f) => f.id === "p1");
  const a1 = frames.find((f) => f.id === "a1");
  check("桥发来的命令帧：origin:'panel' 的 click 没有被开关拒绝", p1 !== undefined && !refusedBySwitch(String(p1.error ?? "")), JSON.stringify(p1)?.slice(0, 120));
  check("桥发来的命令帧：不带 origin 的 click 被开关拒绝", a1?.ok === false && refusedBySwitch(String(a1.error ?? "")), JSON.stringify(a1)?.slice(0, 120));
}

// ---- 4) 模型侧没有解除通道：开关不是一条命令 ----
{
  const { ctx } = m1;
  check("COMMANDS 表里没有 lockSet/lock/unlock 这类命令",
    ["lockSet", "lock", "unlock", "hardLock"].every((k) => evalIn(ctx, "COMMANDS")[k] === undefined),
    JSON.stringify(["lockSet", "lock", "unlock", "hardLock"].filter((k) => evalIn(ctx, "COMMANDS")[k] !== undefined)));
  // 桥接发来的帧走的是同一条 runCommand；即使有人塞一条 lockSet 命令帧也只会被当作
  // 普通命令（这里是未知命令）拦下，状态不变。模型也塞不出 origin:'panel'：那个字段只有
  // 桥在面板的 Typert 服务里写，/api/command 从不转发（verify_policy 对账源码）。
  ctx.handleBridgeMessage({ type: "command", id: "bridge-1", command: "lockSet", params: { locked: false } });
  await new Promise((r) => setTimeout(r, 20));
  check("桥侧塞一条 lockSet 命令帧：仍然是只读的", store.hardLock === true && refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }))));
  check("params 里塞 origin:'panel' 冒充面板不算（只认帧顶层的 origin）", refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q", origin: "panel" }))));
  check("协议版本没有变（帧契约未动：老扩展忽略多出来的 origin 字段）", evalIn(ctx, "PROTOCOL_VERSION") === 1, String(evalIn(ctx, "PROTOCOL_VERSION")));
}

// ---- 5) service worker 被回收后重启：开关必须还在 ----
{
  const revived = await boot({ model: sharedModel, storage: store });
  const clickErr = await errOf(revived.ctx.runCommand("click", { selector: "#q" }));
  check("SW 重启后仍然是只读的（内存标志会丢，落盘的不会）", refusedBySwitch(clickErr), String(clickErr));
  check("SW 重启后读命令仍放行", (await revived.ctx.runCommand("ping", {}))?.pong === true);
  check("SW 重启后徽标仍是 RO", sharedModel.badgeText === "RO", String(sharedModel.badgeText));

  const unlocked = await sharedModel.sendRuntimeMessage({ type: "lockSet", locked: false });
  check("重启后用户仍能在弹窗解除", unlocked?.locked === false, JSON.stringify(unlocked));
  check("解除后写命令恢复执行（不再被开关拦）", !refusedBySwitch(await errOf(revived.ctx.runCommand("click", { selector: "#q" }))));
  check("解除后落盘为 false", store.hardLock === false, JSON.stringify(store));
  check("解除后 browser.info 报 readOnly:false", (await revived.ctx.runCommand("browser.info", {}))?.readOnly === false);
}

// ---- 6) fail-closed：畸形消息不许把开关关掉 ----
{
  const s6 = {};
  const { model: m, ctx } = await boot({ storage: s6 });
  await m.sendRuntimeMessage({ type: "lockSet", locked: true });
  await m.sendRuntimeMessage({ type: "lockSet" });
  check("少了 locked 字段的消息不会解除只读", s6.hardLock === true && refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }))));
  await m.sendRuntimeMessage({ type: "lockSet", locked: "nope" });
  check("locked 不是布尔值的消息也不会解除只读", s6.hardLock === true && refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }))));
}

// ---- 7) 弹窗真的接上了这条通道（popup 在 vm 里跑不起来，只能核结构）----
{
  const html = await readFile(path.join(EXT_DIR, "popup.html"), "utf8");
  const js = await readFile(path.join(EXT_DIR, "popup.js"), "utf8");
  check("popup.html 有只读按钮（在断开连接与状态页之间）",
    /id="reconnect"[\s\S]*id="lock"[\s\S]*id="openStatus"/.test(html));
  check("popup.html 的按钮文案是「只读」而不是「锁定」", /id="lock">只读</.test(html));
  check("popup.js 用单击切换并走 lockSet 通道（按上次渲染的状态取反）", /type: ['"]lockSet['"],\s*locked: !lastLocked/.test(js));
  check("按钮文案在开启后变成「已只读」", /'已只读' : '只读'/.test(js));
  check("popup 分得清「用户开的」与「读不出开关状态」，不冤枉用户去按一个他没按的键",
    /lockReason === 'unreadable'/.test(js) && /只读开关的状态读不出来/.test(js));
  check("弹窗提示写明只拦模型、面板不受影响", /只拦模型/.test(js) && /操作不受影响/.test(js));
}

// ---- 8) service worker 刚唤醒就把徽标画对，不能等第一条命令 ----
// 开关状态是落盘的，而 setState() 只在连接变化时画徽标。如果只有 runCommand 里才重读，
// 唤醒后到第一条命令之间图标显示的是绿色 ON —— 用户以为只读，桥那边模型却在动。
{
  const seeded = { hardLock: true };
  const { model, ctx } = await boot({ storage: seeded });
  check("开机（未跑任何命令）徽标就已经是 RO", model.badgeText === "RO",
    JSON.stringify({ text: model.badgeText, color: model.badgeColor }));
  const status = await model.sendRuntimeMessage({ type: "bridgeStatus" });
  check("开机时 bridgeStatus 就报 locked:true", status?.locked === true, JSON.stringify(status?.locked));
  check("bridgeStatus 说明开关的来路（user），弹窗才敢写「已只读」",
    status?.lockReason === "user", String(status?.lockReason));
  check("只读的扩展放行读命令", !refusedBySwitch(await errOf(ctx.runCommand("content", { selector: "body" }))));
  check("只读的扩展拦下写命令", refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }))));
}

// ---- 9) 读不出开关状态时必须 fail-closed ----
// 用户设下的否决唯一不能有的失败方式是「以为开着其实没开」。读盘失败如果按「没开」
// 处理，开关就在最需要它的时候消失，而且没有任何人会知道。
{
  const m = makeModel();
  m.storageGetError = "storage unavailable (simulated)";
  m.storageGetErrorKeys = ["hardLock"]; // 只让开关那一次读盘失败，loadConfig 照常
  const { ctx } = await boot({ model: m, storage: {} });
  const err = await errOf(ctx.runCommand("click", { selector: "#q" }));
  check("读盘失败 → 写命令被拦下（fail-closed，不是照常执行）", err !== null, String(err));
  check("读盘失败 → 文案说的是「读不出开关状态」，不冤枉用户去按开关",
    /读不出本地只读开关的状态/.test(err ?? "") && !/已被用户设为只读/.test(err ?? ""), String(err)?.slice(0, 90));
  check("读盘失败 → 告诉模型下一次会重读（所以重试安全）", /下一次调用会重新读/.test(err ?? ""));
  check("读盘失败 → 读命令仍放行", !refusedBySwitch(await errOf(ctx.runCommand("ping", {}))));
  check("读盘失败时徽标也是 RO（不能只显示绿色 ON）", m.badgeText === "RO", String(m.badgeText));
  const reason = evalIn(ctx, "lastError");
  check("读盘失败写进 lastError，状态页看得到原因", /读取本地只读开关失败/.test(String(reason ?? "")), String(reason)?.slice(0, 60));
  const status = await m.sendRuntimeMessage({ type: "bridgeStatus" });
  check("bridgeStatus 报 lockReason=unreadable，弹窗才不会谎称「已只读」",
    status?.lockReason === "unreadable" && status?.locked === true, JSON.stringify(status?.lockReason));
  // 用户仍然解得开：解除走内存里的 setHardLock，不依赖那次失败的读盘。
  const unlocked = await m.sendRuntimeMessage({ type: "lockSet", locked: false });
  check("读盘失败后用户仍能从弹窗解除（解除不依赖那次 get）", unlocked?.locked === false, JSON.stringify(unlocked));
  check("解除后写命令恢复执行", !refusedBySwitch(await errOf(ctx.runCommand("click", { selector: "#q" }))));
}

console.log(fails === 0 ? "\n本地只读开关全部符合契约" : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
