// Renders the LeadPitch logo + wordmark to docs/lockup-light.png and docs/lockup-dark.png.
// Run with: npx electron scripts/make-lockup.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const font = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')).toString('base64')
const icon = fs.readFileSync(path.join(root, 'build/icon.png')).toString('base64')

const page = (fg, accent) => `<html><head><style>
@font-face { font-family: G; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
html, body { margin: 0; background: transparent; }
.l { display: inline-flex; align-items: center; gap: 28px; padding: 24px; font-family: G; }
img { width: 112px; height: 112px; }
span { font-size: 76px; font-weight: 600; letter-spacing: -0.035em; color: ${fg}; line-height: 1; }
b { font-weight: 600; color: ${accent}; }
</style></head><body><div class="l" id="l"><img src="data:image/png;base64,${icon}"><span>Lead<b>Pitch</b></span></div></body></html>`

async function shot(win, html, file) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)')
  await new Promise((r) => setTimeout(r, 300))
  const r = await win.webContents.executeJavaScript('(() => { const b = document.getElementById("l").getBoundingClientRect(); return { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) } })()')
  const img = await win.webContents.capturePage(r)
  fs.writeFileSync(file, img.toPNG())
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 300, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  await shot(win, page('#1D1D1F', '#3557E8'), path.join(root, 'docs/lockup-light.png'))
  await shot(win, page('#F2F2F5', '#8CA2FF'), path.join(root, 'docs/lockup-dark.png'))
  console.log('lockups written')
  app.quit()
})
