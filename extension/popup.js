/** Popup for DSH Browser Control: big status hero, config tucked under 高级. */
'use strict';

const $ = (id) => document.getElementById(id);

/** The switch state shown by the last render; the button toggles it. */
let lastLocked = false;

const STATE_TEXT = {
	open: '已连接',
	connecting: '连接中…',
	idle: '未连接',
};
const STATE_SUB = {
	open: () => '桥接服务运行中，随时听候调用',
	connecting: () => '正在与 dsh 桥接服务握手',
	idle: () => '没连上桥接服务：确认 dsh 在跑、插件已装（装上即默认开启）',
};

function render(status) {
	const ring = $('ring');
	ring.className = `ring ${status.state}`;
	$('state').textContent = STATE_TEXT[status.state] ?? status.state;
	$('hello').textContent = status.helloInfo
		? `${status.helloInfo.name} ${status.helloInfo.version}`
		: (STATE_SUB[status.state]?.() ?? '');
	if (document.activeElement !== $('port')) $('port').value = status.cfg.port ?? 9777;
	if (document.activeElement !== $('token')) $('token').value = status.cfg.token;
	$('auto').checked = Boolean(status.cfg.autoConnect);
	const connected = status.state === 'open';
	const btn = $('reconnect');
	btn.textContent = connected ? '断开连接' : (status.state === 'connecting' ? '连接中…' : '立即连接');
	btn.classList.toggle('danger', connected);
	btn.dataset.connected = String(connected);
	const locked = status.locked === true;
	// 只读有两种来路：用户真按了开关，或者扩展读不出开关状态、按只读处理（fail-closed）。
	// 后者也说「点『已只读』解除」会让用户以为是自己误触，所以分开写。
	const unreadable = locked && status.lockReason === 'unreadable';
	lastLocked = locked;
	const lock = $('lock');
	lock.textContent = locked ? '已只读' : '只读';
	lock.classList.toggle('locked', locked);
	const hint = $('lockhint');
	hint.textContent = unreadable
		? '只读开关的状态读不出来（chrome.storage.local 失败），已按只读处理。点这里可以重新写入明确状态。'
		: locked
			? '只读模式：模型只能看（读页面、截图、列标签页），不能动；你自己在 dsh 侧栏「实时浏览器」里的操作不受影响，连接保持。点「已只读」解除。'
			: '只读 = 只拦模型：开启后模型仍能读页面，但点击、输入、导航、滚动都会被拒；你自己的操作不受影响。解除只能在这里点。';
	hint.className = locked ? 'lockhint on' : 'lockhint';
	const errorBox = $('error');
	errorBox.textContent = status.lastError ?? '';
	errorBox.className = errorBox.textContent.length > 0 ? 'error show' : 'error';
}

async function refresh() {
	try {
		render(await chrome.runtime.sendMessage({ type: 'bridgeStatus' }));
	} catch (err) {
		const box = $('error');
		box.textContent = `扩展未响应: ${err.message}`;
		box.className = 'error show';
	}
}

$('reconnect').addEventListener('click', async () => {
	const connected = $('reconnect').dataset.connected === 'true';
	await chrome.runtime.sendMessage({ type: connected ? 'disconnect' : 'reconnect' });
	setTimeout(refresh, 600);
});

// Single click: opening the popup is already a deliberate user gesture, and a
// read-only switch that needs a second click is a read-only switch with a delay.
$('lock').addEventListener('click', async () => {
	await chrome.runtime.sendMessage({ type: 'lockSet', locked: !lastLocked });
	refresh();
});

$('openStatus').addEventListener('click', async () => {
	const port = Number($('port').value) || 9777;
	await chrome.tabs.create({ url: `http://127.0.0.1:${port}/` });
	window.close();
});

$('gear').addEventListener('click', () => {
	const panel = $('advanced');
	const opening = !panel.classList.contains('open');
	panel.classList.toggle('open', opening);
	$('gear').textContent = opening ? '高级 ▴' : '高级 ▾';
});

$('save').addEventListener('click', async () => {
	await chrome.storage.local.set({
		port: Number($('port').value) || 9777,
		token: $('token').value.trim(),
		autoConnect: $('auto').checked,
	});
	await chrome.runtime.sendMessage({ type: 'reconnect' });
	setTimeout(refresh, 600);
});

$('ver').textContent = chrome.runtime.getManifest().version;
refresh();
setInterval(refresh, 1500);
