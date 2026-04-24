import {
  Tray,
  Menu,
  nativeImage,
  BrowserWindow,
  NativeImage,
  screen,
  app,
} from "electron";
import { Store } from "./store";
import { CurrentUsageData, AppSettings } from "./types";
import { getProviderTokenStatus } from "./providers/usage/credentialReader";
import {
  ProviderUsageSnapshot,
  UsageProviderType,
} from "./providers/usage/types";
import * as path from "path";
import * as fs from "fs";

const DEFAULT_SETTINGS: AppSettings = {
  colors: {
    low: "#4caf50", // green
    medium: "#ff9800", // orange
    high: "#f44336", // red
  },
  toggleInterval: 2000, // Normal tray toggle cadence
  refreshInterval: 5, // 5 minutes
  shortcut: "CommandOrControl+Shift+T", // default shortcut
  proxyPort: 8780, // default proxy port
};

// Minimum character width for tray title to prevent layout shifts
// Covers: "     4%" to "   100%" (usage) and " 0h 05m" to "23h 59m" (time)
const MIN_TITLE_WIDTH = 7;

const getAssetsPath = () => {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, "..", "assets", "tray-icons");
  }
  return path.join(process.resourcesPath, "assets", "tray-icons");
};

const withDefaultSettings = (
  settings: Partial<AppSettings> | null | undefined,
): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  colors: {
    ...DEFAULT_SETTINGS.colors,
    ...(settings?.colors ?? {}),
  },
});

export class TrayManager {
  private mainWindow: BrowserWindow;
  private store: Store;
  private tray: Tray | null = null;
  private usageData: CurrentUsageData = {
    usage: 0,
    resetTime: null,
    sevenDay: null,
    providerName: "",
  };
  private showingUsage = true;
  private toggleIntervalId: NodeJS.Timeout | null = null;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private loggedOut = false;
  private suppressBlurHide = false;

  private staticIcon: NativeImage;

  constructor(mainWindow: BrowserWindow, store: Store) {
    this.mainWindow = mainWindow;
    this.store = store;
    this.settings = withDefaultSettings(store.get("settings"));
    this.staticIcon = this.loadStaticIcon();
  }

  private loadStaticIcon(): NativeImage {
    const assetsPath = getAssetsPath();
    // Template image: macOS auto-adapts for dark/light mode
    const iconPath = path.join(assetsPath, "idle", "idle_0Template.png");

    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      img.setTemplateImage(true);
      return img;
    }
    return nativeImage.createEmpty();
  }

  init(): void {
    this.tray = new Tray(this.staticIcon);
    this.tray.setTitle("--");

    this.setupContextMenu();
    this.setupClickHandler();
    this.loadProviders();
    this.startIntervals();
  }

  private loadProviders(): void {
    // Initial load is handled by usageStore (refresh called in main.ts)
  }

  refreshProviders(): void {
    // usageStore.refresh('claude') is called in main.ts
  }

  updateSettings(settings: AppSettings): void {
    this.settings = withDefaultSettings(settings);
    this.restartIntervals();
    this.updateTrayDisplay();
  }

  private setupContextMenu(): void {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Dashboard",
        click: () => this.showWindow(),
      },
      {
        label: "Settings...",
        click: () => {
          this.showWindow();
          this.mainWindow.webContents.send("navigate-to", "settings");
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit(),
      },
    ]);
    this.tray?.setContextMenu(contextMenu);
  }

  notifyBlur(): void {
    // Compatibility stub for external calls (unused)
  }

  private isMouseOverTray(): boolean {
    if (!this.tray) return false;
    const mouse = screen.getCursorScreenPoint();
    const bounds = this.tray.getBounds();
    const PAD = 30;
    return (
      mouse.x >= bounds.x - PAD &&
      mouse.x <= bounds.x + bounds.width + PAD &&
      mouse.y >= bounds.y - PAD &&
      mouse.y <= bounds.y + bounds.height + PAD
    );
  }

  /** Temporarily suppress blur-hide (e.g. when showing window from notification click) */
  suppressBlurHideOnce(): void {
    this.suppressBlurHide = true;
    // Auto-reset after a short delay in case focus settles
    setTimeout(() => {
      this.suppressBlurHide = false;
    }, 500);
  }

  private setupClickHandler(): void {
    this.mainWindow.on("blur", () => {
      if (this.suppressBlurHide) return;
      if (this.isMouseOverTray()) return;
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.hide();
      }
    });

    this.tray?.on("click", (_event, bounds) => {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.showWindow(bounds);
      }
    });
  }

  private showWindow(bounds?: Electron.Rectangle): void {
    if (!this.mainWindow || !this.tray) return;

    const trayBounds = bounds || this.tray.getBounds();
    const windowBounds = this.mainWindow.getBounds();

    const posX = Math.round(
      trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2,
    );
    const posY = trayBounds.y + trayBounds.height + 5;

    this.mainWindow.setPosition(posX, posY);
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  showWindowFromShortcut(): void {
    this.showWindow();
  }

  private startIntervals(): void {
    if (this.settings.toggleInterval <= 0) {
      this.toggleIntervalId = null;
      this.showingUsage = true;
      return;
    }
    this.toggleIntervalId = setInterval(() => {
      this.toggleDisplay();
    }, this.settings.toggleInterval);
  }

  private restartIntervals(): void {
    if (this.toggleIntervalId) {
      clearInterval(this.toggleIntervalId);
    }
    this.startIntervals();
  }

  private get isDestroyed(): boolean {
    return !this.tray || this.tray.isDestroyed();
  }

  /** usageStore.onChange callback: convert snapshot → usageData + update tray display */
  onSnapshotChanged(
    _provider: UsageProviderType,
    snapshot: ProviderUsageSnapshot | null,
  ): void {
    if (this.isDestroyed) return;

    // Check token status
    const tokenStatus = getProviderTokenStatus("claude");
    if (!tokenStatus.installed) {
      this.loggedOut = true;
      this.tray?.setTitle("N/A");
      this.tray?.setToolTip("Claude CLI not installed");
      return;
    }
    if (!tokenStatus.hasToken || tokenStatus.tokenExpired) {
      this.loggedOut = true;
      const label = tokenStatus.tokenExpired ? "EXP" : "LOGIN";
      this.tray?.setTitle(label);
      this.tray?.setToolTip(
        tokenStatus.tokenExpired
          ? "Claude token expired — run: claude /login"
          : "Claude login required — run: claude",
      );
      return;
    }

    if (this.loggedOut) {
      this.loggedOut = false;
    }

    if (snapshot && snapshot.windows && snapshot.windows.length > 0) {
      const session = snapshot.windows.find((w) => w.label === "Session");
      const weekly = snapshot.windows.find((w) => w.label === "Weekly");

      this.usageData = {
        usage: session?.usedPercent ?? 0,
        resetTime: session?.resetsAt ?? null,
        sevenDay: weekly
          ? {
              utilization: weekly.usedPercent ?? 0,
              resetsAt: weekly.resetsAt ?? null,
            }
          : null,
        providerName: snapshot.displayName ?? "Claude",
      };
    } else if (snapshot && snapshot.creditBalance) {
      this.usageData = {
        usage: 0,
        resetTime: null,
        sevenDay: null,
        providerName: snapshot.displayName ?? "Claude",
      };
      this.tray?.setTitle(`$${snapshot.creditBalance.balanceUSD.toFixed(0)}`);
      this.tray?.setToolTip(
        `Claude (Prepaid)\nBalance: $${snapshot.creditBalance.balanceUSD.toFixed(2)}`,
      );
      return;
    } else {
      this.usageData = {
        usage: 0,
        resetTime: null,
        sevenDay: null,
        providerName: "Claude",
      };
    }

    this.updateTrayDisplay();
  }

  private toggleDisplay(): void {
    if (this.isDestroyed) return;
    if (this.usageData.usage === undefined && this.usageData.usage !== 0)
      return;
    if (!this.usageData.providerName) return;

    this.showingUsage = !this.showingUsage;
    this.updateTrayDisplay();
  }

  private updateTrayDisplay(): void {
    if (this.isDestroyed) return;
    if (!this.usageData.providerName) return;

    const usage = this.usageData.usage;

    let text: string;
    if (this.showingUsage) {
      text = `${Math.round(usage)}%`;
    } else {
      text = this.getRemainingTime(this.usageData.resetTime);
    }

    // Pad to minimum width to prevent layout shifts
    this.tray?.setTitle(text.padStart(MIN_TITLE_WIDTH, " "));

    this.tray?.setToolTip(this.getTooltip());
  }

  private getRemainingTime(resetTime: string | null): string {
    if (!resetTime) return "--";

    const now = new Date();
    const reset = new Date(resetTime);
    const diffMs = reset.getTime() - now.getTime();

    if (diffMs <= 0) return "soon";

    const totalMin = Math.floor(diffMs / 1000 / 60);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;

    // Always show "Xh XXm" format for readability: "0h 05m", "1h 26m", "23h 59m"
    return `${hours}h ${mins.toString().padStart(2, "0")}m`;
  }

  private getTooltip(): string {
    const { usage, resetTime, providerName } = this.usageData;
    const remaining = this.getRemainingTime(resetTime);
    return `${providerName || "AI Token Monitor"}\nUsage: ${Math.round(usage || 0)}%\nResets in: ${remaining}`;
  }

  getCurrentUsageData(): CurrentUsageData & { settings: AppSettings } {
    return {
      ...this.usageData,
      settings: this.settings,
    };
  }

  cleanup(): void {
    if (this.toggleIntervalId) {
      clearInterval(this.toggleIntervalId);
    }
    if (this.tray) {
      this.tray.destroy();
    }
  }
}
