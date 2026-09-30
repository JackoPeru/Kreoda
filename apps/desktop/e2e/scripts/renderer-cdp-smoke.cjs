// No OCCT or visible window: verify the crash-test client's Electron lifecycle.
const { _electron: electron, chromium } = require('@playwright/test');
const { createServer } = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kreoda-hidden-cdp-'));
  const main = path.join(directory, 'main.cjs');
  fs.writeFileSync(main, `
    const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      window.webContents.on('render-process-gone', () => window.webContents.reload());
      window.loadURL('data:text/html,<body data-testid="recovered">hidden</body>');
    });
    app.on('window-all-closed', () => app.quit());
  `);
  let app, attached;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [main, '--no-sandbox', '--remote-debugging-port=' + port],
    });
    const original = await app.firstWindow();
    await original.waitForSelector('[data-testid="recovered"]');
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    assert.equal(await visible(), false);
    await app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const deadline = setTimeout(() => reject(new Error('renderer reload timed out')), 30000);
      contents.once('did-finish-load', () => { clearTimeout(deadline); resolve(); });
      contents.forcefullyCrashRenderer();
    }));
    // The dead client must stay rejected: the patch only ignores late replies.
    await assert.rejects(original.evaluate(() => document.body.textContent), /crashed|closed/i);
    attached = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const restored = attached.contexts()[0].pages()[0];
    assert.equal(await restored.locator('[data-testid="recovered"]').textContent(), 'hidden');
    assert.equal(await visible(), false);
    console.log('PASS: hidden renderer auto-reload; dead Page rejected; fresh CDP recovered DOM');
  } finally {
    if (attached) await attached.close();
    if (app) await app.close();
    fs.unlinkSync(main);
    fs.rmdirSync(directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
