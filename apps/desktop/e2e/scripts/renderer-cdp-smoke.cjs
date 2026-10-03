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
    const rendererPid = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const state = globalThis.__rendererRecovery = {
        rendererPid: contents.getOSProcessId(), exited: false, loaded: false, replacement: 0,
      };
      if (state.rendererPid <= 0 || state.rendererPid === process.pid) throw new Error('Invalid renderer PID');
      contents.once('render-process-gone', () => { state.exited = true; });
      contents.once('did-finish-load', () => {
        state.loaded = true;
        state.replacement = contents.getOSProcessId();
      });
      return state.rendererPid;
    });
    assert.equal(await app.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), rendererPid), true);
    const deadline = Date.now() + 30000;
    let recovery;
    do {
      recovery = await app.evaluate(() => globalThis.__rendererRecovery);
      if (!recovery.loaded) await new Promise(resolve => setTimeout(resolve, 100));
    } while (!recovery.loaded && Date.now() < deadline);
    assert.equal(recovery.loaded, true);
    assert.equal(recovery.exited, true);
    assert.ok(recovery.replacement > 0);
    assert.notEqual(recovery.replacement, rendererPid);
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
