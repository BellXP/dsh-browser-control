/**
 * @angelky7/dsh-browser-control — client half: the Live Browser tab in the right Sidebar (v1.9.0).
 *
 * Official client plugin shape: window.__ModuleLoader__.load({ id, factory(require) }). The
 * factory resolves only web modules from the module table (React here), uses no JSX (the web
 * ModuleLoader executes this file as is), and styles with --dsw-alias-* tokens only.
 *
 * What it registers:
 *  - a right-Sidebar tab type (ctx.sidebarRightTabs.register, kind 'live-browser') with one
 *    guide entry, and its body in the 'sidebar.right.pane.tab' slot under the same key;
 *  - the Typert remote 'browser-live' (host half: src/live.ts). Parameter names and their
 *    order must match the host descriptors; every call passes all parameters (null = the
 *    browser's active tab) because the client codec is strict.
 *
 * The tab shows the real browser tab the extension controls as a refreshed JPEG frame and
 * drives it with the same bridge the model's browser_* tools use: tab switcher, address bar,
 * history, reload, click on the frame, wheel scroll, text and keys. Nothing here talks to the
 * bridge directly — the bridge's HTTP face sends no CORS headers by design.
 */
window.__ModuleLoader__.load({
  id: '@angelky7/dsh-browser-control',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React
    const h = React.createElement

    const PACKAGE = '@angelky7/dsh-browser-control'
    const NAMESPACE = 'browser-live'
    const TAB_TYPE_ID = PACKAGE
    const TAB_KIND = 'live-browser'
    const LOCALE_NS = 'browserLive'
    const FRAME_INTERVAL_MS = 1500
    const LIST_INTERVAL_MS = 5000
    const CALL_TIMEOUT_MS = 45000

    // ------------------------------------------------------------ typert (same shape as src/live.ts)
    const PARAM_NAMES = ['url', 'tabId', 'direction', 'x', 'y', 'key', 'text']
    const PASSTHROUGH_SCHEMA = {
      '~standard': { version: 1, vendor: 'schemastery', validate: (value) => ({ value }) },
    }
    function paramCodec(name) {
      return { mode: 'strict', typeSymbol: PACKAGE + '#' + name, create: () => PASSTHROUGH_SCHEMA }
    }
    function desc(method, params) {
      return {
        id: PACKAGE + '#' + NAMESPACE + '/' + method,
        service: NAMESPACE,
        namespace: NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters: params.map((name) => ({ name, wire: name, source: 'json', codec: paramCodec(name) })),
        result: { mode: 'src-json' },
      }
    }
    const CLIENT_TYPERT_REMOTE = {
      package: PACKAGE,
      schemas: PARAM_NAMES.map((name) => ({ name, create: () => PASSTHROUGH_SCHEMA })),
      descriptors: [
        desc('status', []),
        desc('listTabs', []),
        desc('navigate', ['url', 'tabId']),
        desc('openTab', ['url']),
        desc('activateTab', ['tabId']),
        desc('history', ['tabId', 'direction']),
        desc('reload', ['tabId']),
        desc('screenshot', ['tabId']),
        desc('viewport', ['tabId']),
        desc('click', ['tabId', 'x', 'y']),
        desc('scroll', ['tabId', 'x', 'y']),
        desc('press', ['tabId', 'key']),
        desc('typeText', ['tabId', 'text']),
      ],
    }

    // ------------------------------------------------------------ remote mount state (shared by every tab body)
    const mount = { ready: false, error: null, listeners: new Set() }
    function setMount(patch) {
      Object.assign(mount, patch)
      for (const listener of mount.listeners) listener()
    }
    function subscribeMount(listener) {
      mount.listeners.add(listener)
      return () => mount.listeners.delete(listener)
    }
    const getMountReady = () => mount.ready
    const getMountError = () => mount.error

    // ------------------------------------------------------------ copy
    const zh = {
      'type.label': '实时浏览器',
      'guide.title': '实时浏览器',
      'guide.description': '查看并操作扩展接管的浏览器标签页',
      'tab.select': '选择要显示的标签页',
      'follow.active': '（跟随当前标签页）',
      'address.placeholder': '输入网址或搜索词，回车打开',
      'go': '前往',
      'new.tab': '新标签页',
      'new.tab.hint': '在新标签页中打开地址栏内容',
      'back': '后退',
      'forward': '前进',
      'reload.page': '刷新页面',
      'refresh.view': '刷新画面',
      'auto': '自动刷新',
      'open.external': '在浏览器中打开',
      'type.placeholder': '输入文字发送到页面（Enter 发送并回车，Shift+Enter 只发送）',
      'send': '发送',
      'loading': '正在连接…',
      'status.disabled': 'browser-bridge 未启用：在插件设置里打开 enabled。',
      'status.offline': '扩展未连接：打开装了 DSH Browser Control 扩展的浏览器（图标变绿），然后点「刷新画面」。',
      'status.readOnly': '只读档已开：agent 的工具不能操作浏览器；你在面板里的操作不受限。',
      'remote.missing': '浏览器控制面板尚未就绪（插件 host 半未加载），请刷新页面。',
      'remote.mount.failed': '客户端远程挂载失败：',
      'empty': '还没有画面。点「刷新画面」或等待自动刷新。',
      'empty.offline': '扩展连接后这里显示它接管的标签页。',
      'updated': '更新于',
      'nav.unreachable': '页面打不开（站点不可达或仍在加载）。',
      'click.hint': '在画面上点击即点击页面；滚轮即滚动页面。',
    }
    const en = {
      'type.label': 'Live Browser',
      'guide.title': 'Live Browser',
      'guide.description': 'View and drive the tab your browser extension controls',
      'tab.select': 'Tab to show',
      'follow.active': '(follow the active tab)',
      'address.placeholder': 'Type a URL or search, Enter to open',
      'go': 'Go',
      'new.tab': 'New tab',
      'new.tab.hint': 'Open the address bar in a new tab',
      'back': 'Back',
      'forward': 'Forward',
      'reload.page': 'Reload page',
      'refresh.view': 'Refresh view',
      'auto': 'Auto refresh',
      'open.external': 'Open in browser',
      'type.placeholder': 'Text to send to the page (Enter sends and presses Enter, Shift+Enter sends only)',
      'send': 'Send',
      'loading': 'Connecting…',
      'status.disabled': 'The browser bridge is disabled: turn on enabled in the plugin settings.',
      'status.offline': 'Extension not connected: open the browser with the DSH Browser Control extension (icon turns green), then press Refresh view.',
      'status.readOnly': 'Read-only mode is on: the agent cannot act; your own actions in this panel are not restricted.',
      'remote.missing': 'The browser panel is not ready yet (plugin host half not loaded); refresh the page.',
      'remote.mount.failed': 'Client remote mount failed: ',
      'empty': 'No picture yet. Press Refresh view or wait for auto refresh.',
      'empty.offline': 'Once the extension connects, the tab it controls shows here.',
      'updated': 'updated',
      'nav.unreachable': 'The page did not open (site unreachable or still loading).',
      'click.hint': 'Click the picture to click the page; the wheel scrolls it.',
    }

    // ------------------------------------------------------------ helpers
    function unwrap(res, fallback) {
      if (res && typeof res === 'object' && res.ok === true) return res.value
      return fallback
    }
    function resError(res, fallback) {
      const e = res && typeof res === 'object' ? res.error : null
      return (e && typeof e === 'object' && typeof e.message === 'string' && e.message) || fallback
    }
    function withTimeout(promise, ms, label) {
      const guarded = Promise.resolve(promise)
      guarded.catch(() => {})
      let timer
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + ' ms')), ms)
      })
      return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer))
    }
    function errorText(error) {
      return String((error && error.message) || error)
    }
    /** Bare host names get https (local ones http); anything that does not look like an address becomes a search. */
    function normalizeAddress(raw) {
      const text = String(raw || '').trim()
      if (text === '') return ''
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
      if (text.includes(' ')) return 'https://www.bing.com/search?q=' + encodeURIComponent(text)
      if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text
      if (/^(localhost|[\w-]+):\d+(\/.*)?$/i.test(text)) return 'http://' + text
      if (/^localhost(\/.*)?$/i.test(text)) return 'http://' + text
      return 'https://www.bing.com/search?q=' + encodeURIComponent(text)
    }
    function truncate(text, max) {
      const s = String(text || '')
      return s.length > max ? s.slice(0, max - 1) + '…' : s
    }

    // ------------------------------------------------------------ styles (theme tokens only)
    const T = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      bg: 'var(--dsw-alias-bg-base)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }
    const panelStyle = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, boxSizing: 'border-box', background: T.bg, color: T.text, fontSize: '12px' }
    const rowStyle = { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', flex: '0 0 auto' }
    const controlBase = { fontFamily: 'inherit', fontSize: '12px', color: T.text, background: T.layer, border: '1px solid ' + T.border, borderRadius: '6px', height: '26px', boxSizing: 'border-box', outline: 'none', margin: 0 }
    const buttonStyle = (disabled) => Object.assign({}, controlBase, { padding: '0 9px', lineHeight: '24px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' })
    const inputStyle = Object.assign({}, controlBase, { flex: '1 1 auto', minWidth: 0, padding: '0 8px', lineHeight: '24px' })
    const statusStyle = { padding: '0 10px 4px', fontSize: '11px', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 0 auto' }
    const viewportStyle = { flex: '1 1 auto', minHeight: '120px', overflow: 'auto', background: T.layer2, borderTop: '1px solid ' + T.border, borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }
    const imgStyle = { display: 'block', width: '100%', height: 'auto', cursor: 'crosshair', userSelect: 'none' }
    const emptyStyle = { margin: 'auto', padding: '18px', color: T.muted, textAlign: 'center', maxWidth: '320px', lineHeight: 1.5 }

    function LiveIcon({ className }) {
      return h('svg', { className, width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 2.5, y: 4, width: 17, height: 12, rx: 2.2 }),
        h('path', { d: 'M7.5 19h7', strokeLinecap: 'round' }),
        h('path', { d: 'M9.2 7.5v5l4.6-2.5z', fill: 'currentColor', stroke: 'none' }))
    }

    // ------------------------------------------------------------ the tab body
    function createBody(t, getService) {
      return function LiveBrowserBody(props) {
        const useTabInfo = props.useTabInfo
        const info = useTabInfo ? useTabInfo() : null
        const tab = (info && info.tab) || {}
        const visible = tab.visible !== false
        const mounted = useSyncExternalStore(subscribeMount, getMountReady, getMountReady)
        const mountError = useSyncExternalStore(subscribeMount, getMountError, getMountError)

        const [status, setStatus] = useState(null)
        const [tabs, setTabs] = useState([])
        const [activeTabId, setActiveTabId] = useState(null)
        // null = follow whatever tab is active in the browser; a number = pinned to that tab.
        const [pinnedId, setPinnedId] = useState(null)
        const [frame, setFrame] = useState(null)
        const [viewport, setViewport] = useState(null)
        const [error, setError] = useState(null)
        const [auto, setAuto] = useState(true)
        const [busy, setBusy] = useState(false)
        const [address, setAddress] = useState('')
        const [text, setText] = useState('')
        const imgRef = useRef(null)
        const editingAddress = useRef(false)
        const wheelAcc = useRef({ x: 0, y: 0, timer: null })

        const targetId = pinnedId === null ? activeTabId : pinnedId
        const connected = !!(status && status.listening && status.extensionConnected)
        const readOnly = !!(status && status.readOnly)
        // Read-only gates the agent's tools only: the user's own actions in this panel stay live.
        const canAct = mounted && connected

        const call = useCallback(async (method, ...args) => {
          const service = getService()
          const res = await withTimeout(service[method](...args), CALL_TIMEOUT_MS, method)
          if (res && typeof res === 'object' && res.ok === true) return res.value
          throw new Error(resError(res, method + ' failed'))
        }, [getService])

        // One frame: screenshot + the viewport size that maps picture pixels to page pixels.
        const grabFrame = useCallback(async (id) => {
          const shot = await call('screenshot', id)
          const vp = await call('viewport', id)
          setFrame({ dataUrl: shot.dataUrl, title: shot.title, url: shot.url, at: Date.now() })
          setViewport(vp)
        }, [call])

        // ---- link status + tab list (periodic while the tab is visible)
        useEffect(() => {
          if (!mounted || !visible) return
          let stopped = false
          let timer = null
          const tick = async () => {
            try {
              const st = await call('status')
              if (stopped) return
              setStatus(st)
              if (st && st.listening && st.extensionConnected) {
                const list = await call('listTabs')
                if (stopped) return
                setTabs(Array.isArray(list && list.tabs) ? list.tabs : [])
                setActiveTabId(list && typeof list.activeTabId === 'number' ? list.activeTabId : null)
              }
            } catch (error) {
              if (!stopped) setError(errorText(error))
            }
            if (!stopped) timer = setTimeout(() => { void tick() }, LIST_INTERVAL_MS)
          }
          void tick()
          return () => { stopped = true; if (timer) clearTimeout(timer) }
        }, [mounted, visible, call])

        // ---- frames (auto refresh while visible)
        useEffect(() => {
          if (!mounted || !visible || !auto || !connected) return
          let stopped = false
          let timer = null
          let inFlight = false
          const schedule = () => { if (!stopped) timer = setTimeout(() => { void tick() }, FRAME_INTERVAL_MS) }
          const tick = async () => {
            if (inFlight) return schedule()
            inFlight = true
            try {
              await grabFrame(targetId)
              if (!stopped) setError(null)
            } catch (error) {
              if (!stopped) setError(errorText(error))
            } finally {
              inFlight = false
            }
            schedule()
          }
          void tick()
          return () => { stopped = true; if (timer) clearTimeout(timer) }
        }, [mounted, visible, auto, connected, targetId, grabFrame])

        // ---- the pane's own refresh command refreshes the picture
        const actions = tab.actions
        useEffect(() => {
          if (!actions || typeof actions.bindCommands !== 'function' || !mounted) return
          return actions.bindCommands({ refresh: () => { if (connected) void grabFrame(targetId).catch((error) => setError(errorText(error))) } })
        }, [actions, mounted, connected, targetId, grabFrame])

        // ---- keep the address bar in step with the page unless the user is typing in it
        const frameUrl = frame ? frame.url : null
        useEffect(() => {
          if (!editingAddress.current && frameUrl) setAddress(frameUrl)
        }, [frameUrl])

        const run = useCallback(async (work) => {
          setBusy(true)
          try {
            await work()
            setError(null)
          } catch (error) {
            setError(errorText(error))
          } finally {
            setBusy(false)
          }
        }, [])

        const go = (raw) => run(async () => {
          const url = normalizeAddress(raw)
          if (url === '') return
          editingAddress.current = false
          const result = await call('navigate', url, targetId)
          if (result && result.unreachable) throw new Error(t('nav.unreachable'))
          await new Promise((resolve) => setTimeout(resolve, 400))
          await grabFrame(targetId)
        })
        const openNew = (raw) => run(async () => {
          const url = normalizeAddress(raw)
          if (url === '') return
          const result = await call('openTab', url)
          if (result && typeof result.tabId === 'number') setPinnedId(result.tabId)
          await new Promise((resolve) => setTimeout(resolve, 400))
          await grabFrame(typeof (result && result.tabId) === 'number' ? result.tabId : targetId)
        })
        const pickTab = (id) => run(async () => {
          if (id === null) { setPinnedId(null); return }
          await call('activateTab', id)
          setPinnedId(id)
          await new Promise((resolve) => setTimeout(resolve, 250))
          await grabFrame(id)
        })
        const history = (direction) => run(async () => {
          await call('history', targetId, direction)
          await new Promise((resolve) => setTimeout(resolve, 400))
          await grabFrame(targetId)
        })
        const reloadPage = () => run(async () => {
          await call('reload', targetId)
          await new Promise((resolve) => setTimeout(resolve, 800))
          await grabFrame(targetId)
        })
        const refreshView = () => run(() => grabFrame(targetId))

        const onImageClick = (event) => {
          if (!canAct) return
          const img = imgRef.current
          if (!img || !viewport || !viewport.width || !viewport.height) return
          const rect = img.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return
          const x = Math.round(((event.clientX - rect.left) / rect.width) * viewport.width)
          const y = Math.round(((event.clientY - rect.top) / rect.height) * viewport.height)
          void run(async () => {
            await call('click', targetId, x, y)
            await new Promise((resolve) => setTimeout(resolve, 350))
            await grabFrame(targetId)
          })
        }
        const onWheel = (event) => {
          if (!canAct) return
          const acc = wheelAcc.current
          acc.x += event.deltaX
          acc.y += event.deltaY
          if (acc.timer) return
          acc.timer = setTimeout(() => {
            acc.timer = null
            const x = Math.round(acc.x)
            const y = Math.round(acc.y)
            acc.x = 0
            acc.y = 0
            void run(async () => {
              await call('scroll', targetId, x, y)
              await new Promise((resolve) => setTimeout(resolve, 300))
              await grabFrame(targetId)
            })
          }, 120)
        }
        const sendText = (withEnter) => run(async () => {
          if (text === '') return
          await call('typeText', targetId, text)
          if (withEnter) await call('press', targetId, 'Enter')
          setText('')
          await new Promise((resolve) => setTimeout(resolve, 350))
          await grabFrame(targetId)
        })
        const pressKey = (key) => run(async () => {
          await call('press', targetId, key)
          await new Promise((resolve) => setTimeout(resolve, 350))
          await grabFrame(targetId)
        })

        // ---- status line
        let statusLine = null
        let statusColor = T.muted
        if (mountError) { statusLine = t('remote.mount.failed') + mountError; statusColor = T.error }
        else if (!mounted || !status) { statusLine = t('loading') }
        else if (!status.listening) { statusLine = t('status.disabled'); statusColor = T.error }
        else if (!status.extensionConnected) { statusLine = t('status.offline'); statusColor = T.warn }
        else if (frame) {
          const when = new Date(frame.at).toLocaleTimeString()
          statusLine = truncate((frame.title || '') + ' — ' + (frame.url || ''), 120) + ' · ' + t('updated') + ' ' + when
        }

        const button = (label, onClick, opts) => {
          const o = opts || {}
          return h('button', { type: 'button', style: buttonStyle(o.disabled === true), onClick, disabled: o.disabled === true, title: o.title }, label)
        }
        const disabledControl = !canAct || busy

        return h('div', { style: panelStyle, 'data-browser-live': 'panel' },
          h('div', { style: rowStyle },
            h('select', {
              style: Object.assign({}, controlBase, { maxWidth: '40%', padding: '0 4px', cursor: connected ? 'pointer' : 'default', color: T.text }),
              value: pinnedId === null ? '' : String(pinnedId),
              onChange: (event) => { const v = event.target.value; void pickTab(v === '' ? null : Number(v)) },
              disabled: !connected,
              title: t('tab.select'),
            },
              h('option', { value: '' }, t('follow.active')),
              tabs.map((item) => h('option', { key: item.id, value: String(item.id) }, '#' + item.id + ' ' + truncate(item.title || item.url || '', 40)))),
            h('input', {
              style: inputStyle,
              value: address,
              placeholder: t('address.placeholder'),
              spellCheck: false,
              onChange: (event) => setAddress(event.target.value),
              onFocus: () => { editingAddress.current = true },
              onBlur: () => { editingAddress.current = false },
              onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void go(address) } },
              disabled: !connected,
            }),
            button(t('go'), () => { void go(address) }, { disabled: disabledControl }),
            button(t('new.tab'), () => { void openNew(address) }, { disabled: disabledControl, title: t('new.tab.hint') })),
          h('div', { style: rowStyle },
            button(t('back'), () => { void history('back') }, { disabled: disabledControl }),
            button(t('forward'), () => { void history('forward') }, { disabled: disabledControl }),
            button(t('reload.page'), () => { void reloadPage() }, { disabled: disabledControl }),
            button(t('refresh.view'), () => { void refreshView() }, { disabled: !connected || busy }),
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', color: T.muted, cursor: 'pointer', whiteSpace: 'nowrap' }, title: t('click.hint') },
              h('input', { type: 'checkbox', checked: auto, onChange: (event) => setAuto(event.target.checked), disabled: !connected }),
              t('auto')),
            button(t('open.external'), () => { if (frame && frame.url) window.open(frame.url, '_blank', 'noopener') }, { disabled: !(frame && frame.url) })),
          h('div', { style: Object.assign({}, statusStyle, { color: statusColor }), title: statusLine || '' }, statusLine),
          readOnly && connected
            ? h('div', { style: Object.assign({}, statusStyle, { color: T.warn }) }, t('status.readOnly'))
            : null,
          error
            ? h('div', { style: Object.assign({}, statusStyle, { color: T.error }), title: error }, truncate(error, 200))
            : null,
          h('div', { style: viewportStyle, onWheel: onWheel },
            frame
              ? h('img', { ref: imgRef, src: frame.dataUrl, style: imgStyle, onClick: onImageClick, draggable: false, alt: frame.title || 'page' })
              : h('div', { style: emptyStyle }, connected ? t('empty') : t('empty.offline'))),
          h('div', { style: rowStyle },
            h('input', {
              style: inputStyle,
              value: text,
              placeholder: t('type.placeholder'),
              spellCheck: false,
              onChange: (event) => setText(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendText(true) }
                else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); void sendText(false) }
              },
              disabled: !canAct,
            }),
            button(t('send'), () => { void sendText(true) }, { disabled: disabledControl || text === '' }),
            button('Esc', () => { void pressKey('Escape') }, { disabled: disabledControl }),
            button('⌫', () => { void pressKey('Backspace') }, { disabled: disabledControl, title: 'Backspace' }),
            button('Tab →', () => { void pressKey('Tab') }, { disabled: disabledControl })))
      }
    }

    return {
      inject: ['slots', 'locale', 'remote', 'sidebarRight', 'sidebarRightTabs'],
      // Offline checks (node verify/verify_live_panel.mjs): the descriptor must stay in
      // lockstep with the host contribution's methods and parameter order.
      __test: { CLIENT_TYPERT_REMOTE, normalizeAddress },
      apply(ctx) {
        const t = ctx.locale.bind(LOCALE_NS)
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-browser-control: copy')

        const getService = () => {
          const service = ctx.get('remote.' + NAMESPACE)
          if (!service) throw new Error(t('remote.missing'))
          return service
        }
        ctx.effect(async () => {
          try {
            const disposer = await ctx.remote.$mount(CLIENT_TYPERT_REMOTE)
            setMount({ ready: true, error: null })
            return disposer
          } catch (error) {
            setMount({ ready: false, error: errorText(error) })
            throw error
          }
        }, 'dsh-browser-control: typert mount')

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_TYPE_ID,
          kind: TAB_KIND,
          priority: 'extension',
          keepMounted: true,
          title: () => t('type.label'),
          guide: [{
            id: 'live',
            order: 35,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: LiveIcon,
          }],
        }), 'dsh-browser-control: tab type')

        const Body = createBody(t, getService)
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_TYPE_ID,
          locale: LOCALE_NS,
        }, Body)), 'dsh-browser-control: tab body')
      },
    }
  },
})
