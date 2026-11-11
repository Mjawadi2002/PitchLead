// Renders the LeadPitch mark to build/icon.png (1024) and build/icon.ico (16-256).
// Run with: npx electron scripts/make-icons.cjs
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C6CFF"/><stop offset="1" stop-color="#2742C7"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="url(#f)"/><rect width="64" height="64" rx="15" fill="url(#s)"/>
<rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" stroke-opacity=".16"/>
<circle cx="28" cy="28" r="14.5" fill="none" stroke="#fff" stroke-width="5"/>
<path d="M38.8 38.8 L48.5 48.5" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>
<rect x="20.5" y="29" width="4" height="6" rx="1.5" fill="#fff" fill-opacity=".55"/>
<rect x="26" y="25.5" width="4" height="9.5" rx="1.5" fill="#fff" fill-opacity=".75"/>
<rect x="31.5" y="21" width="4" height="14" rx="1.5" fill="#fff"/></svg>`

function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12)
    offset += buf.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)])
}

app.whenReady().then(async () => {
  // Draw the SVG onto a 1024px canvas inside a page, so screen scaling cannot change the size.
  const win = new BrowserWindow({ width: 200, height: 200, show: false })
  await win.loadURL("data:text/html;charset=utf-8,<html><body></body></html>")
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => { const c = document.createElement("canvas"); c.width = 1024; c.height = 1024; c.getContext("2d").drawImage(img, 0, 0, 1024, 1024); res(c.toDataURL("image/png")) }
    img.onerror = rej
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(${JSON.stringify(SVG)})
  })`)
  const big = nativeImage.createFromDataURL(dataUrl)
  const out = path.join(__dirname, "..", "build")
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, "icon.png"), big.toPNG())
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  fs.writeFileSync(path.join(out, "icon.ico"), ico(sizes.map((s) => ({ size: s, buf: big.resize({ width: s, height: s, quality: "best" }).toPNG() }))))
  console.log("icons written", big.getSize())
  app.quit()
})
