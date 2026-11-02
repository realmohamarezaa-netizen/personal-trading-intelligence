// ─── Personal Trading Intelligence — desktop shell (Electron main) ───────────
// Starts the bundled Next.js standalone server on 127.0.0.1, waits for its
// health endpoint, then shows the dashboard in a native window. Everything is
// local-only: the server binds to the loopback interface exclusively.

const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const PORT = 3517
const HOST = '127.0.0.1'
const APP_DIR = __dirname
const SERVER_DIR = path.join(APP_DIR, 'server')
const DB_FILE = path.join(APP_DIR, 'db', 'custom.db').replace(/\\/g, '/')
const PY_DIR = path.join(APP_DIR, 'python')
const PY_EXE = path.join(PY_DIR, 'python.exe')
const SYNC_SCRIPT = path.join(APP_DIR, 'connector', 'sync_service.py')
const LOG_DIR = path.join(APP_DIR, 'logs')

let serverProc = null
let win = null

// Old Windows 10 machines sometimes misbehave with GPU compositing.
app.disableHardwareAcceleration()

function log(line) {
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'desktop.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {}
}

function startServer() {
  serverProc = spawn(process.execPath, [path.join(SERVER_DIR, 'server.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: HOST,
      DATABASE_URL: 'file:' + DB_FILE,
      PTI_PYTHON: PY_EXE,
      PTI_SYNC_SCRIPT: SYNC_SCRIPT,
      PTI_LOG_DIR: LOG_DIR,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  serverProc.stdout.on('data', () => {})
  serverProc.stderr.on('data', (d) => log(`[server] ${String(d).trim()}`))
  serverProc.on('exit', (code) => log(`server exited with code ${code}`))
}

function waitForServer(maxRetries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(`http://${HOST}:${PORT}/api/health`, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        retry(n)
      })
      req.on('error', () => retry(n))
      req.setTimeout(1500, () => {
        req.destroy()
        retry(n)
      })
    }
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not become healthy in time'))
      setTimeout(() => attempt(n - 1), 500)
    }
    attempt(maxRetries)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    title: 'Personal Trading Intelligence',
    icon: path.join(APP_DIR, 'icon.png'),
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.loadURL(`http://${HOST}:${PORT}/`)
  // Never navigate the app window away from the local dashboard.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://${HOST}:${PORT}`)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
  })
}

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(pid)
    } catch {}
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    } catch {}
    log('app starting — launching bundled server')
    startServer()
    try {
      await waitForServer()
      log('server healthy — opening window')
    } catch (err) {
      log(`WARNING: ${err.message} — opening window anyway`)
    }
    createWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    log('quitting — killing server tree (connector exits with it / via health check)')
    killTree(serverProc && serverProc.pid)
  })
}
