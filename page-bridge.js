/**
 * 跑在页面主世界：加载 GeoGebra 并导入命令。
 * 由 content script 以 <script src="chrome-extension://.../page-bridge.js"> 注入。
 */
;(function () {
  'use strict'
  const BRIDGE_VER = '1.4.9'

  function emitToHost(payload) {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, '*')
      }
    } catch (_) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*')
        return
      }
    } catch (_) {}
    window.postMessage(payload, '*')
  }
  // 允许扩展升级后重新注入：只保留一份 message 分发
  if (!window.__mtpPageBridgeInstalled) {
    window.__mtpPageBridgeInstalled = true
    window.addEventListener('message', (e) => {
      const fn = window.__mtpPageBridgeOnMessage
      if (typeof fn === 'function') fn(e)
    })
  }
  if (window.__mtpPageBridgeVer === BRIDGE_VER && window.__mtpPageBridgeOnMessage) return
  window.__mtpPageBridgeVer = BRIDGE_VER

  const GGB_SRC_REMOTE = 'https://www.geogebra.org/apps/deployggb.js'
  const GGB_SRC_LOCAL = 'vendor/deployggb.js'
  const INJECT_TIMEOUT_MS = 60000
  let lastApi = null
  let lastMount = null
  let lastAppName = 'graphing'
  let injecting = false
  let ggbScriptWaiter = null

  function waitGgbCtor(timeoutMs) {
    const t0 = Date.now()
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (window.GGBApplet) resolve(window.GGBApplet)
        else if (Date.now() - t0 > timeoutMs) reject(new Error('GeoGebra 脚本加载超时'))
        else setTimeout(tick, 50)
      }
      tick()
    })
  }

  function injectScriptSrc(src) {
    return new Promise((resolve, reject) => {
      const existed = [...document.scripts].find((s) => (s.getAttribute('src') || '') === src || s.src.endsWith(src))
      if (existed && window.GGBApplet) {
        resolve()
        return
      }
      const sc = document.createElement('script')
      sc.src = src
      sc.async = true
      sc.onload = () => resolve()
      sc.onerror = () => reject(new Error('script src 失败: ' + src))
      ;(document.head || document.documentElement).appendChild(sc)
    })
  }

  function injectScriptCode(code) {
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([String(code || '')], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        const sc = document.createElement('script')
        sc.src = url
        sc.async = true
        sc.onload = () => {
          try {
            URL.revokeObjectURL(url)
          } catch (_) {}
          resolve()
        }
        sc.onerror = () => {
          try {
            URL.revokeObjectURL(url)
          } catch (_) {}
          reject(new Error('script blob 失败'))
        }
        ;(document.head || document.documentElement).appendChild(sc)
      } catch (err) {
        reject(err)
      }
    })
  }

  function requestDeployViaParent() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (ggbScriptWaiter) {
          ggbScriptWaiter = null
          reject(new Error('等待扩展代理 deployggb 超时'))
        }
      }, 20000)
      ggbScriptWaiter = {
        resolve: (code) => {
          clearTimeout(timer)
          ggbScriptWaiter = null
          resolve(code)
        },
        reject: (err) => {
          clearTimeout(timer)
          ggbScriptWaiter = null
          reject(err)
        },
      }
      emitToHost({ source: 'mtp-page-bridge', type: 'MTP_NEED_GGB_SCRIPT' })
    })
  }

  function isPageMainWorld() {
    try {
      return !/(?:\?|&)popup=1(?:&|$)/.test(location.search || '') && location.protocol !== 'chrome-extension:'
    } catch (_) {
      return true
    }
  }

  async function loadGgb() {
    if (window.GGBApplet) return window.GGBApplet
    // 页面主世界：优先官网脚本（以前能用的路径）；失败再让扩展代理 blob 注入
    if (isPageMainWorld()) {
      try {
        await injectScriptSrc(GGB_SRC_REMOTE)
        return await waitGgbCtor(20000)
      } catch (_) {}
      try {
        const code = await requestDeployViaParent()
        if (!code) throw new Error('空脚本')
        await injectScriptCode(code)
        return await waitGgbCtor(20000)
      } catch (err) {
        throw new Error('deployggb.js 加载失败：' + (err.message || String(err)))
      }
    }
    // 扩展沙箱弹窗：本地 vendor → 远程 → 代理
    try {
      return await waitGgbCtor(2500)
    } catch (_) {}
    try {
      await injectScriptSrc(GGB_SRC_LOCAL)
      return await waitGgbCtor(8000)
    } catch (_) {}
    try {
      await injectScriptSrc(GGB_SRC_REMOTE)
      return await waitGgbCtor(15000)
    } catch (_) {}
    try {
      const code = await requestDeployViaParent()
      if (!code) throw new Error('空脚本')
      await injectScriptCode(code)
      return await waitGgbCtor(15000)
    } catch (err) {
      throw new Error('deployggb.js 加载失败：' + (err.message || String(err)))
    }
  }

  function latexToRoughGgb(latex) {
    let s = String(latex || '').trim()
    s = s.replace(/\\left/g, '').replace(/\\right/g, '')
    s = s.replace(/\\cdot/g, '*').replace(/\\times/g, '*')
    s = s.replace(/\\div/g, '/')
    s = s.replace(/\\leq/g, '<=').replace(/\\geq/g, '>=').replace(/\\neq/g, '!=')
    s = s.replace(/\\pi\b/g, 'pi').replace(/\\theta\b/g, 'theta')
    s = s.replace(/\\sin/g, 'sin').replace(/\\cos/g, 'cos').replace(/\\tan/g, 'tan')
    s = s.replace(/\\ln/g, 'ln').replace(/\\log/g, 'log').replace(/\\exp/g, 'exp')
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    s = s.replace(/\\mathrm\{([^{}]+)\}/g, '$1')
    s = s.replace(/\\text\{([^{}]+)\}/g, '$1')
    s = s.replace(/[{}]/g, '')
    return normalizeGgbCmd(s)
  }

  function normalizeGgbCmd(cmd) {
    let s = String(cmd || '').trim()
    if (!s || s.startsWith('%')) return s
    s = s.replace(/\bExp\s*\(/gi, 'exp(')
    s = s.replace(/\bPoint\s*\(\s*\(([^)]+)\)\s*\)/gi, '($1)')
    s = s.replace(/\bPoint\s*\(([^)]+)\)/gi, '($1)')
    s = s.replace(/(exp\([^)]+\))\s*\(/gi, '$1*(')
    s = s.replace(/(e\^[A-Za-z0-9]+)\s*\(/g, '$1*(')
    s = s.replace(/\)\s*\(/g, ')*(')
    s = s.replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(e\^[A-Za-z0-9]+|exp\([^)]+\))\s*\(/gi, '($1/$2)*(')
    s = s.replace(/\/\s*(e\^[A-Za-z0-9]+|exp\([^)]+\))\s+(?=\()/gi, '/$1)*(')
    s = s.replace(/≤|⩽|≦/g, '<=').replace(/≥|⩾|≧/g, '>=').replace(/≠|≂/g, '!=')
    s = s.replace(/\\le\b/gi, '<=').replace(/\\ge\b/gi, '>=').replace(/\\neq\b/gi, '!=')
    s = s.replace(/\\leq\b/gi, '<=').replace(/\\geq\b/gi, '>=')
    s = s.replace(/\\lt\b/gi, '<').replace(/\\gt\b/gi, '>')
    s = s.replace(/π/g, 'pi').replace(/𝜑|φ|ϕ/g, 'phi').replace(/arcsin/gi, 'asin')
    s = s.replace(/(\d)\s*([A-Za-z])/g, '$1*$2')
    // abs(x)^(2/3) → (abs(x)^2)^(1/3)，实数域更稳
    s = s.replace(/abs\(([^()]*)\)\s*\^\s*\(\s*2\s*\/\s*3\s*\)/gi, '(abs($1)^2)^(1/3)')
    s = s.replace(/abs\(([^()]*)\)\s*\^\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/gi, '(abs($1)^$2)^(1/$3)')
    return s.trim()
  }

  function forceShowAll(api) {
    if (!api || typeof api.getAllObjectNames !== 'function') return
    let names = []
    try {
      names = api.getAllObjectNames() || []
    } catch (_) {
      return
    }
    names.forEach((n) => {
      try {
        // Graphing 批量导入不等式时，靠后的常被自动 visible=false
        if (typeof api.setVisible === 'function') api.setVisible(n, true)
      } catch (_) {}
      try {
        if (api.getObjectType && api.getObjectType(n) === 'inequality' && typeof api.setFilling === 'function') {
          api.setFilling(n, 0.4)
        }
      } catch (_) {}
    })
  }

  /** Graphing 对 sin/abs 等非多项式不等式常无法填充（getVisible 恒 false），退化为边界等式。 */
  function toBoundaryEquality(cmd) {
    const s = String(cmd || '').trim()
    if (!/[<>]=?/.test(s)) return null
    const eq = s.replace(/<=|>=|<|>/g, '=')
    if (eq === s) return null
    return eq
  }

  function looksHardInequality(cmd) {
    const s = String(cmd || '')
    if (!/[<>]=?/.test(s)) return false
    // 仅二维难填充区域需要边界回退；y<=1-cos(x) 这类 Graphing 通常能画
    if (/\babs\s*\(\s*x\s*\)/i.test(s) && /\babs\s*\(\s*y\s*\)/i.test(s)) return true
    if (/\bsin\s*\(\s*x\s*\)/i.test(s) && /\bsin\s*\(\s*y\s*\)/i.test(s)) return true
    if (/\batan2\s*\(/i.test(s)) return true
    if (/\b(exp|ln|log)\s*\(/i.test(s) && /\bx\b/.test(s) && /\by\b/.test(s)) return true
    return false
  }

  function ensureDrawableInequalities(api, importedCmds) {
    const boundaries = []
    const added = new Set()
    ;(importedCmds || []).forEach((cmd) => {
      if (!/[<>]=?/.test(cmd)) return
      // 多项式区域一般能填充；sin/abs/exp 等 Graphing 几乎总是不画填充
      if (!looksHardInequality(cmd)) return
      const eq = toBoundaryEquality(cmd)
      if (!eq || added.has(eq)) return
      let ok = false
      try {
        ok = !!api.evalCommand(eq)
      } catch (_) {}
      if (ok) {
        added.add(eq)
        boundaries.push({ from: cmd, to: eq })
      }
    })
    return boundaries
  }

  function mountSize(mount, fallbackW, fallbackH) {
    const cw = Math.floor(mount?.clientWidth || 0)
    const ch = Math.floor(mount?.clientHeight || 0)
    const w = cw > 40 ? cw : Math.max(320, fallbackW || 480)
    const h = ch > 40 ? ch : Math.max(240, fallbackH || 520)
    return { w, h }
  }

  function syncSize(api, mount) {
    if (!api || !mount || typeof api.setSize !== 'function') return
    const { w, h } = mountSize(mount)
    if (w > 40 && h > 40) {
      try {
        api.setSize(w, h)
      } catch (_) {}
    }
  }

  function resetView(api, appName) {
    if (!api) return
    if (appName === '3d') {
      try {
        if (typeof api.setPerspective === 'function') api.setPerspective('T')
      } catch (_) {}
      try {
        api.evalCommand('ZoomIn[-2,-2,-0.5,2,2,7]')
      } catch (_) {}
      try {
        if (typeof api.showAllObjects === 'function') api.showAllObjects()
      } catch (_) {}
      return
    }
    try {
      if (typeof api.showAllObjects === 'function') {
        api.showAllObjects()
        return
      }
    } catch (_) {}
    try {
      if (typeof api.setCoordSystem === 'function') {
        api.setCoordSystem(-4, 4, -3, 4)
        return
      }
    } catch (_) {}
    try {
      api.evalCommand('ZoomIn[-4, -3, 4, 4]')
    } catch (_) {}
  }

  function apiAlive(api, mount) {
    if (!api || !mount) return false
    if (!mount.firstElementChild) return false
    try {
      if (typeof api.evalCommand !== 'function') return false
      if (typeof api.getObjectNumber === 'function') api.getObjectNumber()
      return true
    } catch (_) {
      return false
    }
  }

  function wireResize(api, mount) {
    const fit = () => syncSize(api, mount)
    fit()
    setTimeout(fit, 80)
    setTimeout(fit, 300)
    if (mount.__mtpRo) {
      try {
        mount.__mtpRo.disconnect()
      } catch (_) {}
    }
    if (typeof ResizeObserver !== 'undefined') {
      mount.__mtpRo = new ResizeObserver(fit)
      mount.__mtpRo.observe(mount)
    }
  }

  /**
   * a=0 在 Graphing 里默认无滑块（XML 无 <slider>）。
   * 若该变量被其它命令引用，升级为 a=Slider(min,max,0.1) 再用 setValue 设回原值。
   */
  /** 拆 && / 链式 a<=f<=b，Graphing 只认单条不等式 */
  function expandCompoundLines(lines) {
    const out = []
    ;(lines || []).forEach((line) => {
      let s = String(line || '').trim()
      if (!s) return
      // 1 <= expr <= 2  /  a < f < b
      const chain = s.match(
        /^\s*([-+0-9.]+|pi)\s*(<=|<|>=|>)\s*(.+?)\s*(<=|<|>=|>)\s*([-+0-9.]+|pi)\s*$/i
      )
      if (chain) {
        const [, a, op1, mid, op2, b] = chain
        const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }
        out.push(`${mid.trim()} ${flip[op1] || op1} ${a}`)
        out.push(`${mid.trim()} ${op2} ${b}`)
        return
      }
      if (/\s*\|\|\s*/.test(s) || s.includes('||')) {
        s.split(/\s*\|\|\s*/).map((p) => p.trim()).filter(Boolean).forEach((p) => out.push(p))
        return
      }
      if (/\s&&\s/.test(s) || s.includes('&&')) {
        s.split(/&&/).map((p) => p.trim()).filter(Boolean).forEach((p) => out.push(p))
        return
      }
      out.push(s)
    })
    return out
  }

  function prepareLines(lines) {
    const raw = expandCompoundLines(lines || []).map((l) => normalizeGgbCmd(l)).filter(Boolean)
    const setValues = []
    const mapped = raw.map((cmd, i) => {
      if (/\bSlider\s*\(/i.test(cmd)) return cmd
      const m = cmd.match(/^([A-Za-z]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/)
      if (!m) return cmd
      const name = m[1]
      const value = parseFloat(m[2])
      const re = new RegExp('(?:^|[^A-Za-z0-9_])' + name + '(?:[^A-Za-z0-9_]|$)')
      const referenced = raw.some((l, j) => j !== i && re.test(l))
      if (!referenced) return cmd
      const min = Number.isFinite(value) ? Math.min(-2, Math.floor(value - 3)) : -2
      const max = Number.isFinite(value) ? Math.max(5, Math.ceil(value + 3)) : 5
      setValues.push({ name, value: Number.isFinite(value) ? value : 0 })
      return `${name}=Slider(${min},${max},0.1)`
    })
    // 滑块/纯数值先导入，避免 g 依赖 a 但 a 写在后面
    const rank = (cmd) => {
      if (/\bSlider\s*\(/i.test(cmd)) return 0
      if (/^[A-Za-z]\w*\s*=\s*-?\d+(\.\d+)?\s*$/.test(cmd)) return 1
      if (/^[A-Za-z]\w*\s*=\s*\(/.test(cmd) || /^\(/.test(cmd)) return 2
      if (/\b(Segment|Line|Vector)\s*\(/i.test(cmd)) return 4
      return 3
    }
    const prepared = mapped
      .map((cmd, i) => ({ cmd, i }))
      .sort((a, b) => rank(a.cmd) - rank(b.cmd) || a.i - b.i)
      .map((x) => x.cmd)
    return { prepared, setValues }
  }

  function importLines(api, lines) {
    try {
      if (typeof api.reset === 'function') api.reset()
      else if (typeof api.newConstruction === 'function') api.newConstruction()
    } catch (_) {}
    try {
      if (typeof api.setErrorDialogsActive === 'function') api.setErrorDialogsActive(false)
    } catch (_) {}
    try {
      if (typeof api.setRepaintingActive === 'function') api.setRepaintingActive(false)
    } catch (_) {}

    const { prepared, setValues } = prepareLines(lines)
    const imported = []
    const skipped = []
    prepared.forEach((cmd) => {
      if (!cmd || /\bLimit\s*\(/i.test(cmd) || /\blim\b/i.test(cmd)) {
        skipped.push(cmd || '')
        return
      }
      if (/\b(Solve|NSolve|Integral|Derivative)\s*\(/i.test(cmd)) {
        skipped.push(cmd)
        return
      }
      let done = false
      try {
        done = !!api.evalCommand(cmd)
      } catch (_) {}
      if (!done) {
        try {
          done = !!api.evalCommand(latexToRoughGgb(cmd))
        } catch (_) {}
      }
      if (done) imported.push(cmd)
      else skipped.push(cmd)
    })

    setValues.forEach(({ name, value }) => {
      try {
        if (typeof api.setValue === 'function') api.setValue(name, value)
      } catch (_) {}
      try {
        if (typeof api.setVisible === 'function') api.setVisible(name, true)
      } catch (_) {}
    })

    forceShowAll(api)
    const boundaries = ensureDrawableInequalities(api, imported)
    // 线积分场样本：加粗向量，避免看不清
    try {
      const names = api.getAllObjectNames() || []
      names.forEach((n) => {
        try {
          if (api.getObjectType(n) === 'vector') {
            if (typeof api.setLineThickness === 'function') api.setLineThickness(n, 5)
            if (typeof api.setVisible === 'function') api.setVisible(n, true)
          }
        } catch (_) {}
      })
    } catch (_) {}
    try {
      if (typeof api.setRepaintingActive === 'function') api.setRepaintingActive(true)
    } catch (_) {}
    try {
      if (typeof api.refreshViews === 'function') api.refreshViews()
    } catch (_) {}
    resetView(api, lastAppName)
    // 再刷一次可见性：showAllObjects / refresh 后仍可能把靠后不等式藏掉
    forceShowAll(api)

    let hidden = 0
    let drawable = 0
    try {
      const names = api.getAllObjectNames() || []
      names.forEach((n) => {
        try {
          const t = api.getObjectType(n)
          const v = api.getVisible(n)
          if (t === 'inequality' && v === false) hidden += 1
          if (v && (t === 'inequality' || /implicit|conic|equation|curve/i.test(t))) drawable += 1
        } catch (_) {}
      })
    } catch (_) {}

    return {
      ok: imported.length,
      fail: skipped.length,
      imported,
      skipped,
      hiddenInequalities: hidden,
      boundaryFallbacks: boundaries,
      drawableObjects: drawable,
    }
  }

  function destroyApplet(mount) {
    lastApi = null
    lastMount = null
    lastAppName = 'graphing'
    if (!mount) return
    try {
      if (mount.__mtpRo) mount.__mtpRo.disconnect()
    } catch (_) {}
    mount.__mtpRo = null
    mount.innerHTML = ''
  }

  function injectFresh(mount, lines, w, h, appName) {
    const wantApp = appName === '3d' ? '3d' : 'graphing'
    return new Promise((resolve, reject) => {
      if (injecting) {
        reject(new Error('GeoGebra 正在加载，请稍候再试'))
        return
      }
      injecting = true
      destroyApplet(mount)
      lastAppName = wantApp
      mount.id = 'mtp-ggb-mount'
      mount.classList.add('mtp-ggb-mount')

      let settled = false
      const finish = (fn, arg) => {
        if (settled) return
        settled = true
        injecting = false
        clearTimeout(timer)
        fn(arg)
      }

      const timer = setTimeout(() => {
        finish(reject, new Error('GeoGebra 注入超时'))
      }, INJECT_TIMEOUT_MS)

      loadGgb()
        .then((Ctor) => {
          const applet = new Ctor(
            {
              appName: wantApp,
              width: w,
              height: h,
              showToolBar: true,
              showToolBarHelp: false,
              showAlgebraInput: true,
              showMenuBar: false,
              enableUndoRedo: true,
              // 不用 scaleContainerClass/allowUpscale：它们会把画布拉伸放大导致文字发糊
              allowUpscale: false,
              autoHeight: false,
              playButton: false,
              playButtonAutoDecide: false,
              disableAutoScale: true,
              borderColor: '#ffffff',
              appletOnLoad(api) {
                lastApi = api
                lastMount = mount
                lastAppName = wantApp
                wireResize(api, mount)
                const result = importLines(api, lines)
                syncSize(api, mount)
                finish(resolve, { ...result, appName: wantApp })
              },
            },
            true
          )
          applet.inject('mtp-ggb-mount')
        })
        .catch((err) => finish(reject, err))
    })
  }

  async function runGgb(msg) {
    const mount = document.getElementById('mtp-ggb-mount')
    if (!mount) throw new Error('找不到挂载节点 #mtp-ggb-mount')
    const lines = Array.isArray(msg.lines) ? msg.lines : []
    const wantApp =
      msg.appName === '3d' ||
      lines.some(
        (l) =>
          /\bCurve\s*\([^,]+,[^,]+,[^,]+,/i.test(l) ||
          /\bSurface\s*\(/i.test(l) ||
          /\bz\s*[<>=]/i.test(l) ||
          /x\^2\s*\+\s*y\^2\s*\+\s*z\^2/i.test(l) ||
          /^\s*[A-Za-z]\w*\s*=\s*\([^,]+,[^,]+,[^,]+\)/.test(l)
      )
        ? '3d'
        : 'graphing'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const { w, h } = mountSize(mount, msg.width, msg.height)

    // 二次导入：同应用才复用；2D↔3D 必须重建
    if (apiAlive(lastApi, mount) && lastAppName === wantApp) {
      lastMount = mount
      wireResize(lastApi, mount)
      const result = importLines(lastApi, lines)
      return { ...result, appName: wantApp }
    }

    lastApi = null
    return injectFresh(mount, lines, w, h, wantApp)
  }

  window.__mtpPageBridgeOnMessage = (e) => {
    const d = e.data
    if (!d || d.source !== 'mtp-ext-content') return
    if (d.type === 'MTP_GGB_SCRIPT_CODE') {
      if (ggbScriptWaiter) {
        if (d.error) ggbScriptWaiter.reject(new Error(d.error))
        else ggbScriptWaiter.resolve(d.code || '')
      }
      return
    }
    if (d.type === 'MTP_GGB_RESIZE') {
      syncSize(lastApi, lastMount || document.getElementById('mtp-ggb-mount'))
      return
    }
    if (d.type === 'MTP_GGB_DESTROY') {
      destroyApplet(document.getElementById('mtp-ggb-mount'))
      return
    }
    if (d.type !== 'MTP_RUN_GGB') return
    runGgb(d)
      .then((result) => {
        emitToHost({ source: 'mtp-page-bridge', type: 'MTP_GGB_DONE', requestId: d.requestId, ...result })
      })
      .catch((err) => {
        injecting = false
        emitToHost({
          source: 'mtp-page-bridge',
          type: 'MTP_GGB_DONE',
          requestId: d.requestId,
          ok: 0,
          fail: -1,
          error: err.message || String(err),
        })
      })
  }

  emitToHost({ source: 'mtp-page-bridge', type: 'MTP_BRIDGE_READY', ver: BRIDGE_VER })

  // 顶层弹窗：显示等待态，真正命令由 ggb-loader 经 opener postMessage 下发
  try {
    if (/(?:\?|&)popup=1(?:&|$)/.test(location.search || '')) {
      const status = document.getElementById('mtp-ggb-status')
      if (status) {
        status.style.display = 'block'
        status.textContent = '等待加载器发送命令…'
      }
    }
  } catch (_) {}
})()
