import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { AnalyzeInput, AnalyzeResult, AppSettings, TeamsStatus } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const isDev = !app.isPackaged;

const defaultSettings: AppSettings = {
  provider: "openai",
  openAiApiKey: "",
  openRouterApiKey: "",
  model: "gpt-4.1-mini",
  openRouterModel: "meta-llama/llama-3.2-3b-instruct:free",
  transcriptionModel: "gpt-4o-mini-transcribe",
  preferredLanguage: "Python",
  triggerHotkey: "CommandOrControl+Shift+Space",
  hideHotkey: "CommandOrControl+Shift+H",
  captureMode: "screen"
};

let cachedSettings: AppSettings = { ...defaultSettings };
let overlayWindow: BrowserWindow | null = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const filePath = settingsPath();
    if (!existsSync(filePath)) {
      cachedSettings = { ...defaultSettings };
      return cachedSettings;
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AppSettings>;
    cachedSettings = { ...defaultSettings, ...parsed };
  } catch {
    cachedSettings = { ...defaultSettings };
  }
  return cachedSettings;
}

function saveSettings(settings: AppSettings) {
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  cachedSettings = { ...defaultSettings, ...settings };
  writeFileSync(settingsPath(), JSON.stringify(cachedSettings, null, 2));
  return cachedSettings;
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 430,
    height: 680,
    minWidth: 340,
    minHeight: 420,
    x: 80,
    y: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.platform === "win32") {
    overlayWindow.setContentProtection(true);
  }

  if (isDev) {
    overlayWindow.loadURL("http://127.0.0.1:5173");
  } else {
    overlayWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const settings = cachedSettings;

  globalShortcut.register(settings.triggerHotkey, () => {
    overlayWindow?.webContents.send("shortcut:analyze");
  });

  globalShortcut.register(settings.hideHotkey, () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
      overlayWindow.webContents.send("shortcut:toggle-visibility");
    }
  });
}

async function getTeamsStatus(): Promise<TeamsStatus> {
  if (process.platform !== "win32") {
    return {
      detected: false,
      platform: process.platform,
      message: "Teams process detection is implemented for Windows. You can still run the UI on this OS for development."
    };
  }

  const processNames = ["ms-teams.exe", "Teams.exe", "msteams.exe"];

  try {
    const checks = await Promise.all(
      processNames.map(async (processName) => {
        const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `IMAGENAME eq ${processName}`]);
        return stdout.toLowerCase().includes(processName.toLowerCase());
      })
    );

    if (checks.some(Boolean)) {
      return {
        detected: true,
        platform: process.platform,
        message: "Microsoft Teams is running."
      };
    }

    return {
      detected: false,
      platform: process.platform,
      message: "Microsoft Teams is not detected. Checked new Teams and classic Teams processes."
    };
  } catch {
    // Some managed Windows machines block tasklist; PowerShell is a useful fallback.
  }

  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name ms-teams,Teams,msteams -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ProcessName"
    ]);
    const detected = stdout.trim().length > 0;
    return {
      detected,
      platform: process.platform,
      message: detected ? "Microsoft Teams is running." : "Microsoft Teams is not detected. Checked new Teams and classic Teams processes."
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      detected: false,
      platform: process.platform,
      message: `Could not check Microsoft Teams status. ${reason}`
    };
  }
}

async function capturePrimaryScreen(): Promise<string | undefined> {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(primary.size.width * primary.scaleFactor),
      height: Math.round(primary.size.height * primary.scaleFactor)
    }
  });

  const source = sources.find((item) => item.display_id === String(primary.id)) ?? sources[0];
  return source?.thumbnail.toDataURL();
}

function buildAssistantPrompt(input: AnalyzeInput, settings: AppSettings) {
  const modeInstruction =
    input.mode === "coding"
      ? `You are a discreet coding interview assistant. Produce a concise answer for the overlay. Prefer ${settings.preferredLanguage}. Include: key idea, steps, edge cases, time and space complexity, and code only if enough detail is visible.`
      : input.mode === "behavioral"
        ? "You are a behavioral interview coach. Produce a short spoken answer, then a STAR outline."
        : "You are a meeting copilot. Produce a concise response, summary, and next action.";

  return `${modeInstruction}

Use the screenshot and recent transcript together. If the screen does not contain a clear question, say what is missing and suggest one clarifying question.

Recent transcript:
${input.transcript || "(No transcript captured yet.)"}`;
}

async function callOpenAi(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string) {
  if (!settings.openAiApiKey) {
    return "Add your OpenAI API key in Settings, then press Analyze again.";
  }

  const content: Array<Record<string, string>> = [
    { type: "input_text", text: buildAssistantPrompt(input, settings) }
  ];

  if (screenshotDataUrl) {
    content.push({ type: "input_image", image_url: screenshotDataUrl });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      input: [
        {
          role: "user",
          content
        }
      ],
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  return (
    data.output_text ??
    data.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter(Boolean).join("\n") ??
    "No answer was returned."
  );
}

async function callOpenRouter(settings: AppSettings, input: AnalyzeInput) {
  if (!settings.openRouterApiKey) {
    return "Add your OpenRouter API key in Settings, then press Analyze again.";
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost/overlay-meetings",
      "X-Title": "Overlay Meetings"
    },
    body: JSON.stringify({
      model: settings.openRouterModel,
      messages: [
        {
          role: "system",
          content:
            "You are a concise meeting/interview overlay assistant. Keep answers compact and easy to read while someone is on a call."
        },
        {
          role: "user",
          content: `${buildAssistantPrompt(input, settings)}

Provider note: OpenRouter mode is currently text-only in this app. The screen was captured locally, but it was not sent to OpenRouter yet. Use the transcript/manual context below, and ask for missing screen details if needed.`
        }
      ],
      max_tokens: 900,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "No answer was returned.";
}

ipcMain.handle("settings:get", () => cachedSettings);

ipcMain.handle("settings:save", (_event, settings: AppSettings) => {
  saveSettings(settings);
  registerShortcuts();
  return cachedSettings;
});

ipcMain.handle("teams:status", () => getTeamsStatus());

ipcMain.handle("window:click-through", (_event, enabled: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(enabled, { forward: true });
});

ipcMain.handle("window:hide", () => {
  overlayWindow?.hide();
});

ipcMain.handle("assistant:analyze", async (_event, input: AnalyzeInput): Promise<AnalyzeResult> => {
  const settings = cachedSettings;
  const [screenshotDataUrl, teams] = await Promise.all([capturePrimaryScreen(), getTeamsStatus()]);
  const answer =
    settings.provider === "openrouter"
      ? await callOpenRouter(settings, input)
      : await callOpenAi(settings, input, screenshotDataUrl);

  return {
    answer,
    screenshotDataUrl,
    teamsDetected: teams.detected
  };
});

app.whenReady().then(() => {
  loadSettings();
  createOverlayWindow();
  registerShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
