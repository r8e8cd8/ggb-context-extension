async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'MTP_GET_CFG' })
  const cfg = res?.cfg || {}
  document.getElementById('enabled').checked = !!cfg.enabled
  document.getElementById('showLog').checked = !!cfg.showLog
  document.getElementById('windowMode').value = cfg.windowMode === 'float' ? 'float' : 'embed'
}

document.getElementById('enabled').addEventListener('change', async (e) => {
  await chrome.runtime.sendMessage({ type: 'MTP_SET_CFG', partial: { enabled: e.target.checked } })
})
document.getElementById('showLog').addEventListener('change', async (e) => {
  await chrome.runtime.sendMessage({ type: 'MTP_SET_CFG', partial: { showLog: e.target.checked } })
})
document.getElementById('windowMode').addEventListener('change', async (e) => {
  await chrome.runtime.sendMessage({ type: 'MTP_SET_CFG', partial: { windowMode: e.target.value } })
})
document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

load()
