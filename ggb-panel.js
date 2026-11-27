;(async function () {
  'use strict'
  const errEl = document.getElementById('err')
  const frame = document.getElementById('ggb')
  let bridgeReady = false
  let pending = null
  let lines = []
  let appName = 'graphing'

  function setErr(msg) {
    errEl.textContent = msg || ''
  }

  function post(payload) {
    if (!frame.contentWindow) return
    frame.contentWindow.postMessage({ source: 'mtp-ext-content', ...payload }, '*')
  }

  function runImport() {
    if (!lines.length) {
      setErr('没有待导入命令')
      return
    }
    if (!bridgeReady) {
      setErr('等待 GeoGebra 宿主…')
      setTimeout(runImport, 300)
      return
    }
    setErr(appName === '3d' ? '导入中（3D）…' : '导入中…')
    const requestId = 'panel-' + Date.now()
    pending = requestId
    post({
      type: 'MTP_RUN_GGB',
      requestId,
      lines,
      appName,
      width: frame.clientWidth || 860,
      height: frame.clientHeight || 640,
    })
  }

  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || d.source !== 'mtp-page-bridge') return
    if (d.type === 'MTP_BRIDGE_READY') {
      bridgeReady = true
      setErr('')
      runImport()
      return
    }
    if (d.type === 'MTP_NEED_GGB_SCRIPT') {
      chrome.runtime.sendMessage({ type: 'MTP_FETCH_GGB_DEPLOY' }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          post({ type: 'MTP_GGB_SCRIPT_CODE', error: res?.error || chrome.runtime.lastError?.message || '拉取失败' })
          return
        }
        post({ type: 'MTP_GGB_SCRIPT_CODE', code: res.code })
      })
      return
    }
    if (d.type === 'MTP_GGB_DONE' && d.requestId === pending) {
      pending = null
      if (d.error) setErr('失败：' + d.error)
      else setErr(`完成：导入 ${d.ok || 0} 条` + (d.boundaryFallbacks?.length ? `（边界 ${d.boundaryFallbacks.length}）` : ''))
    }
  })

  document.getElementById('reload').onclick = () => runImport()

  try {
    const stored = await chrome.storage.session.get(['mtpPendingLines', 'mtpPendingAppName'])
    lines = Array.isArray(stored.mtpPendingLines) ? stored.mtpPendingLines : []
    appName = stored.mtpPendingAppName === '3d' ? '3d' : 'graphing'
    if (
      appName !== '3d' &&
      lines.some((l) => /\bCurve\s*\([^,]+,[^,]+,[^,]+,/i.test(l))
    ) {
      appName = '3d'
    }
    if (!lines.length) setErr('无缓存命令，请从网页右键重新导入')
  } catch (_) {
    setErr('读取缓存失败')
  }
})()
