import { app, BrowserWindow, screen, shell, ipcMain, globalShortcut, desktopCapturer } from "electron"
import path from "path"
import fs from "fs"
import { initializeIpcHandlers } from "./ipcHandlers"
import { ProcessingHelper } from "./ProcessingHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { initAutoUpdater } from "./autoUpdater"
import { configHelper } from "./ConfigHelper"
import * as dotenv from "dotenv"
import { logger, logPhase, logDuration } from './logger'

// Constants
const isDev = process.env.NODE_ENV === "development"

// Application State
const state = {
  // Window management properties
  mainWindow: null as BrowserWindow | null,
  isWindowVisible: false,
  windowPosition: null as { x: number; y: number } | null,
  windowSize: null as { width: number; height: number } | null,
  screenWidth: 0,
  screenHeight: 0,
  step: 0,
  currentX: 0,
  currentY: 0,

  // Application helpers
  screenshotHelper: null as ScreenshotHelper | null,
  shortcutsHelper: null as ShortcutsHelper | null,
  processingHelper: null as ProcessingHelper | null,

  // View and state management
  view: "queue" as "queue" | "solutions" | "debug",
  problemInfo: null as any,
  hasDebugged: false,
  // Voice Q&A (transient) state
  voiceActive: false,

  // Processing events
  PROCESSING_EVENTS: {
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",
    OUT_OF_CREDITS: "out-of-credits",
    API_KEY_INVALID: "api-key-invalid",
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error",
    RESET: "reset"
  } as const
}

// Voice IPC channel constants
const VOICE_EVENTS = {
  START_TOGGLE: 'voice:start-toggle',
  STATUS: 'voice:status',
  RESULT: 'voice:result',
  PARTIAL: 'voice:partial',
  ERROR: 'voice:error',
  SAVE_AND_TRANSCRIBE: 'voice:save-and-transcribe',
  SET_CONTEXT: 'voice:set-context',
  GET_CONTEXT: 'voice:get-context',
  SET_MODEL: 'voice:set-model',
  GET_MODEL: 'voice:get-model',
  GET_HISTORY: 'voice:get-history',
  CLEAR_HISTORY: 'voice:clear-history',
  SET_HISTORY_ENABLED: 'voice:set-history-enabled',
  GET_HISTORY_ENABLED: 'voice:get-history-enabled'
} as const

// In-memory voice context (not yet persisted to config; can be extended later)
let voiceContext: string = ''
let voiceStreamingActive = false
let voicePreferredModel: string | null = null
interface VoiceTurn { q: string; a: string; ts: number }
let voiceHistory: VoiceTurn[] = []
let voiceHistoryEnabled = true
const VOICE_HISTORY_MAX_TURNS = 15
const VOICE_HISTORY_CHAR_LIMIT = 2500

// Add interfaces for helper classes
export interface IProcessingHelperDeps {
  getScreenshotHelper: () => ScreenshotHelper | null
  getMainWindow: () => BrowserWindow | null
  getView: () => "queue" | "solutions" | "debug"
  setView: (view: "queue" | "solutions" | "debug") => void
  getProblemInfo: () => any
  setProblemInfo: (info: any) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  clearQueues: () => void
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  setHasDebugged: (value: boolean) => void
  getHasDebugged: () => boolean
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
}

export interface IShortcutsHelperDeps {
  getMainWindow: () => BrowserWindow | null
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  isVisible: () => boolean
  toggleMainWindow: () => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

export interface IIpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null
  setWindowDimensions: (width: number, height: number) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
  takeScreenshot: () => Promise<string>
  getView: () => "queue" | "solutions" | "debug"
  toggleMainWindow: () => void
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
  resetAll: () => void
}

// Initialize helpers
function initializeHelpers() {
  state.screenshotHelper = new ScreenshotHelper(state.view)
  state.processingHelper = new ProcessingHelper({
    getScreenshotHelper,
    getMainWindow,
    getView,
    setView,
    getProblemInfo,
    setProblemInfo,
    getScreenshotQueue,
    getExtraScreenshotQueue,
    clearQueues,
    takeScreenshot,
    getImagePreview,
    deleteScreenshot,
    setHasDebugged,
    getHasDebugged,
    PROCESSING_EVENTS: state.PROCESSING_EVENTS
  } as IProcessingHelperDeps)
  state.shortcutsHelper = new ShortcutsHelper({
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.isWindowVisible,
    toggleMainWindow,
    moveWindowLeft: () =>
      moveWindowHorizontal((x) =>
        Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
      ),
    moveWindowRight: () =>
      moveWindowHorizontal((x) =>
        Math.min(
          state.screenWidth - (state.windowSize?.width || 0) / 2,
          x + state.step
        )
      ),
    moveWindowUp: () => moveWindowVertical((y) => y - state.step),
    moveWindowDown: () => moveWindowVertical((y) => y + state.step)
  } as IShortcutsHelperDeps)
}

// Auth callback handler

// Register the interview-coder protocol
if (process.platform === "darwin") {
  app.setAsDefaultProtocolClient("interview-coder")
} else {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1] || "")
  ])
}

// Handle the protocol. In this case, we choose to show an Error Box.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1])
  ])
}

// Force Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on("second-instance", (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()

      // Protocol handler removed - no longer using auth callbacks
    }
  })
}

// Auth callback removed as we no longer use Supabase authentication

// Window management functions
async function createWindow(): Promise<void> {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workAreaSize
  state.screenWidth = workArea.width
  state.screenHeight = workArea.height
  state.step = 60
  state.currentY = 50

  const isMac = process.platform === 'darwin'
  const windowSettings: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    minWidth: 750,
    minHeight: 550,
    x: state.currentX,
    y: 50,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev
        ? path.join(__dirname, "../dist-electron/preload.js")
        : path.join(__dirname, "preload.js"),
      scrollBounce: true,
      // Use a separate session to avoid cache conflicts
      partition: 'persist:main'
    },
    show: true,
    frame: false,
    transparent: true,
    fullscreenable: false,
    hasShadow: false,
    opacity: 1.0,  // Start with full opacity
    backgroundColor: "#00000000",
    focusable: true,
    skipTaskbar: true,
    // NOTE: 'type: "panel"' on macOS can trigger: "NSWindow does not support nonactivating panel styleMask 0x80"
    // which leads to an unresponsive window. We remove it and rely on alwaysOnTop + custom styling.
    paintWhenInitiallyHidden: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    enableLargerThanScreen: true,
    movable: true
  }

  state.mainWindow = new BrowserWindow(windowSettings)

  // Add more detailed logging for window events
  state.mainWindow.webContents.on("did-finish-load", () => {
    console.log("Window finished loading")
  })
  state.mainWindow.webContents.on(
    "did-fail-load",
    async (event, errorCode, errorDescription) => {
      console.error("Window failed to load:", errorCode, errorDescription)
      if (isDev) {
        // In development, retry loading after a short delay
        console.log("Retrying to load development server...")
        setTimeout(() => {
          state.mainWindow?.loadURL("http://localhost:54321").catch((error) => {
            console.error("Failed to load dev server on retry:", error)
          })
        }, 1000)
      }
    }
  )

  if (isDev) {
    // In development, load from the dev server
    console.log("Loading from development server: http://localhost:54321")
    state.mainWindow.loadURL("http://localhost:54321").catch((error) => {
      console.error("Failed to load dev server, falling back to local file:", error)
      // Fallback to local file if dev server is not available
      const indexPath = path.join(__dirname, "../dist/index.html")
      console.log("Falling back to:", indexPath)
      if (fs.existsSync(indexPath)) {
        state.mainWindow.loadFile(indexPath)
      } else {
        console.error("Could not find index.html in dist folder")
      }
    })
  } else {
    // In production, load from the built files
    const indexPath = path.join(__dirname, "../dist/index.html")
    console.log("Loading production build:", indexPath)
    
    if (fs.existsSync(indexPath)) {
      state.mainWindow.loadFile(indexPath)
    } else {
      console.error("Could not find index.html in dist folder")
    }
  }

  // Configure window behavior
  state.mainWindow.webContents.setZoomFactor(1)
  if (isDev) {
    state.mainWindow.webContents.openDevTools()
  }
  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log("Attempting to open URL:", url)
    try {
      const parsedURL = new URL(url);
      const hostname = parsedURL.hostname;
      const allowedHosts = ["google.com", "supabase.co"];
      if (allowedHosts.includes(hostname) || hostname.endsWith(".google.com") || hostname.endsWith(".supabase.co")) {
        shell.openExternal(url);
        return { action: "deny" }; // Do not open this URL in a new Electron window
      }
    } catch (error) {
      console.error("Invalid URL %d in setWindowOpenHandler: %d" , url , error);
      return { action: "deny" }; // Deny access as URL string is malformed or invalid
    }
    return { action: "allow" };
  })

  // Enhanced screen capture resistance
  state.mainWindow.setContentProtection(true)

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  })
  state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)

  // Additional screen capture resistance settings
  if (process.platform === "darwin") {
    // Prevent window from being captured in screenshots
    state.mainWindow.setHiddenInMissionControl(true)
    state.mainWindow.setWindowButtonVisibility(false)
    state.mainWindow.setBackgroundColor("#00000000")

    // Prevent window from being included in window switcher
    state.mainWindow.setSkipTaskbar(true)

    // Disable window shadow
    state.mainWindow.setHasShadow(false)
  }

  // Prevent the window from being captured by screen recording
  state.mainWindow.webContents.setBackgroundThrottling(false)
  state.mainWindow.webContents.setFrameRate(60)

  // Set up window listeners
  state.mainWindow.on("move", handleWindowMove)
  state.mainWindow.on("resize", handleWindowResize)
  state.mainWindow.on("closed", handleWindowClosed)

  // Initialize window state
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.windowSize = { width: bounds.width, height: bounds.height }
  state.currentX = bounds.x
  state.currentY = bounds.y
  state.isWindowVisible = true
  
  // Set opacity based on user preferences or hide initially
  // Ensure the window is visible for the first launch or if opacity > 0.1
  const savedOpacity = configHelper.getOpacity();
  console.log(`Initial opacity from config: ${savedOpacity}`);
  
  // Always make sure window is shown first
  try {
    // showInactive on macOS combined with former panel type can cause non-activating issues; prefer normal show
    if (isMac) state.mainWindow.show(); else state.mainWindow.showInactive();
  } catch {
    state.mainWindow.show();
  }
  
  if (savedOpacity <= 0.1) {
    console.log('Initial opacity too low, setting to 0 and hiding window');
    state.mainWindow.setOpacity(0);
    state.isWindowVisible = false;
  } else {
    console.log(`Setting initial opacity to ${savedOpacity}`);
    state.mainWindow.setOpacity(savedOpacity);
    state.isWindowVisible = true;
  }
}

function handleWindowMove(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.currentX = bounds.x
  state.currentY = bounds.y
}

function handleWindowResize(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowSize = { width: bounds.width, height: bounds.height }
}

function handleWindowClosed(): void {
  state.mainWindow = null
  state.isWindowVisible = false
  state.windowPosition = null
  state.windowSize = null
}

// Window visibility functions
function hideMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    const bounds = state.mainWindow.getBounds();
    state.windowPosition = { x: bounds.x, y: bounds.y };
    state.windowSize = { width: bounds.width, height: bounds.height };
    state.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    state.mainWindow.setOpacity(0);
    state.isWindowVisible = false;
    console.log('Window hidden, opacity set to 0');
  }
}

function showMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    if (state.windowPosition && state.windowSize) {
      state.mainWindow.setBounds({
        ...state.windowPosition,
        ...state.windowSize
      });
    }
    state.mainWindow.setIgnoreMouseEvents(false);
    state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
    state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    state.mainWindow.setContentProtection(true);
    state.mainWindow.setOpacity(0); // Set opacity to 0 before showing
    state.mainWindow.showInactive(); // Use showInactive instead of show+focus
    state.mainWindow.setOpacity(1); // Then set opacity to 1 after showing
    state.isWindowVisible = true;
    console.log('Window shown with showInactive(), opacity set to 1');
  }
}

function toggleMainWindow(): void {
  console.log(`Toggling window. Current state: ${state.isWindowVisible ? 'visible' : 'hidden'}`);
  if (state.isWindowVisible) {
    hideMainWindow();
  } else {
    showMainWindow();
  }
}

// Window movement functions
function moveWindowHorizontal(updateFn: (x: number) => number): void {
  if (!state.mainWindow) return
  state.currentX = updateFn(state.currentX)
  state.mainWindow.setPosition(
    Math.round(state.currentX),
    Math.round(state.currentY)
  )
}

function moveWindowVertical(updateFn: (y: number) => number): void {
  if (!state.mainWindow) return

  const newY = updateFn(state.currentY)
  // Allow window to go 2/3 off screen in either direction
  const maxUpLimit = (-(state.windowSize?.height || 0) * 2) / 3
  const maxDownLimit =
    state.screenHeight + ((state.windowSize?.height || 0) * 2) / 3

  // Log the current state and limits
  console.log({
    newY,
    maxUpLimit,
    maxDownLimit,
    screenHeight: state.screenHeight,
    windowHeight: state.windowSize?.height,
    currentY: state.currentY
  })

  // Only update if within bounds
  if (newY >= maxUpLimit && newY <= maxDownLimit) {
    state.currentY = newY
    state.mainWindow.setPosition(
      Math.round(state.currentX),
      Math.round(state.currentY)
    )
  }
}

// Window dimension functions
function setWindowDimensions(width: number, height: number): void {
  if (!state.mainWindow?.isDestroyed()) {
    const [currentX, currentY] = state.mainWindow.getPosition()
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    const maxWidth = Math.floor(workArea.width * 0.5)

    state.mainWindow.setBounds({
      x: Math.min(currentX, workArea.width - maxWidth),
      y: currentY,
      width: Math.min(width + 32, maxWidth),
      height: Math.ceil(height)
    })
  }
}

// Environment setup
function loadEnvVariables() {
  if (isDev) {
    console.log("Loading env variables from:", path.join(process.cwd(), ".env"))
    dotenv.config({ path: path.join(process.cwd(), ".env") })
  } else {
    console.log(
      "Loading env variables from:",
      path.join(process.resourcesPath, ".env")
    )
    dotenv.config({ path: path.join(process.resourcesPath, ".env") })
  }
  console.log("Environment variables loaded for open-source version")
}

// Cache clearing function to fix corrupted cache issues
async function clearCorruptedCache() {
  try {
    const appDataPath = path.join(app.getPath('appData'), 'interview-coder-v1')
    const sessionPath = path.join(appDataPath, 'session')
    
    const cacheDirectories = [
      path.join(sessionPath, 'Shared Dictionary'),
      path.join(sessionPath, 'Cache'),
      path.join(sessionPath, 'GPUCache'),
      path.join(sessionPath, 'Local Storage'),
      path.join(sessionPath, 'Session Storage')
    ]
    
    for (const cacheDir of cacheDirectories) {
      if (fs.existsSync(cacheDir)) {
        try {
          fs.rmSync(cacheDir, { recursive: true, force: true })
          console.log(`Cleared corrupted cache directory: ${cacheDir}`)
        } catch (error) {
          console.warn(`Could not clear cache directory ${cacheDir}:`, error)
        }
      }
    }
  } catch (error) {
    console.warn('Error during cache cleanup:', error)
  }
}

// Initialize application
async function initializeApp() {
  try {
    // Set custom cache directory to prevent permission issues
    const appDataPath = path.join(app.getPath('appData'), 'interview-coder-v1')
    const sessionPath = path.join(appDataPath, 'session')
    const tempPath = path.join(appDataPath, 'temp')
    const cachePath = path.join(appDataPath, 'cache')
    
    // Clean up problematic cache directories before creating new ones
    const chromiumSharedDictCache = path.join(sessionPath, 'Shared Dictionary', 'cache')
    const chromiumCacheData = path.join(sessionPath, 'Cache', 'Cache_Data')
    
    // Remove existing cache directories if they exist and are corrupted
    const problematicDirs = [chromiumSharedDictCache, chromiumCacheData]
    for (const dir of problematicDirs) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true })
          console.log(`Removed corrupted cache directory: ${dir}`)
        } catch (error) {
          console.warn(`Could not remove cache directory ${dir}:`, error)
        }
      }
    }
    
    // Create directories if they don't exist
    for (const dir of [appDataPath, sessionPath, tempPath, cachePath]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
    
    // Set Electron app paths
    app.setPath('userData', appDataPath)
    app.setPath('sessionData', sessionPath)      
    app.setPath('temp', tempPath)
    app.setPath('cache', cachePath)
    
    // Add command line switches to handle cache issues
    app.commandLine.appendSwitch('--disable-http-cache')
    app.commandLine.appendSwitch('--disable-gpu-sandbox')
    app.commandLine.appendSwitch('--no-sandbox')
    app.commandLine.appendSwitch('--disable-web-security')
      
    loadEnvVariables()
    
    // Ensure a configuration file exists
    if (!configHelper.hasApiKey()) {
      console.log("No API key found in configuration. User will need to set up.")
    }
    
    initializeHelpers()
    initializeIpcHandlers({
      getMainWindow,
      setWindowDimensions,
      getScreenshotQueue,
      getExtraScreenshotQueue,
      deleteScreenshot,
      getImagePreview,
      processingHelper: state.processingHelper,
      PROCESSING_EVENTS: state.PROCESSING_EVENTS,
      takeScreenshot,
      getView,
      toggleMainWindow,
      clearQueues,
      setView,
      moveWindowLeft: () =>
        moveWindowHorizontal((x) =>
          Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
        ),
      moveWindowRight: () =>
        moveWindowHorizontal((x) =>
          Math.min(
            state.screenWidth - (state.windowSize?.width || 0) / 2,
            x + state.step
          )
        ),
      moveWindowUp: () => moveWindowVertical((y) => y - state.step),
      moveWindowDown: () => moveWindowVertical((y) => y + state.step),
      resetAll
    })
    await createWindow()
    state.shortcutsHelper?.registerGlobalShortcuts()

    // Register global shortcut for push-to-talk Voice Q&A
    try {
      const shortcut = 'CommandOrControl+M'
      if (globalShortcut.isRegistered(shortcut)) {
        logger.info('voice', 'Re-registering shortcut (was registered)')
        globalShortcut.unregister(shortcut)
      }
      const registered = globalShortcut.register(shortcut, () => {
        logger.info('voice', 'Shortcut pressed', { shortcut })
        state.mainWindow?.webContents.send(VOICE_EVENTS.START_TOGGLE)
      })
      if (registered) {
        logger.info('voice', 'Global shortcut registered', { shortcut })
      } else {
        logger.warn('voice', 'Failed to register global shortcut', { shortcut })
      }
    } catch (e) {
      logger.error('voice', 'Error registering global shortcut', { error: String(e) })
    }

    // Register global shortcut for full reset (screenshots, problem, voice history)
    try {
      const resetShortcut = 'CommandOrControl+R'
      if (globalShortcut.isRegistered(resetShortcut)) {
        globalShortcut.unregister(resetShortcut)
      }
      const registered = globalShortcut.register(resetShortcut, () => {
        logger.info('app', 'Global reset shortcut invoked', { resetShortcut })
        resetAll()
      })
      if (registered) {
        logger.info('app', 'Global reset shortcut registered', { resetShortcut })
      } else {
        logger.warn('app', 'Failed to register global reset shortcut', { resetShortcut })
      }
    } catch (e) {
      logger.error('app', 'Error registering reset shortcut', { error: String(e) })
    }

    // IPC handlers to set/get voice context
    ipcMain.handle(VOICE_EVENTS.SET_CONTEXT, (_evt, ctx: string) => {
      voiceContext = (ctx || '').slice(0, 4000) // limit size
      logger.info('voice', 'Context updated', { length: voiceContext.length })
      return { success: true }
    })
    ipcMain.handle(VOICE_EVENTS.GET_CONTEXT, () => ({ context: voiceContext }))
    ipcMain.handle(VOICE_EVENTS.SET_MODEL, (_evt, model: string) => {
      if (typeof model === 'string' && model.trim().length > 0) {
        voicePreferredModel = model.trim()
        logger.info('voice', 'Preferred model set', { model: voicePreferredModel })
        return { success: true, model: voicePreferredModel }
      }
      return { success: false, error: 'Invalid model' }
    })
    ipcMain.handle(VOICE_EVENTS.GET_MODEL, () => ({ model: voicePreferredModel }))
    ipcMain.handle(VOICE_EVENTS.GET_HISTORY, () => ({ history: voiceHistory }))
    ipcMain.handle(VOICE_EVENTS.CLEAR_HISTORY, () => { voiceHistory = []; logger.info('voice', 'History cleared'); return { success: true } })
    ipcMain.handle(VOICE_EVENTS.SET_HISTORY_ENABLED, (_evt, enabled: boolean) => {
      voiceHistoryEnabled = !!enabled
      logger.info('voice', 'History enabled set', { enabled: voiceHistoryEnabled })
      return { success: true, enabled: voiceHistoryEnabled }
    })
    ipcMain.handle(VOICE_EVENTS.GET_HISTORY_ENABLED, () => ({ enabled: voiceHistoryEnabled }))

    // Provide list of desktop (screen) sources for attempting system audio capture
    ipcMain.handle('desktop-audio-sources', async () => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 } })
        return { success: true, sources: sources.map(s => ({ id: s.id, name: s.name })) }
      } catch (e: any) {
        logger.error('voice', 'Failed to enumerate desktop audio sources', { error: String(e) })
        return { success: false, error: String(e) }
      }
    })

    // IPC handler: receive raw audio buffer -> save -> STT -> LLM answer (streaming)
    ipcMain.handle(VOICE_EVENTS.SAVE_AND_TRANSCRIBE, async (_evt, args: { buffer: ArrayBuffer; model?: string; language?: string }) => {
      if (voiceStreamingActive) {
        logger.warn('voice', 'Voice request ignored, streaming already active')
        return { success: false, error: 'Another voice request in progress' }
      }
      const startTs = Date.now()
      logPhase('voice', 'RECEIVED_AUDIO', { bytes: args?.buffer ? (args as any).buffer.byteLength : 0 })
      try {
        if (!args?.buffer) throw new Error('No audio buffer provided')
        const userDataDir = app.getPath('userData')
        const voiceDir = path.join(userDataDir, 'voice')
        if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true })
        // The renderer MediaRecorder produces webm chunks; save with .webm extension for downstream tools/ffmpeg
        const audioPath = path.join(voiceDir, `rec-${startTs}.webm`)
        fs.writeFileSync(audioPath, Buffer.from(args.buffer))
        logger.debug('voice', 'Audio file written', { audioPath })

        state.mainWindow?.webContents.send(VOICE_EVENTS.STATUS, { phase: 'stt', message: 'Transcribing…' })
        logPhase('voice', 'STT_START')

        const axios = (await import('axios')).default
        // Dynamically load form-data correctly (its export is CommonJS default). Fallback to global FormData if available (Node 18+ / undici).
        let FormDataCtor: any
        try {
          const mod: any = await import('form-data')
          FormDataCtor = mod?.default || mod
        } catch (importErr) {
          FormDataCtor = (global as any).FormData
          logger.warn('voice', 'form-data import failed, using global FormData fallback', { hasGlobal: !!FormDataCtor, error: String(importErr) })
        }
        if (!FormDataCtor) {
          throw new Error('FormData constructor unavailable (install form-data or upgrade Node)')
        }
        const form = new FormDataCtor()
        try {
          form.append('file', fs.createReadStream(audioPath), { filename: path.basename(audioPath) })
          form.append('language', args.language || 'en')
        } catch (formErr) {
          logger.error('voice', 'Failed building multipart form', { error: String(formErr) })
          throw new Error('Failed to prepare transcription request')
        }

        let transcription = ''
        let sttErrorDetails: any = null
        try {
          const sttStart = Date.now()
            const headers = typeof form.getHeaders === 'function' ? form.getHeaders() : {}
            const sttResp = await axios.post('http://127.0.0.1:17865/transcribe', form, { headers, timeout: 120000, maxContentLength: 25 * 1024 * 1024 })
          logDuration('voice', 'STT_HTTP', sttStart)
          transcription = sttResp.data?.text || sttResp.data?.transcription || sttResp.data?.result || ''
          logger.info('voice', 'Transcription result', { transcriptionPreview: transcription.slice(0,200) })
        } catch (err: any) {
          sttErrorDetails = err?.response?.data || err?.message
          logger.error('voice', 'STT failure', { error: sttErrorDetails })
          throw new Error('Transcription failed')
        }
        if (!transcription) throw new Error('Empty transcription result')
        logPhase('voice', 'STT_SUCCESS', { length: transcription.length })

  state.mainWindow?.webContents.send(VOICE_EVENTS.STATUS, { phase: 'llm', message: 'Generating answer…', question: transcription })
        logPhase('voice', 'LLM_START')

        // Streaming model selection
        const defaultModels = ['phi3:latest', 'mistral:latest', 'llama3', 'gemma3:12b-it-qat']
        let candidateModels: string[] = []
        if (args.model) {
          candidateModels = [args.model]
        } else if (voicePreferredModel) {
          candidateModels = [voicePreferredModel]
        }
        for (const dm of defaultModels) {
          if (!candidateModels.includes(dm)) candidateModels.push(dm)
        }
        logger.info('voice', 'Trying candidate models (streaming)', { candidates: candidateModels, contextLen: voiceContext.length, preferred: voicePreferredModel })
        const systemPrefix = voiceContext ? `Interview Context (use this perspective when answering):\n${voiceContext.trim()}\n\n` : ''
        // Build history section (oldest -> newest) within char limit
        let historySection = ''
        if (voiceHistoryEnabled && voiceHistory.length) {
          const selected: VoiceTurn[] = []
            let totalChars = 0
            for (let i = voiceHistory.length - 1; i >= 0; i--) {
              const turn = voiceHistory[i]
              const snippet = `Q: ${turn.q}\nA: ${turn.a}\n\n`
              const nextTotal = totalChars + snippet.length
              if (nextTotal > VOICE_HISTORY_CHAR_LIMIT) break
              selected.push(turn)
              totalChars = nextTotal
            }
            selected.reverse()
            if (selected.length) {
              historySection = 'Previous exchanges (context):\n' + selected.map(t => `Q: ${t.q}\nA: ${t.a}`).join('\n\n') + '\n\n'
            }
        }
        const promptBase = `${systemPrefix}${historySection}Question: ${transcription}\n\nAnswer:`
        const requestId = `${startTs}-${Math.random().toString(36).slice(2,8)}`
        // Inform renderer about the new question so it can render immediately
        state.mainWindow?.webContents.send(VOICE_EVENTS.STATUS, { phase: 'llm', message: 'Generating answer…', question: transcription, requestId })
  let usedModel: string | null = null
  let lastErr: any = null
  let answer = ''
        voiceStreamingActive = true
        for (const m of candidateModels) {
          try {
            const llmStart = Date.now()
            // Use fetch streaming API
            const controller = new AbortController()
            const bodyPayload = JSON.stringify({ model: m, prompt: promptBase, stream: true })
            const resp = await fetch('http://localhost:11434/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: bodyPayload,
              signal: controller.signal
            })
            if (!resp.ok || !resp.body) {
              throw new Error(`HTTP ${resp.status}`)
            }
            logDuration('voice', 'LLM_HTTP', llmStart)
            usedModel = m
            const reader = resp.body.getReader()
            const textDecoder = new TextDecoder()
            let chunkIndex = 0
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const txt = textDecoder.decode(value, { stream: true })
              const lines = txt.split('\n').filter(l => l.trim())
              for (const line of lines) {
                try {
                  const json = JSON.parse(line)
                  if (json.response) {
                    const delta = json.response
                    answer += delta
                    chunkIndex++
                    if (chunkIndex % 5 === 1) {
                      logger.debug('voice', 'Partial chunk', { model: m, chars: answer.length, chunks: chunkIndex })
                    }
                    state.mainWindow?.webContents.send(VOICE_EVENTS.PARTIAL, { requestId, delta, answer, model: m })
                  }
                  if (json.done) {
                    logPhase('voice', 'LLM_SUCCESS', { length: answer.length, chunks: chunkIndex, model: m })
                  }
                } catch (parseErr) {
                  logger.warn('voice', 'Failed to parse streaming line', { lineSnippet: line.slice(0,120) })
                }
              }
            }
            break // success with model m
          } catch (err: any) {
            lastErr = err
            logger.warn('voice', 'Streaming model attempt failed', { model: m, error: err?.message })
            usedModel = null
            answer = ''
            continue
          }
        }
        voiceStreamingActive = false
        if (!usedModel) {
          logger.error('voice', 'All streaming candidate models failed', { candidates: candidateModels, error: lastErr?.message })
          throw new Error('LLM generation failed for all models')
        }
        if (!answer) answer = 'No answer generated.'
        // Update history after successful completion
        if (voiceHistoryEnabled) {
          voiceHistory.push({ q: transcription, a: answer, ts: Date.now() })
          if (voiceHistory.length > VOICE_HISTORY_MAX_TURNS) {
            voiceHistory = voiceHistory.slice(-VOICE_HISTORY_MAX_TURNS)
          }
        }
        state.mainWindow?.webContents.send(VOICE_EVENTS.RESULT, { question: transcription, answer, model: usedModel, requestId })
        logDuration('voice', 'VOICE_PIPELINE_TOTAL', startTs)
        return { success: true, question: transcription, answer, model: usedModel, requestId }
      } catch (error: any) {
        const msg = error?.message || 'Voice processing failed'
        logger.error('voice', 'Pipeline error', { msg, stack: error?.stack })
        state.mainWindow?.webContents.send(VOICE_EVENTS.ERROR, msg)
        voiceStreamingActive = false
        return { success: false, error: msg }
      }
    })

    // Initialize auto-updater regardless of environment
    initAutoUpdater()
    console.log(
      "Auto-updater initialized in",
      isDev ? "development" : "production",
      "mode"
    )
  } catch (error) {
    console.error("Failed to initialize application:", error)
    app.quit()
  }
}

// Auth callback handling removed - no longer needed
app.on("open-url", (event, url) => {
  console.log("open-url event received:", url)
  event.preventDefault()
})

// Handle second instance (removed auth callback handling)
app.on("second-instance", (event, commandLine) => {
  console.log("second-instance event received:", commandLine)
  
  // Focus or create the main window
  if (!state.mainWindow) {
    createWindow()
  } else {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
  }
})

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      console.log('Application is quitting, performing cleanup...')
      app.quit()
      state.mainWindow = null
    }
  })
  
  app.on("before-quit", async () => {
    console.log('Application is about to quit, performing final cleanup...')
  })
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// State getter/setter functions
function getMainWindow(): BrowserWindow | null {
  return state.mainWindow
}

function getView(): "queue" | "solutions" | "debug" {
  return state.view
}

function setView(view: "queue" | "solutions" | "debug"): void {
  state.view = view
  state.screenshotHelper?.setView(view)
}

function getScreenshotHelper(): ScreenshotHelper | null {
  return state.screenshotHelper
}

function getProblemInfo(): any {
  return state.problemInfo
}

function setProblemInfo(problemInfo: any): void {
  state.problemInfo = problemInfo
}

function getScreenshotQueue(): string[] {
  return state.screenshotHelper?.getScreenshotQueue() || []
}

function getExtraScreenshotQueue(): string[] {
  return state.screenshotHelper?.getExtraScreenshotQueue() || []
}

function clearQueues(): void {
  state.screenshotHelper?.clearQueues()
  state.problemInfo = null
  setView("queue")
}

async function takeScreenshot(): Promise<string> {
  if (!state.mainWindow) throw new Error("No main window available")
  return (
    state.screenshotHelper?.takeScreenshot(
      () => hideMainWindow(),
      () => showMainWindow()
    ) || ""
  )
}

// Full reset function (invoked by shortcut or IPC) to clear all transient state
function resetAll(): void {
  try {
    logger.info('app', 'Performing full reset')
    // Cancel any processing
    state.processingHelper?.cancelOngoingRequests()
    // Clear screenshot queues & problem info
    clearQueues()
    setHasDebugged(false)
    setProblemInfo(null)
    // Preserve voiceContext per user request, but clear conversation history
    voiceHistory = []
    voiceStreamingActive = false
    // Notify renderer views
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('reset-view') // legacy event some UI listeners use
      state.mainWindow.webContents.send(state.PROCESSING_EVENTS.RESET)
      // Dedicated voice reset event so renderer can fully hide panel
      state.mainWindow.webContents.send('voice:reset')
    }
  } catch (e) {
    logger.error('app', 'Error during resetAll', { error: String(e) })
  }
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || ""
}

async function deleteScreenshot(
  path: string
): Promise<{ success: boolean; error?: string }> {
  return (
    state.screenshotHelper?.deleteScreenshot(path) || {
      success: false,
      error: "Screenshot helper not initialized"
    }
  )
}

function setHasDebugged(value: boolean): void {
  state.hasDebugged = value
}

function getHasDebugged(): boolean {
  return state.hasDebugged
}

// Export state and functions for other modules
export {
  state,
  createWindow,
  hideMainWindow,
  showMainWindow,
  toggleMainWindow,
  resetAll,
  setWindowDimensions,
  moveWindowHorizontal,
  moveWindowVertical,
  getMainWindow,
  getView,
  setView,
  getScreenshotHelper,
  getProblemInfo,
  setProblemInfo,
  getScreenshotQueue,
  getExtraScreenshotQueue,
  clearQueues,
  takeScreenshot,
  getImagePreview,
  deleteScreenshot,
  setHasDebugged,
  getHasDebugged
}

app.whenReady().then(async () => {
  await clearCorruptedCache()
  await initializeApp()
})
