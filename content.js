;(function () {
  'use strict'
  if (window.__mtpContentLoaded) return
  window.__mtpContentLoaded = true

  const ROOT_ID = 'mtp-root'
  const STYLE_ID = 'mtp-style'
  const LAYOUT_ID = 'mtp-layout'
  const TOAST_MS = 2200
  const LOG_MAX = 300
  const VERSION = '1.4.9'

  let cfgCache = {
    enabled: true,
    showLog: true,
    verboseLog: true,
  }
  let lastCapture = emptyCapture()
  let logPanelEl = null
  let bridgeReady = false
  let lastForceMode = null
  let viewMode = 'split' // split | mini
  let sideWidth = Math.round(Math.min(640, Math.max(420, window.innerWidth * 0.48)))
  let miniBox = { w: 480, h: 360, x: null, y: null }
  let lastImportedLines = []
  let lastImportTag = ''
  const logBuf = []
  const pendingGgb = new Map()

  function emptyCapture() {
    return {
      kind: 'empty',
      latexLines: [],
      text: '',
      imageUrl: '',
      imageAlt: '',
      pageUrl: location.href,
      pageTitle: document.title || '',
    }
  }

  function pad2(n) {
    return String(n).padStart(2, '0')
  }
  function nowStamp() {
    const d = new Date()
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }

  function log(level, msg, extra) {
    if (!cfgCache.verboseLog && level === 'debug') return
    const entry = {
      t: nowStamp(),
      level: level || 'info',
      msg: String(msg || ''),
      extra: extra == null ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra),
    }
    logBuf.push(entry)
    if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX)
    const line = `[mtp ${entry.t}] ${entry.level}: ${entry.msg}` + (entry.extra ? ' ' + entry.extra : '')
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    refreshLogPanel()
  }

  function logsAsText() {
    return logBuf.map((e) => `${e.t} [${e.level}] ${e.msg}${e.extra ? ' | ' + e.extra : ''}`).join('\n')
  }

  function runtimeSend(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message })
            return
          }
          resolve(res || { ok: false, error: 'empty' })
        })
      } catch (err) {
        resolve({ ok: false, error: err.message || String(err) })
      }
    })
  }

  async function refreshCfg() {
    const res = await runtimeSend({ type: 'MTP_GET_CFG' })
    if (res.ok && res.cfg) cfgCache = res.cfg
    return cfgCache
  }

  function unwrapLatex(s) {
    if (!s) return ''
    let t = String(s).trim()
    t = t.replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    t = t.replace(/^\$([\s\S]*)\$$/, '$1')
    t = t.replace(/^\\\(([\s\S]*)\\\)$/, '$1')
    t = t.replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    return t.trim()
  }

  function splitLatexLines(raw) {
    const t = unwrapLatex(raw)
    if (!t) return []
    return t
      .split(/\n+|\\\\|\\cr\b/)
      .map((x) => x.replace(/&\s*/g, '').trim())
      .filter(Boolean)
  }

  function readAnnotation(el) {
    if (!el) return ''
    const ann =
      el.querySelector('annotation[encoding="application/x-tex"]') ||
      el.querySelector('annotation[encoding="TeX"]') ||
      el.querySelector('annotation')
    return ann ? unwrapLatex(ann.textContent || '') : ''
  }

  function latexFromNode(node) {
    if (!node || node.nodeType !== 1) return ''
    const el = node.closest?.(
      '.katex,.katex-display,.MathJax,.MathJax_Display,.MathJax_SVG,.mjx-chtml,.MathJax_CHTML,math,[data-latex],[data-formula],.math,.formula'
    )
    if (!el) return ''
    if (el.getAttribute('data-latex')) return unwrapLatex(el.getAttribute('data-latex'))
    if (el.getAttribute('data-formula')) return unwrapLatex(el.getAttribute('data-formula'))
    const fromAnn = readAnnotation(el)
    if (fromAnn) return fromAnn
    const script = el.querySelector('script[type^="math/tex"]')
    if (script?.textContent) return unwrapLatex(script.textContent)
    const a = el.getAttribute('aria-label')
    if (a && (/[\\^_{}=]/.test(a) || /frac|sqrt|sum|int/.test(a))) return unwrapLatex(a)
    return ''
  }

  function latexInRange(range) {
    if (!range) return ''
    const root = range.commonAncestorContainer
    const host = root.nodeType === 1 ? root : root.parentElement
    if (!host) return ''
    const direct = latexFromNode(host)
    if (direct) return direct
    const formulas = host.querySelectorAll?.(
      '.katex,.katex-display,.MathJax,math,[data-latex],[data-formula]'
    )
    if (!formulas?.length) return ''
    const parts = []
    formulas.forEach((f) => {
      try {
        if (range.intersectsNode(f)) {
          const L = latexFromNode(f)
          if (L) parts.push(L)
        }
      } catch (_) {}
    })
    return parts.join('\n')
  }

  function imageFromTarget(target) {
    if (!target || target.nodeType !== 1) return null
    const img = target.closest?.('img, picture')
    if (!img) return null
    if (img.tagName === 'IMG') return { url: img.currentSrc || img.src || '', alt: img.alt || '' }
    const i = img.querySelector?.('img')
    return i ? { url: i.currentSrc || i.src || '', alt: i.alt || '' } : null
  }

  function looksLikeMath(text) {
    if (!text) return false
    const t = text.trim()
    if (t.length < 1 || t.length > 4000) return false
    return /(\$\$|\$|\\\[|\\\(|\\frac|\\sqrt|\\sum|\\int|\\lim|[=≈≠≤≥]|[\^_]\{|[∫∑∏√∞πθαβγΔ]|y\s*=|f\s*\(|g\s*\()/.test(
      t
    )
  }

  function captureFromSelection(extraTarget) {
    const cap = emptyCapture()
    const sel = window.getSelection()
    const text = (sel && String(sel.toString())) || ''
    let latex = ''
    if (sel && !sel.isCollapsed && sel.rangeCount) latex = latexInRange(sel.getRangeAt(0))
    if (!latex && extraTarget) latex = latexFromNode(extraTarget)
    const img =
      imageFromTarget(extraTarget) ||
      (sel?.anchorNode ? imageFromTarget(sel.anchorNode.parentElement) : null)

    if (latex) {
      cap.kind = 'latex'
      cap.latexLines = splitLatexLines(latex)
      cap.text = latex
      return cap
    }
    if (img?.url && (!text || text.length < 3)) {
      cap.kind = 'image'
      cap.imageUrl = img.url
      cap.imageAlt = img.alt || ''
      cap.text = img.alt || ''
      return cap
    }
    if (text.trim()) {
      const maybe = unwrapLatex(text)
      if (looksLikeMath(maybe) || /\\[a-zA-Z]+/.test(maybe) || /=/.test(maybe)) {
        cap.kind = 'latex'
        cap.latexLines = splitLatexLines(maybe)
        cap.text = maybe
      } else {
        cap.kind = 'text'
        cap.text = text.trim()
        cap.latexLines = looksLikeMath(text) ? splitLatexLines(text) : [text.trim()]
      }
      return cap
    }
    return cap
  }

  function applyExternalCapture(selectionText, srcUrl) {
    if (selectionText && selectionText.trim()) {
      lastCapture = emptyCapture()
      const maybe = unwrapLatex(selectionText)
      lastCapture.kind = 'latex'
      lastCapture.latexLines = splitLatexLines(maybe)
      lastCapture.text = maybe
      if (!lastCapture.latexLines.length) lastCapture.latexLines = [selectionText.trim()]
      return
    }
    if (srcUrl) {
      lastCapture = emptyCapture()
      lastCapture.kind = 'image'
      lastCapture.imageUrl = srcUrl
      return
    }
    lastCapture = captureFromSelection()
  }

  function ensureStyle() {
    let s = document.getElementById(STYLE_ID)
    if (!s) {
      s = document.createElement('style')
      s.id = STYLE_ID
      document.documentElement.appendChild(s)
    }
    // 左侧固定面板 + body 让出左边距；不搬动原页 DOM
    s.textContent = `
html.mtp-split-on:not(.mtp-mode-mini) body {
  margin-left: calc(var(--mtp-side-w, 42vw) + 5px) !important;
  box-sizing: border-box !important;
}
#${LAYOUT_ID}{
  position:fixed; left:0; top:0; bottom:0; z-index:2147483000;
  width: calc(var(--mtp-side-w, 42vw) + 5px);
  display:flex; pointer-events:none;
}
#${LAYOUT_ID} > * { pointer-events:auto; }
#mtp-side{
  flex:0 0 var(--mtp-side-w, 42vw); width:var(--mtp-side-w, 42vw);
  min-width:280px; max-width:78vw; height:100%;
  display:flex; flex-direction:column; background:#fff;
  border-right:1px solid #d8dde6; box-shadow:2px 0 12px rgba(0,0,0,.06);
}
#mtp-splitter{
  width:5px; flex:0 0 5px; height:100%; cursor:col-resize; background:#e4e8ef;
}
#mtp-splitter:hover, #mtp-splitter.dragging{ background:#9aa7bd; }
html.mtp-mode-mini #${LAYOUT_ID}{
  width:0; height:0; overflow:visible; left:0; top:0; bottom:auto;
}
html.mtp-mode-mini #mtp-side{
  position:fixed; z-index:2147483645;
  left:var(--mtp-mini-x, auto); top:var(--mtp-mini-y, auto);
  right:var(--mtp-mini-right, 16px); bottom:var(--mtp-mini-bottom, 16px);
  width:var(--mtp-mini-w, 420px)!important; height:var(--mtp-mini-h, 300px)!important;
  min-width:260px; max-width:none; flex:none;
  border:1px solid #2a3140; border-radius:10px; overflow:hidden;
  box-shadow:0 16px 48px rgba(0,0,0,.38);
}
html.mtp-mode-mini #mtp-splitter{ display:none; }
html.mtp-mode-mini body { margin-left: 0 !important; }
#mtp-bar{
  display:flex; align-items:center; gap:6px; height:36px; padding:0 4px 0 12px;
  background:#1f2430; color:#fff; flex-shrink:0; user-select:none;
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  cursor:default;
}
html.mtp-mode-mini #mtp-bar{ cursor:move; }
#mtp-bar .mtp-title{ font-size:13px; font-weight:600; white-space:nowrap; }
#mtp-bar #mtp-status{
  font-size:12px; opacity:.78; margin-right:auto; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 8px;
}
#mtp-bar .mtp-tools{ display:flex; gap:4px; align-items:center; }
#mtp-bar .mtp-tools button{
  appearance:none; border:0; border-radius:4px; padding:4px 8px; font-size:11px;
  cursor:pointer; background:rgba(255,255,255,.12); color:#fff; font-family:inherit;
}
#mtp-bar .mtp-tools button:hover{ background:rgba(255,255,255,.22); }
#mtp-winbtns{ display:flex; margin-left:2px; }
#mtp-winbtns button{
  width:40px; height:32px; border:0; background:transparent; color:#fff;
  cursor:pointer; font-size:12px; line-height:1; border-radius:0; font-family:inherit;
}
#mtp-winbtns button:hover{ background:rgba(255,255,255,.12); }
#mtp-winbtns button[data-act="close"]:hover{ background:#e81123; }
#mtp-stage{ flex:1; position:relative; background:#fff; min-height:0; overflow:hidden; }
/* 只定挂载盒尺寸；禁止把内部 canvas/iframe 强行 width/height:100%（会拉伸发糊、裁切） */
#mtp-ggb-mount{
  position:absolute; inset:0; width:100%; height:100%;
  background:#fff; overflow:hidden;
}
#mtp-ggb-mount canvas, #mtp-ggb-mount iframe {
  image-rendering: auto;
}
#mtp-ggb-frame{
  position:absolute; inset:0; width:100%; height:100%;
  border:0; display:block; background:#fff;
}
#mtp-resize{
  position:absolute; right:0; bottom:0; width:16px; height:16px; cursor:nwse-resize; z-index:5;
  background:linear-gradient(135deg, transparent 50%, #8a93a3 50%);
  display:none;
}
html.mtp-mode-mini #mtp-resize{ display:block; }
#${ROOT_ID}, #${ROOT_ID} *{ box-sizing:border-box; }
#mtp-toast{
  position:fixed; z-index:2147483647; left:50%; bottom:40px; transform:translateX(-50%);
  background:rgba(20,24,32,.94); color:#fff; padding:10px 14px; border-radius:10px;
  font-size:13px; display:none; max-width:min(520px,90vw);
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
#mtp-log-panel{
  position:fixed; z-index:2147483647; right:16px; bottom:16px;
  width:min(520px,calc(100vw - 32px)); height:min(360px,45vh);
  display:none; flex-direction:column; background:rgba(12,14,18,.96); color:#d7e0ea;
  border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.4); border:1px solid #2a3140; overflow:hidden;
  font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
#mtp-log-panel .mtp-log-head{
  display:flex; align-items:center; gap:8px; padding:8px 10px; background:#1a1f27;
  border-bottom:1px solid #2a3140; flex-wrap:wrap;
}
#mtp-log-panel .mtp-log-sub{ font-size:11px; opacity:.65; margin-right:auto; }
#mtp-log-panel .mtp-log-head button{
  appearance:none; border:0; border-radius:6px; padding:4px 8px; font-size:12px;
  cursor:pointer; background:#2b3444; color:#e8eef5;
}
#mtp-log-panel #mtp-log-body{
  margin:0; padding:10px; flex:1; overflow:auto; white-space:pre-wrap; word-break:break-word;
  font-family:Consolas,"Courier New",monospace; font-size:11px; line-height:1.45;
}
`
  }

  function ensureRoot() {
    ensureStyle()
    let root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      document.documentElement.appendChild(root)
    }
    return root
  }

  function toast(msg) {
    const root = ensureRoot()
    let el = document.getElementById('mtp-toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'mtp-toast'
      root.appendChild(el)
    }
    el.textContent = msg
    el.style.display = 'block'
    clearTimeout(el._t)
    el._t = setTimeout(() => {
      el.style.display = 'none'
    }, TOAST_MS)
  }

  function setStatus(text, level) {
    const el = document.getElementById('mtp-status')
    if (el) el.textContent = text || ''
    if (text) log(level || 'info', text)
  }

  function refreshLogPanel() {
    if (!logPanelEl || logPanelEl.style.display === 'none') return
    const pre = logPanelEl.querySelector('#mtp-log-body')
    if (!pre) return
    pre.textContent = logsAsText() || '（暂无日志）'
    pre.scrollTop = pre.scrollHeight
  }

  function showLogPanel() {
    const root = ensureRoot()
    if (!logPanelEl) {
      logPanelEl = document.createElement('div')
      logPanelEl.id = 'mtp-log-panel'
      logPanelEl.innerHTML = `
        <div class="mtp-log-head">
          <strong>脚本日志</strong>
          <span class="mtp-log-sub">纯扩展</span>
          <button type="button" data-act="copy">复制</button>
          <button type="button" data-act="clear">清空</button>
          <button type="button" data-act="close">关闭</button>
        </div>
        <pre id="mtp-log-body"></pre>`
      logPanelEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]')
        if (!btn) return
        const act = btn.getAttribute('data-act')
        if (act === 'close') logPanelEl.style.display = 'none'
        else if (act === 'clear') {
          logBuf.length = 0
          refreshLogPanel()
        } else if (act === 'copy') {
          try {
            await navigator.clipboard.writeText(logsAsText() || '')
            toast('日志已复制')
          } catch (_) {
            toast('复制失败')
          }
        }
      })
      root.appendChild(logPanelEl)
    }
    logPanelEl.style.display = 'flex'
    refreshLogPanel()
  }

  function clearPageSelection() {
    try {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) sel.removeAllRanges()
    } catch (_) {}
  }

  function postToGgbFrame(payload) {
    const iframe = document.getElementById('mtp-ggb-frame')
    if (!iframe || !iframe.contentWindow) return false
    try {
      iframe.contentWindow.postMessage({ source: 'mtp-ext-content', ...payload }, '*')
      return true
    } catch (_) {
      return false
    }
  }

  function notifyResize() {
    window.postMessage({ source: 'mtp-ext-content', type: 'MTP_GGB_RESIZE' }, '*')
    postToGgbFrame({ type: 'MTP_GGB_RESIZE' })
    setTimeout(() => {
      window.postMessage({ source: 'mtp-ext-content', type: 'MTP_GGB_RESIZE' }, '*')
      postToGgbFrame({ type: 'MTP_GGB_RESIZE' })
    }, 120)
  }

  function applySideWidth() {
    const w = Math.max(280, Math.min(sideWidth, Math.floor(window.innerWidth * 0.78)))
    sideWidth = w
    document.documentElement.style.setProperty('--mtp-side-w', w + 'px')
    const layout = document.getElementById(LAYOUT_ID)
    if (layout) layout.style.width = `calc(${w}px + 5px)`
  }

  function applyMiniBox() {
    const root = document.documentElement
    const vw = window.innerWidth
    const vh = window.innerHeight
    let w = Math.max(260, Math.min(miniBox.w || 420, vw - 24))
    let h = Math.max(180, Math.min(miniBox.h || 300, vh - 24))
    miniBox.w = w
    miniBox.h = h
    root.style.setProperty('--mtp-mini-w', w + 'px')
    root.style.setProperty('--mtp-mini-h', h + 'px')
    if (miniBox.x == null || miniBox.y == null) {
      root.style.setProperty('--mtp-mini-x', 'auto')
      root.style.setProperty('--mtp-mini-y', 'auto')
      root.style.setProperty('--mtp-mini-right', '16px')
      root.style.setProperty('--mtp-mini-bottom', '16px')
      return
    }
    const x = Math.max(0, Math.min(miniBox.x, vw - 80))
    const y = Math.max(0, Math.min(miniBox.y, vh - 48))
    miniBox.x = x
    miniBox.y = y
    root.style.setProperty('--mtp-mini-x', x + 'px')
    root.style.setProperty('--mtp-mini-y', y + 'px')
    root.style.setProperty('--mtp-mini-right', 'auto')
    root.style.setProperty('--mtp-mini-bottom', 'auto')
  }

  function setViewMode(mode) {
    const layout = document.getElementById(LAYOUT_ID)
    if (!layout) return
    viewMode = mode === 'mini' ? 'mini' : 'split'
    document.documentElement.classList.toggle('mtp-mode-mini', viewMode === 'mini')
    const miniBtn = layout.querySelector('[data-act="mini"]')
    const splitBtn = layout.querySelector('[data-act="split"]')
    if (miniBtn) miniBtn.style.display = viewMode === 'mini' ? 'none' : ''
    if (splitBtn) splitBtn.style.display = viewMode === 'mini' ? '' : 'none'
    if (viewMode === 'split') applySideWidth()
    else applyMiniBox()
    notifyResize()
  }

  function closePanel() {
    window.postMessage({ source: 'mtp-ext-content', type: 'MTP_GGB_DESTROY' }, '*')
    postToGgbFrame({ type: 'MTP_GGB_DESTROY' })
    bridgeReady = false
    const layout = document.getElementById(LAYOUT_ID)
    if (layout) layout.remove()
    document.documentElement.classList.remove('mtp-split-on', 'mtp-mode-mini')
    document.documentElement.style.removeProperty('--mtp-side-w')
    viewMode = 'split'
    if (logPanelEl) logPanelEl.style.display = 'none'
  }

  function autoCloseEmpty(reason) {
    toast(reason || '没有可画对象，已关闭')
    setTimeout(() => closePanel(), 450)
  }

  function wireSplitter(splitter) {
    if (!splitter || splitter.__mtpWired) return
    splitter.__mtpWired = true
    splitter.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || viewMode !== 'split') return
      e.preventDefault()
      splitter.classList.add('dragging')
      const onMove = (ev) => {
        sideWidth = ev.clientX
        applySideWidth()
      }
      const onUp = () => {
        splitter.classList.remove('dragging')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        notifyResize()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  function wireMiniInteract(side, bar) {
    if (!side || side.__mtpMiniWired) return
    side.__mtpMiniWired = true

    bar.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || viewMode !== 'mini') return
      if (e.target.closest('button')) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const rect = side.getBoundingClientRect()
      const origX = rect.left
      const origY = rect.top
      const onMove = (ev) => {
        miniBox.x = origX + (ev.clientX - startX)
        miniBox.y = origY + (ev.clientY - startY)
        applyMiniBox()
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })

    const handle = side.querySelector('#mtp-resize')
    if (handle) {
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || viewMode !== 'mini') return
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const startY = e.clientY
        const origW = miniBox.w || side.offsetWidth
        const origH = miniBox.h || side.offsetHeight
        const onMove = (ev) => {
          miniBox.w = origW + (ev.clientX - startX)
          miniBox.h = origH + (ev.clientY - startY)
          applyMiniBox()
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          notifyResize()
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })
    }
  }

  function openPanel(preferredMode) {
    ensureStyle()
    clearPageSelection()
    ensureRoot()

    let layout = document.getElementById(LAYOUT_ID)
    if (!layout) {
      layout = document.createElement('div')
      layout.id = LAYOUT_ID

      const side = document.createElement('div')
      side.id = 'mtp-side'
      side.innerHTML = `
        <div id="mtp-bar">
          <div class="mtp-title">GeoGebra</div>
          <div id="mtp-status"></div>
          <div class="mtp-tools">
            <button type="button" data-act="mini" title="收成迷你浮窗">浮窗</button>
            <button type="button" data-act="split" title="恢复左侧分栏" style="display:none">分栏</button>
            <button type="button" data-act="logs">日志</button>
            <button type="button" data-act="prompt">提示词</button>
          </div>
          <div id="mtp-winbtns">
            <button type="button" data-act="close" title="关闭">✕</button>
          </div>
        </div>
        <div id="mtp-stage"><div id="mtp-ggb-mount" class="mtp-ggb-mount"></div></div>
        <div id="mtp-resize" title="拖拽缩放"></div>`

      const splitter = document.createElement('div')
      splitter.id = 'mtp-splitter'
      splitter.title = '拖动调整宽度'

      // 不搬动原页节点：只挂左侧面板，右侧原网页原样保留
      layout.appendChild(side)
      layout.appendChild(splitter)
      document.body.appendChild(layout)

      layout.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]')
        if (!btn) return
        const act = btn.getAttribute('data-act')
        if (act === 'close') closePanel()
        else if (act === 'mini') setViewMode('mini')
        else if (act === 'split') setViewMode('split')
        else if (act === 'logs') showLogPanel()
        else if (act === 'prompt') copyPrompt()
      })

      wireSplitter(splitter)
      wireMiniInteract(side, side.querySelector('#mtp-bar'))
    } else {
      // 已打开则保留挂载点，复用 GeoGebra 实例（避免二次 inject 超时）
      let mount = document.getElementById('mtp-ggb-mount')
      if (!mount) {
        const stage = layout.querySelector('#mtp-stage')
        if (stage) stage.innerHTML = '<div id="mtp-ggb-mount" class="mtp-ggb-mount"></div>'
      }
    }

    document.documentElement.classList.add('mtp-split-on')
    applySideWidth()
    setViewMode(preferredMode === 'float' || preferredMode === 'mini' ? 'mini' : 'split')
    setStatus('')
    return document.getElementById('mtp-ggb-mount')
  }

  function buildPrompt() {
    const lines = [
      '转成 GeoGebra Graphing 命令，每行一条。可含函数/点/滑块/不等式。',
      '不等式用 <= >= < > ，如 x^2+y^2<=1 。不要 Limit/Solve/中文。',
      '极限题只输出函数；没有可画内容写 %none。',
      '',
      `页面：${lastCapture.pageTitle}`,
      '',
    ]
    if (lastCapture.kind === 'image') {
      lines.push('【图像】', `图片地址：${lastCapture.imageUrl}`)
    } else if (lastCapture.latexLines.length) {
      lines.push('【已提取公式】')
      lastCapture.latexLines.forEach((L, i) => lines.push(`${i + 1}. ${L}`))
    } else {
      lines.push('【选中文本】', lastCapture.text || '')
    }
    return lines.join('\n')
  }

  async function copyPrompt() {
    const prompt = buildPrompt()
    try {
      await navigator.clipboard.writeText(prompt)
      toast('已复制 AI 提示词')
    } catch (_) {
      toast('复制失败')
    }
  }

  function ensurePageBridge() {
    return new Promise((resolve) => {
      const wantSrc = chrome.runtime.getURL('page-bridge.js') + '?v=' + VERSION
      const existed = document.getElementById('mtp-page-bridge')
      if (existed && existed.getAttribute('data-ver') === VERSION && bridgeReady) {
        resolve(true)
        return
      }
      if (existed) existed.remove()
      bridgeReady = false
      const s = document.createElement('script')
      s.id = 'mtp-page-bridge'
      s.setAttribute('data-ver', VERSION)
      s.src = wantSrc
      s.onload = () => {
        const t0 = Date.now()
        const wait = () => {
          if (bridgeReady) resolve(true)
          else if (Date.now() - t0 > 8000) resolve(false)
          else setTimeout(wait, 50)
        }
        wait()
      }
      s.onerror = () => resolve(false)
      ;(document.documentElement || document.head).appendChild(s)
    })
  }

  function classifyCapture(lines) {
    const blob = [lastCapture.text || '', ...(lastCapture.latexLines || [])].join('\n')
    const arr = Array.isArray(lines) ? lines : []
    const joined = arr.join('\n')
    const hasZ = /\bz\s*[<>=]|z\s*>=|z\s*<=|[−\-]\s*h\s*[≤<]=?\s*z/i.test(blob + '\n' + joined)
    const hasSphere =
      /x\^2\+y\^2\+z\^2/i.test((blob + joined).replace(/\s+/g, '')) || /球面|半球/i.test(blob)
    const hasCyl =
      /柱面|圆柱/i.test(blob) ||
      (/x\^2\+y\^2=/i.test((blob + joined).replace(/\s+/g, '')) && hasZ)
    const hasSolid = /空间实体|实体|立体图形|双纽线|绕轴|拉伸|水平截面/i.test(blob)
    const hasHelix =
      /螺旋线|空间曲线|x\s*=\s*cos\s*t.*y\s*=\s*sin\s*t.*z\s*=\s*t/i.test(blob) ||
      arr.some((l) => /\bCurve\s*\([^,]+,[^,]+,[^,]+,/i.test(l))
    const planeLine =
      /对弧长|第一类曲线|线积分|圆周|上半圆|\bds\b/i.test(blob) &&
      !/柱面|球面|半球|锥面|实体|空间曲线|螺旋|曲面积分|∬|三维/i.test(blob) &&
      !hasZ &&
      !hasSphere
    if (planeLine) return { appName: 'graphing', kind: 'plane' }
    if (hasCyl) return { appName: '3d', kind: 'cylinder' }
    if (hasSphere) return { appName: '3d', kind: 'sphere' }
    if (/锥面/i.test(blob)) return { appName: '3d', kind: 'cone' }
    if (hasSolid) return { appName: '3d', kind: 'solid' }
    if (/曲面积分|∬|(?:^|[^a-zA-Z])dS(?:[^a-zA-Z]|$)/.test(blob) && (hasZ || hasSphere || hasCyl || /柱|球|锥|Σ/.test(blob))) {
      return { appName: '3d', kind: 'surface' }
    }
    if (hasHelix) return { appName: '3d', kind: 'helix' }
    if (hasZ || /三维|3\s*D/i.test(blob)) return { appName: '3d', kind: 'solid' }
    if (arr.some((l) => /^\s*[A-Za-z]\w*\s*=\s*\([^,]+,[^,]+,[^,]+\)/.test(l))) {
      return { appName: '3d', kind: 'helix' }
    }
    return { appName: 'graphing', kind: 'plane' }
  }

  function detectAppName(lines) {
    return classifyCapture(lines).appName
  }

  async function openGgbWindow(lines, appName) {
    const res = await runtimeSend({
      type: 'MTP_OPEN_GGB_WINDOW',
      lines: lines || [],
      appName: appName || 'graphing',
    })
    if (!res.ok) throw new Error(res.error || '独立窗口打开失败')
    return {
      ok: (lines || []).length,
      fail: 0,
      imported: lines || [],
      skipped: [],
      viaWindow: true,
      appName: appName || 'graphing',
    }
  }

  function runGgbEmbedded(lines, appName) {
    return new Promise(async (resolve) => {
      await ensurePageBridge()
      const requestId = 'r' + Date.now() + Math.random().toString(16).slice(2)
      pendingGgb.set(requestId, resolve)
      const mount = document.getElementById('mtp-ggb-mount')
      // 页面主世界嵌入；三维题传 appName:'3d'
      window.postMessage(
        {
          source: 'mtp-ext-content',
          type: 'MTP_RUN_GGB',
          requestId,
          lines,
          appName: appName || 'graphing',
          width: mount?.clientWidth || 560,
          height: mount?.clientHeight || 640,
        },
        '*'
      )
      setTimeout(() => {
        if (pendingGgb.has(requestId)) {
          pendingGgb.delete(requestId)
          resolve({ ok: 0, fail: -1, error: 'GeoGebra 响应超时' })
        }
      }, 60000)
    })
  }

  async function runGgbInPage(lines, preferAppName) {
    const appName = preferAppName === '3d' ? '3d' : detectAppName(lines)
    log(
      'info',
      appName === '3d' ? '三维模式：切换 GeoGebra 3D' : '优先页面内嵌 GeoGebra（Graphing）'
    )
    const result = await runGgbEmbedded(lines, appName)
    if (!result.error && (result.ok > 0 || (result.imported && result.imported.length))) {
      return result
    }
    const err = result.error || '内嵌未导入成功'
    log('warn', '内嵌失败，改用独立窗口', err)
    if (/deployggb|CSP|超时|脚本|cross-origin|document|GGBApplet|加载失败/i.test(err) || result.ok === 0) {
      try {
        return await openGgbWindow(lines, appName)
      } catch (e2) {
        throw new Error(err + '；窗口：' + (e2.message || e2))
      }
    }
    return result
  }

  function isVectorCalcCapture() {
    const blob = [lastCapture.text || '', ...(lastCapture.latexLines || []), lastCapture.pageTitle || ''].join(
      '\n'
    )
    return /线积分|面积分|曲面积分|曲线积分|第一类|第二类|格林|高斯|斯托克斯|散度|旋度|通量|环流|对弧长|对坐标|半圆|圆周|圆弧|空间曲线|螺旋线|柱面|球面|半球|锥面|实体|立体|双纽线|Green|Stokes|Divergence|flux|line\s*integral|surface\s*integral|∮|∫|\iint|∯|\bds\b|\bdx\b|\bdy\b|P\s*dx\s*\+\s*Q\s*dy/i.test(
      blob
    )
  }

  function buildAiUserText() {
    const vectorCalc = isVectorCalcCapture()
    const scene = classifyCapture([])
    const parts =
      scene.kind === 'helix'
        ? [
            '这是空间曲线题。输出 GeoGebra 3D 命令：',
            't=Slider(0,6.28,0.05)',
            'A=(cos(t),sin(t),t)',
            'Curve(cos(t),sin(t),t,t,0,6.28)',
            '禁止 Integral()/中文。',
          ]
        : scene.kind === 'cylinder'
          ? [
              '这是柱面曲面积分题。输出 GeoGebra 3D（禁止螺旋线）：',
              'r=Slider(1,3,0.1)',
              'h=Slider(0.5,4,0.1)',
              'x^2+y^2=r^2',
              'z=0',
              'z=h',
            ]
          : scene.kind === 'sphere'
            ? [
                '这是球面/半球题。输出 GeoGebra 3D（禁止螺旋线）：',
                'r=Slider(1,5,0.1)',
                'x^2+y^2+z^2=r^2',
                'z>=0',
              ]
            : scene.appName === '3d'
              ? [
                  '这是空间实体/曲面题。输出 GeoGebra 3D，含 z 范围；禁止螺旋线兜底。',
                  '双纽线柱体示例：',
                  'a=Slider(1,3,0.1)',
                  'h=Slider(0.5,3,0.1)',
                  '(x^2+y^2)^2<=2*a^2*(x^2-y^2)',
                  'z>=-h',
                  'z<=h',
                ]
              : vectorCalc
                ? [
                    '这是线积分/面积分题。必须画出路径，禁止只输出一个 Slider。',
                    '上半圆 x^2+y^2=a^2 (y>=0) 请输出：',
                    'a=Slider(1,5,0.1)',
                    't=Slider(0,pi,0.05)',
                    'A=(a*cos(t),a*sin(t))',
                    'S=(-a,0)',
                    'E=(a,0)',
                    'x^2+y^2=a^2',
                    '对弧长∫f ds 不必画向量场；对坐标再加 Vector 样本。',
                    '禁止 Integral()/数值答案/&&/链式不等式。',
                  ]
                : [
                    '输出 GeoGebra Graphing 可画命令：函数/点/滑块/不等式（如 x^2+y^2<=1）。',
                    '保留不等式；不要 Limit/结论等式；极限题只输出函数。',
                  ]
    parts.push(`页面：${lastCapture.pageTitle}`)
    if (lastCapture.latexLines.length) {
      parts.push('【内容】')
      lastCapture.latexLines.forEach((L, i) => parts.push(`${i + 1}. ${L}`))
    } else if (lastCapture.text) {
      parts.push('【内容】', lastCapture.text)
    }
    if (lastCapture.kind === 'image') {
      parts.push(
        scene.appName === '3d'
          ? '【图像】识别三维对象并输出 3D 命令（曲面/实体/空间曲线）'
          : vectorCalc
            ? '【图像】识别线/面积分并输出演示命令'
            : '【图像】识别后只输出可画命令'
      )
    }
    return parts.join('\n')
  }

  async function resolveLines() {
    await refreshCfg()
    const raw = lastCapture.latexLines.length
      ? lastCapture.latexLines.slice()
      : lastCapture.text
        ? [lastCapture.text]
        : []
    if (!cfgCache.enabled) return { lines: raw, via: 'raw' }
    const res = await runtimeSend({
      type: 'MTP_AI_CONVERT',
      userText: buildAiUserText(),
      imageUrl: lastCapture.kind === 'image' ? lastCapture.imageUrl : '',
    })
    if (res.ok) {
      const kindTag = res.sceneKind && res.sceneKind !== 'plane' ? `·${res.sceneKind}` : ''
      const modeTag =
        res.mode === '3d' ? '·三维' + kindTag : res.mode === 'vector-calc' ? '·线面积分演示' : ''
      log('info', `已提取（${res.model}${modeTag}）`, res.lines.slice(0, 10))
      return {
        lines: res.lines,
        via: 'ai',
        model: res.model,
        mode: res.mode || 'default',
        appName: res.appName || (res.mode === '3d' ? '3d' : 'graphing'),
        sceneKind: res.sceneKind || classifyCapture(res.lines).kind,
      }
    }
    log('warn', 'AI 失败', res.error)
    if (raw.length) {
      toast('AI 失败，改用原文：' + (res.error || ''))
      return { lines: raw, via: 'raw', error: res.error }
    }
    throw new Error(res.error || 'AI 转换失败')
  }

  async function openTool(forceMode) {
    if (lastCapture.kind === 'empty') {
      toast('先选中公式 / 图像')
      return
    }
    await refreshCfg()
    const mode = forceMode || lastForceMode || cfgCache.windowMode || 'embed'
    lastForceMode = null

    if (cfgCache.showLog) showLogPanel()
    openPanel(mode)
    setStatus('提取中…')

    try {
      const resolved = await resolveLines()
      if (!resolved.lines.length) {
        autoCloseEmpty('没有可画对象，已关闭')
        return
      }
      const tag = resolved.via === 'ai' ? `AI(${resolved.model})` : '原文'
      lastImportedLines = resolved.lines.slice()
      lastImportTag = tag
      const scene = classifyCapture(resolved.lines)
      const appName =
        resolved.appName === '3d' || scene.appName === '3d' ? '3d' : 'graphing'
      if (appName === '3d') {
        log(
          'info',
          `三维模式（${resolved.sceneKind || scene.kind}）：将用 GeoGebra 3D`
        )
      } else if (resolved.mode === 'vector-calc' || isVectorCalcCapture()) {
        log('info', '线面积分演示模式：路径 / 定向 / 场或投影')
      }

      setStatus('正在加载 GeoGebra…', 'debug')
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      notifyResize()
      const result = await runGgbInPage(resolved.lines, appName === '3d' ? '3d' : undefined)
      if (result.error) throw new Error(result.error)
      const n = result.ok || (result.imported && result.imported.length) || 0
      if (n <= 0) {
        if (result.skipped?.length) log('debug', '跳过', result.skipped.slice(0, 6))
        autoCloseEmpty('未能画入 GeoGebra，已关闭')
        return
      }
      if (result.viaWindow) {
        setStatus(`已在独立窗口导入 ${n} 条`)
        log('info', '独立窗口导入完成', n)
        return
      }
      const preview = (result.imported || resolved.lines).slice(0, 3).join('；')
      setStatus(`已导入 ${n} 条：${preview}${n > 3 ? '…' : ''}`)
      if (result.skipped?.length) log('debug', `静默跳过 ${result.skipped.length} 条`, result.skipped.slice(0, 4))
      if (result.boundaryFallbacks?.length) {
        log(
          'info',
          `Graphing 无法填充 ${result.boundaryFallbacks.length} 个复杂不等式，已改画边界曲线`,
          result.boundaryFallbacks.map((b) => b.to)
        )
        setStatus(
          `已导入 ${n} 条（其中 ${result.boundaryFallbacks.length} 条以边界曲线显示）`
        )
      } else if (result.hiddenInequalities > 0) {
        log('warn', `仍有 ${result.hiddenInequalities} 个不等式区域无法填充`)
      }
      notifyResize()
    } catch (err) {
      const msg = err.message || String(err)
      log('error', '导入失败', msg)
      // CSP / 沙箱仍失败时：独立扩展窗口（不嵌在敌对页面里）
      if (
        /deployggb|脚本加载|沙箱|超时|GGBApplet|cross-origin|named property 'document'/i.test(msg) &&
        lastImportedLines.length
      ) {
        try {
          const winRes = await runtimeSend({
            type: 'MTP_OPEN_GGB_WINDOW',
            lines: lastImportedLines,
            appName: detectAppName(lastImportedLines),
          })
          if (winRes.ok) {
            log('info', '已改为独立窗口打开 GeoGebra')
            toast('页面内嵌失败，已弹出独立 GeoGebra 窗口')
            setStatus('已在独立窗口导入')
            return
          }
        } catch (e2) {
          log('warn', '独立窗口也失败', e2.message || String(e2))
        }
      }
      toast('导入失败，已复制提示词')
      copyPrompt()
      autoCloseEmpty('导入失败，已关闭')
    }
  }

  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.source !== 'mtp-page-bridge') return
    if (d.type === 'MTP_BRIDGE_READY') {
      bridgeReady = true
      log('debug', 'page-bridge ready', d.ver || '')
      // 预拉取 deployggb，降低首次导入失败率
      runtimeSend({ type: 'MTP_FETCH_GGB_DEPLOY' })
        .then((res) => {
          if (res.ok && res.code) window.__mtpGgbDeployCache = res.code
        })
        .catch(() => {})
      return
    }
    if (d.type === 'MTP_NEED_GGB_SCRIPT') {
      ;(async () => {
        try {
          let code = window.__mtpGgbDeployCache
          if (!code) {
            const res = await runtimeSend({ type: 'MTP_FETCH_GGB_DEPLOY' })
            if (!res.ok || !res.code) throw new Error(res.error || '拉取失败')
            code = res.code
            window.__mtpGgbDeployCache = code
          }
          log('debug', `已代理注入 deployggb.js（${Math.round(code.length / 1024)}KB）`)
          window.postMessage({ source: 'mtp-ext-content', type: 'MTP_GGB_SCRIPT_CODE', code }, '*')
          postToGgbFrame({ type: 'MTP_GGB_SCRIPT_CODE', code })
        } catch (err) {
          log('warn', '代理拉取 deployggb 失败', err.message || String(err))
          window.postMessage(
            { source: 'mtp-ext-content', type: 'MTP_GGB_SCRIPT_CODE', error: err.message || String(err) },
            '*'
          )
          postToGgbFrame({ type: 'MTP_GGB_SCRIPT_CODE', error: err.message || String(err) })
        }
      })()
      return
    }
    if (d.type === 'MTP_GGB_DONE' && d.requestId && pendingGgb.has(d.requestId)) {
      const resolve = pendingGgb.get(d.requestId)
      pendingGgb.delete(d.requestId)
      resolve(d)
    }
  })

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'MTP_CONTEXT_ACTION') return
    log('info', '收到原生右键', msg)
    applyExternalCapture(msg.selectionText || '', msg.srcUrl || '')
    clearPageSelection()
    if (msg.action === 'geogebra') {
      lastForceMode = msg.forceMode || null
      openTool(msg.forceMode || null)
    } else if (msg.action === 'prompt') copyPrompt()
    else if (msg.action === 'logs') showLogPanel()
    sendResponse({ ok: true })
    return true
  })

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0) return
      if (e.target.closest?.('#mtp-side,#mtp-log-panel,#mtp-bar')) return
      setTimeout(() => {
        const cap = captureFromSelection(e.target)
        if (cap.kind !== 'empty') lastCapture = cap
      }, 10)
    },
    true
  )

  document.addEventListener(
    'contextmenu',
    (e) => {
      if (e.target.closest?.('#mtp-side,#mtp-log-panel')) return
      lastCapture = captureFromSelection(e.target)
    },
    true
  )

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') closePanel()
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'g') {
          lastCapture = captureFromSelection(document.activeElement)
          if (lastCapture.kind === 'empty') return
          e.preventDefault()
          openTool()
        } else if (k === 'p') {
          lastCapture = captureFromSelection(document.activeElement)
          if (lastCapture.kind === 'empty') return
          e.preventDefault()
          copyPrompt()
        } else if (k === 'l') {
          e.preventDefault()
          showLogPanel()
        }
      }
    },
    true
  )

  window.addEventListener('resize', () => {
    if (!document.getElementById(LAYOUT_ID)) return
    if (viewMode === 'split') applySideWidth()
    else applyMiniBox()
    notifyResize()
  })

  refreshCfg().then(() => log('info', `纯扩展 content 已加载 v${VERSION}（左侧分栏 / 迷你浮窗）`))
})()
