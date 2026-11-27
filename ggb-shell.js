;(function () {
  'use strict'
  const host = document.getElementById('host')

  function toHost(payload) {
    if (!host.contentWindow) return
    try {
      host.contentWindow.postMessage(payload, '*')
    } catch (_) {}
  }

  function toPage(payload) {
    try {
      window.parent.postMessage(payload, '*')
    } catch (_) {}
  }

  // 网页 content script ↔ 壳 ↔ 沙箱 host
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || typeof d !== 'object') return

    if (d.source === 'mtp-ext-content') {
      toHost(d)
      return
    }
    if (d.source === 'mtp-page-bridge') {
      if (d.type === 'MTP_NEED_GGB_SCRIPT') {
        // 壳页有 chrome.runtime，可直接代拉
        try {
          chrome.runtime.sendMessage({ type: 'MTP_FETCH_GGB_DEPLOY' }, (res) => {
            if (chrome.runtime.lastError || !res?.ok) {
              toHost({
                source: 'mtp-ext-content',
                type: 'MTP_GGB_SCRIPT_CODE',
                error: res?.error || chrome.runtime.lastError?.message || '拉取失败',
              })
              return
            }
            toHost({ source: 'mtp-ext-content', type: 'MTP_GGB_SCRIPT_CODE', code: res.code })
          })
        } catch (err) {
          // 无 chrome（极端情况）则交给外层 content
          toPage(d)
        }
        return
      }
      toPage(d)
    }
  })
})()
