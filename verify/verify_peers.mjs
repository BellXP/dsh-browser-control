// 依赖声明实测：同一条 peer 范围有**两个读法完全不同的消费者**，必须同时满足。
//
//   1) 宿主的兼容门禁（@deepseek-ai/dsh-app-boot/lib/index.js:294-300，实测读法）：
//      只看名字是 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的 peer，拿**宿主版本号**
//      去 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`；
//      不过就 throw（:931），插件 bundle 被整个跳过，要 `dsh plugin allow-version` 才救得回来。
//   2) 包管理器（pnpm/npm，默认语义，不带 includePrerelease）：拿**包自己的版本列表**去匹配。
//      semver 对预发布版的规则是「范围里必须有同 [major,minor,patch] 元组的预发布比较符」，
//      而 `@deepseek-ai/dsh-*` 全族没有任何稳定版。
//
// v1.0.8 栽在只想着 1)：`">=0.1.0-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.3.0-0"` 对宿主门禁全过
// （实测 `satisfies('0.2.0-rc.2', …, includePre)` = true），但对 2) 最大只解析到
// **0.1.0-rc.8**——pnpm 默认 `auto-install-peers=true`，于是干净目录里装发布包真的拉了
// 一整棵 0.1.0 时代的依赖树（19 个包，含 `dsh-agent@0.1.0-*`），typecheck 也一直在校半年前的 API。
// 只钉精确版本（`"0.2.0-rc.2"`）则反过来死在 1)：dsh 0.1.7 / 0.2.1 宿主上门禁直接判不兼容。
//
// 所以能同时过两关的写法只有一种：**精确钉版 `||` 宽范围**——
// `"0.2.0-rc.2 || >=0.1.0-rc.1 <0.3.0-0"`。实测：包管理器 maxSatisfying 得到 0.2.0-rc.2，
// 宿主门禁对 0.1.2-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.2 / 0.2.1-alpha.2 全过。
//
// v1.8.0（适配 dsh 0.2.2-rc.5）起换了策略：peer 下限抬到 rc.5（`>=0.2.2-rc.5 <0.3.0-0`），
// 不再并列精确支。原因：`@deepseek-ai/dsh-invariants` 已随宿主移除、cordis 4.1.0 /
// schemastery 3.19.0 换代，旧世代宿主不再声称支持；而「解析器锚点」的职责改由
// devDependencies 的**精确钉版**承担（0.2.2-rc.5 / 4.1.0）——锁文件与 typecheck 校的是它们，
// 终端用户的宿主包由运行中的 dsh 自己提供（peer），不从 registry 解析。下面第 1 关据此改写：
// 涉及预发布版的 peer，必须有同名精确 devDependency 且落在 peer 范围内。
import { readFile } from "node:fs/promises";
import semver from "semver";

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

/** 本插件声称兼容的宿主世代（v1.8.0 起）：peer 下限即此，typecheck / build 校的也是它的真实类型。抬 ceiling 是一次有意的决定。 */
const SUPPORTED_HOSTS = ["0.2.2-rc.5"];
/** 宿主注入的包：必须是 peer，且只有 @deepseek-ai/dsh* 会被门禁检查。 */
const HOST_OWNED = ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-settings"];
/** 宿主已移除的包（dsh 0.2.1 起不再发布 `@deepseek-ai/dsh-invariants` 与各包的 `./invariant` 子路径）：任何地方都不得再声明。 */
const REMOVED_HOST_PACKAGES = ["@deepseek-ai/dsh-invariants"];
/** 跟着包一起发的纯工具库：官方插件（dsh-persona / dsh-skill）都放 dependencies。 */
const BUNDLED = ["@deepseek-ai/schemastery"];

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const peers = pkg.peerDependencies ?? {};
const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};
const gated = (name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-");
const alternatives = (range) => String(range).split("||").map((s) => s.trim()).filter(Boolean);
const isExact = (part) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(part);
const isStableCaretTilde = (part) => /^[\^~]\d+\.\d+\.\d+$/.test(part);

const installed = {};
for (const name of new Set([...Object.keys(peers), ...Object.keys(deps)])) {
  try {
    installed[name] = JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version;
  } catch {
    installed[name] = undefined;
  }
}

/* 1 —— 形状：每个选择支都得是包管理器看得懂的形式；涉及预发布版的 peer 要有精确 devDependency 当锚点 */
for (const [label, table] of [["peer", peers], ["dependency", deps]]) {
  for (const [name, range] of Object.entries(table)) {
    const parts = alternatives(range);
    const junk = parts.filter((p) => !isExact(p) && !isStableCaretTilde(p) && !/^>=[^|]*<[^|]*$/.test(p));
    check(`${label} ${name} 的选择支形式合法`, junk.length === 0, junk.length ? `"${range}" 里的 ${junk.join(" / ")}` : "");
    if (label !== "peer") continue;
    const needsAnchor = parts.some((p) => /-/.test(p.replace(/^[\^~]/, "")));
    const devPin = devDeps[name];
    const anchored = isExact(String(devPin ?? "")) && semver.satisfies(devPin, range);
    check(`peer ${name} 涉及预发布版：devDependencies 必须精确钉版且落在 peer 范围内（锁文件/typecheck 的锚点）`,
      !needsAnchor || anchored, needsAnchor && !anchored ? `"${range}" 的锚点是 devDependencies=${devPin ?? "(无)"}` : needsAnchor ? `锚点 ${devPin}` : "");
  }
}

/* 2 —— 包管理器视角：我们构建时用的那个版本，必须满足我们对外声明的范围 */
for (const [name, range] of Object.entries({ ...peers, ...deps })) {
  const have = installed[name];
  if (have === undefined) { check(`${name} 本地已安装`, false, "node_modules 里没有它"); continue; }
  check(`包管理器视角：${name}@${have} 满足 "${range}"`, semver.satisfies(have, range),
    semver.satisfies(have, range) ? "" : `satisfies=false，解析器只会拿到 ${semver.maxSatisfying([have], range) ?? "null"}`);
}

/* 3 —— 宿主门禁视角：声称支持的每一代宿主都必须过 evaluatePluginCompatibility */
for (const [name, range] of Object.entries(peers)) {
  if (!gated(name)) continue;
  for (const host of SUPPORTED_HOSTS) {
    check(`宿主门禁：dsh ${host} 装本插件时 peer ${name} 要判兼容`,
      semver.satisfies(host, range, { includePrerelease: true }), semver.satisfies(host, range, { includePrerelease: true }) ? "" : `宿主会被判不兼容：${range}`);
  }
}

/* 4 —— 归属：宿主包只能当 peer，工具库必须是 dependency；宿主已移除的包哪里都不能出现 */
for (const name of HOST_OWNED) {
  const why = !(name in peers) ? "peer 里缺它" : name in deps ? "同时出现在 dependencies，会装出第二份宿主包" : "";
  check(`${name} 声明为 peer 且没有同时是 dependency`, why === "", why);
}
for (const name of REMOVED_HOST_PACKAGES) {
  const where = [["peerDependencies", peers], ["dependencies", deps], ["devDependencies", devDeps]].filter(([, t]) => name in t).map(([l]) => l);
  check(`${name} 已随宿主移除，不得再声明`, where.length === 0, where.join(", "));
}
for (const name of BUNDLED) {
  check(`${name} 声明为 dependency`, name in deps && !(name in peers), `dependencies=${deps[name] ?? "(无)"}`);
}

/* 5 —— 构建产物的 import 闭包：裸模块必须都有声明 */
const runtime = new Set();
for (const bundle of ["lib/index.js"]) {
  const code = await readFile(bundle, "utf8");
  const bare = [...code.matchAll(/from\s+"([^"./][^"]*)"/g)].map((m) => m[1]).filter((s) => !s.startsWith("node:"));
  for (const s of bare) runtime.add(s);
  const undeclared = [...new Set(bare)].filter((s) => !(s in deps) && !(s in peers));
  check(`${bundle} 的裸 import 全部有声明`, undeclared.length === 0,
    undeclared.length ? `没声明：${undeclared.join(", ")}` : `扫到 ${new Set(bare).size} 个：${[...new Set(bare)].join(", ") || "(无)"}`);
}
const asDeps = [...runtime].filter((s) => s in deps && HOST_OWNED.includes(s));
check("运行时引用的宿主包没有被塞进 dependencies", asDeps.length === 0, asDeps.join(", "));
console.log(`   产物运行时真正 import 的外部包：${[...runtime].join(", ")}`);

/* 6 —— schemastery 与宿主同族（~；dsh 0.2.2-rc.5 自己钉 ~3.19.0），且不需要门禁锚点（它有稳定版） */
const schemaRange = deps["@deepseek-ai/schemastery"] ?? "";
check("schemastery 用 ~（宿主自己也是 ~3.19.x）", /^~\d+\.\d+\.\d+$/.test(schemaRange), schemaRange);

/* 7 —— 不声明 engines.dsh：Node 版本由宿主决定（dsh 0.2.1+ 要求 Node 24）；宿主门禁先读 engines.dsh、
   没有才回落到 peerDependencies——本插件刻意留在 peer 这一侧（v0.2.1-alpha.3/plugin-engines-dsh） */
check("package.json 不写 engines", pkg.engines === undefined, pkg.engines === undefined ? "" : JSON.stringify(pkg.engines));

console.log(`\n结论：${fails === 0 ? "依赖声明同时过宿主门禁与包管理器两关" : fails + " 项不过"}`);
process.exit(fails ? 1 : 0);
