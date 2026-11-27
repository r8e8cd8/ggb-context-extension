async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'MTP_GET_CFG' })
  const cfg = res?.cfg || {}
  document.getElementById('baseUrl').value = cfg.baseUrl || ''
  document.getElementById('apiKey').value = cfg.apiKey || ''
  document.getElementById('model').value = cfg.model || ''
  document.getElementById('fallbackModel').value = cfg.fallbackModel || ''
  document.getElementById('enabled').checked = !!cfg.enabled
  document.getElementById('showLog').checked = !!cfg.showLog
  document.getElementById('verboseLog').checked = !!cfg.verboseLog
}

document.getElementById('save').addEventListener('click', async () => {
  const partial = {
    baseUrl: document.getElementById('baseUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value.trim(),
    fallbackModel: document.getElementById('fallbackModel').value.trim(),
    enabled: document.getElementById('enabled').checked,
    showLog: document.getElementById('showLog').checked,
    verboseLog: document.getElementById('verboseLog').checked,
  }
  await chrome.runtime.sendMessage({ type: 'MTP_SET_CFG', partial })
  document.getElementById('msg').textContent = '已保存'
})

load()
