const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  const note = document.querySelector('input')
  const button = document.querySelector('button')
  const status = document.querySelector('output')
  button.addEventListener('click', async () => {
    if (document.title.includes('Writer')) {
      await ipcRenderer.invoke('fixture:export', note.value)
      status.textContent = 'Note exported'
    } else {
      note.value = await ipcRenderer.invoke('fixture:import')
      status.textContent = 'Note imported'
    }
  })
})
