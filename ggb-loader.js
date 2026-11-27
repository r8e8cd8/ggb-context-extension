;(async function () {
  'use strict'
  const logEl = document.getElementById('log')
  const retryBtn = document.getElementById('retry')
  let lines = []
  let appName = 'graphing'
  let child = null

  function log(msg, cls) {
    logEl.textContent = String(msg || '')
    logEl.className = cls || ''
  }

  function openHost() {
    const url = chrome.runtime.getURL('ggb-host.html') + '?popup=1&v=1.4.9'
    // 顶层沙箱窗口：parent===self，不会撞 parent.document 跨域
    child = window.open(url, 'mtp-ggb-host', 'popup=yes,width=960,height=720')
    if (!child) {
      log('弹窗被拦截：请允许此扩展弹窗后点重试', 'err')
      retryBtn.hidden = false
      return
    }
    log(appName === '3d' ? '已打开 GeoGebra 3D 窗口，等待就绪…' : '已打开 GeoGebra 窗口，等待就绪…')
  }

  function sendRun() {
    if (!child || child.closed) {
      openHost()
      return
    }
    child.postMessage(
      {
        source: 'mtp-ext-content',
        type: 'MTP_RUN_GGB',
        requestId: 'loader-' + Date.now(),
        lines,
        appName,
        width: 920,
        height: 680,
      },
      '*'
    )
    log(
      `已发送 ${lines.length} 条命令（${appName === '3d' ? '3D' : 'Graphing'}），请查看 GeoGebra 窗口`,
      'ok'
    )
  }

  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.source !== 'mtp-page-bridge') return
    if (d.type === 'MTP_BRIDGE_READY') {
      log('GeoGebra 宿主就绪，开始导入…')
      sendRun()
      return
    }
    if (d.type === 'MTP_NEED_GGB_SCRIPT') {
      chrome.runtime.sendMessage({ type: 'MTP_FETCH_GGB_DEPLOY' }, (res) => {
        const payload = {
          source: 'mtp-ext-content',
          type: 'MTP_GGB_SCRIPT_CODE',
        }
        if (chrome.runtime.lastError || !res?.ok) {
          payload.error = res?.error || chrome.runtime.lastError?.message || '拉取失败'
        } else {
          payload.code = res.code
        }
        try {
          child && child.postMessage(payload, '*')
        } catch (_) {}
      })
      return
    }
    if (d.type === 'MTP_GGB_DONE') {
      if (d.error) {
        log('导入失败：' + d.error, 'err')
        retryBtn.hidden = false
      } else {
        log(
          `导入完成：${d.ok || 0} 条` +
            (d.appName === '3d' ? ' · 3D' : '') +
            (d.boundaryFallbacks?.length ? `（边界 ${d.boundaryFallbacks.length}）` : ''),
          'ok'
        )
      }
    }
  })

  retryBtn.onclick = () => {
    retryBtn.hidden = true
    openHost()
    setTimeout(sendRun, 800)
  }

  try {
    const stored = await chrome.storage.session.get(['mtpPendingLines', 'mtpPendingAppName'])
    lines = Array.isArray(stored.mtpPendingLines) ? stored.mtpPendingLines : []
    appName = stored.mtpPendingAppName === '3d' ? '3d' : 'graphing'
    if (
      appName !== '3d' &&
      lines.some(
        (l) =>
          /\bCurve\s*\([^,]+,[^,]+,[^,]+,/i.test(l) ||
          /\bSurface\s*\(/i.test(l) ||
          /\bz\s*[<>=]/i.test(l) ||
          /x\^2\s*\+\s*y\^2\s*\+\s*z\^2/i.test(l)
      )
    ) {
      appName = '3d'
    }
    if (!lines.length) {
      log('没有待导入命令。请回到网页重新右键导入。', 'err')
      return
    }
    log(`已读取 ${lines.length} 条（${appName === '3d' ? '3D' : 'Graphing'}），打开顶层 GeoGebra…`)
    openHost()
    // 若 READY 丢失，再发一次
    setTimeout(() => {
      if (child && !child.closed) sendRun()
    }, 1200)
  } catch (err) {
    log('读取失败：' + (err.message || String(err)), 'err')
    retryBtn.hidden = false
  }
})()
