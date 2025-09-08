import { globalShortcut, app } from "electron"
import { logger } from './logger'
import { IShortcutsHelperDeps } from "./main"
import { configHelper } from "./ConfigHelper"

export class ShortcutsHelper {
  private deps: IShortcutsHelperDeps

  constructor(deps: IShortcutsHelperDeps) {
    this.deps = deps
  }

  private adjustOpacity(delta: number): void {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return;
    
    let currentOpacity = mainWindow.getOpacity();
    let newOpacity = Math.max(0.1, Math.min(1.0, currentOpacity + delta));
    console.log(`Adjusting opacity from ${currentOpacity} to ${newOpacity}`);
    
    mainWindow.setOpacity(newOpacity);
    
    // Save the opacity setting to config without re-initializing the client
    try {
      const config = configHelper.loadConfig();
      config.opacity = newOpacity;
      configHelper.saveConfig(config);
    } catch (error) {
      console.error('Error saving opacity to config:', error);
    }
    
    // If we're making the window visible, also make sure it's shown and interaction is enabled
    if (newOpacity > 0.1 && !this.deps.isVisible()) {
      this.deps.toggleMainWindow();
    }
  }

  public registerGlobalShortcuts(): void {
    const register = (accelerator: string, handler: () => void) => {
      const ok = globalShortcut.register(accelerator, handler)
      if (ok) logger.info('shortcut', 'Registered', { accelerator })
      else logger.warn('shortcut', 'Failed to register', { accelerator })
    }

    register("CommandOrControl+H", async () => {
      logger.info('shortcut', 'Pressed', { key: 'H', action: 'take_screenshot' })
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          const screenshotPath = await this.deps.takeScreenshot()
          const preview = await this.deps.getImagePreview(screenshotPath)
          mainWindow.webContents.send("screenshot-taken", {
            path: screenshotPath,
            preview
          })
        } catch (error) {
          logger.error('shortcut', 'Error capturing screenshot', { error: String(error) })
        }
      }
    })

    register("CommandOrControl+Enter", async () => {
      logger.info('shortcut', 'Pressed', { key: 'Enter', action: 'process_screenshots' })
      await this.deps.processingHelper?.processScreenshots()
    })

    register("CommandOrControl+R", () => {
      logger.info('shortcut', 'Pressed', { key: 'R', action: 'reset' })

      // Cancel ongoing API requests
      this.deps.processingHelper?.cancelOngoingRequests()

      // Clear both screenshot queues
      this.deps.clearQueues()

      console.log("Cleared queues.")

      // Update the view state to 'queue'
      this.deps.setView("queue")

      // Notify renderer process to switch view to 'queue'
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view")
        mainWindow.webContents.send("reset")
      }
    })

    // New shortcuts for moving the window
    register("CommandOrControl+Left", () => {
      logger.info('shortcut', 'Pressed', { key: 'Left', action: 'move_left' })
      this.deps.moveWindowLeft()
    })

    register("CommandOrControl+Right", () => {
      logger.info('shortcut', 'Pressed', { key: 'Right', action: 'move_right' })
      this.deps.moveWindowRight()
    })

    register("CommandOrControl+Down", () => {
      logger.info('shortcut', 'Pressed', { key: 'Down', action: 'move_down' })
      this.deps.moveWindowDown()
    })

    register("CommandOrControl+Up", () => {
      logger.info('shortcut', 'Pressed', { key: 'Up', action: 'move_up' })
      this.deps.moveWindowUp()
    })

    register("CommandOrControl+B", () => {
      logger.info('shortcut', 'Pressed', { key: 'B', action: 'toggle_window' })
      this.deps.toggleMainWindow()
    })

    register("CommandOrControl+Q", () => {
      logger.info('shortcut', 'Pressed', { key: 'Q', action: 'quit' })
      app.quit()
    })

    // Adjust opacity shortcuts
    register("CommandOrControl+[", () => {
      logger.info('shortcut', 'Pressed', { key: '[', action: 'opacity_down' })
      this.adjustOpacity(-0.1)
    })

    register("CommandOrControl+]", () => {
      logger.info('shortcut', 'Pressed', { key: ']', action: 'opacity_up' })
      this.adjustOpacity(0.1)
    })
    
    // Zoom controls
    register("CommandOrControl+-", () => {
      logger.info('shortcut', 'Pressed', { key: '-', action: 'zoom_out' })
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        const currentZoom = mainWindow.webContents.getZoomLevel()
        mainWindow.webContents.setZoomLevel(currentZoom - 0.5)
      }
    })
    
    register("CommandOrControl+0", () => {
      logger.info('shortcut', 'Pressed', { key: '0', action: 'zoom_reset' })
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.setZoomLevel(0)
      }
    })
    
    register("CommandOrControl+=", () => {
      logger.info('shortcut', 'Pressed', { key: '=', action: 'zoom_in' })
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        const currentZoom = mainWindow.webContents.getZoomLevel()
        mainWindow.webContents.setZoomLevel(currentZoom + 0.5)
      }
    })
    
    // Delete last screenshot shortcut
    register("CommandOrControl+L", () => {
      logger.info('shortcut', 'Pressed', { key: 'L', action: 'delete_last_screenshot' })
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        // Send an event to the renderer to delete the last screenshot
        mainWindow.webContents.send("delete-last-screenshot")
      }
    })
    
    // Unregister shortcuts when quitting
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
    })
  }
}
