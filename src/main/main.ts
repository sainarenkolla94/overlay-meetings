import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type {
  AnalyzeInput,
  AnalyzeResult,
  AppSettings,
  DesktopAudioSource,
  TeamsStatus,
  TranscribeAudioInput,
  TranscribeAudioResult,
  WindowNudgeDirection,
  WindowSnapPosition
} from "../shared/types.js";

const execFileAsync = promisify(execFile);
const isDev = !app.isPackaged;

const defaultSettings: AppSettings = {
  provider: "openai",
  transcriptionProvider: "openai",
  openAiApiKey: "",
  openRouterApiKey: "",
  geminiApiKey: "",
  groqApiKey: "",
  model: "gpt-4.1-mini",
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  geminiModel: "gemini-2.5-flash",
  sendScreenshotToOpenRouter: true,
  sendScreenshotToGemini: true,
  transcriptionModel: "gpt-4o-mini-transcribe",
  groqTranscriptionModel: "whisper-large-v3-turbo",
  preferredLanguage: "Python",
  triggerHotkey: "CommandOrControl+Shift+Space",
  hideHotkey: "CommandOrControl+Shift+H",
  autoAnalyzeIntervalSeconds: 20,
  captureMode: "screen"
};

let cachedSettings: AppSettings = { ...defaultSettings };
let overlayWindow: BrowserWindow | null = null;
const fullSize = { width: 430, height: 680 };
const compactSize = { width: 360, height: 280 };

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

  globalShortcut.register("CommandOrControl+Alt+Up", () => nudgeWindow("up"));
  globalShortcut.register("CommandOrControl+Alt+Down", () => nudgeWindow("down"));
  globalShortcut.register("CommandOrControl+Alt+Left", () => nudgeWindow("left"));
  globalShortcut.register("CommandOrControl+Alt+Right", () => nudgeWindow("right"));
}

function nudgeWindow(direction: WindowNudgeDirection, amount = 24) {
  if (!overlayWindow) return;
  const bounds = overlayWindow.getBounds();
  const next = { x: bounds.x, y: bounds.y };

  if (direction === "up") next.y -= amount;
  if (direction === "down") next.y += amount;
  if (direction === "left") next.x -= amount;
  if (direction === "right") next.x += amount;

  overlayWindow.setBounds({ ...bounds, ...next }, true);
}

function snapWindow(position: WindowSnapPosition) {
  if (!overlayWindow) return;
  const bounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const margin = 16;
  const x = position.endsWith("right") ? area.x + area.width - bounds.width - margin : area.x + margin;
  const y = position.startsWith("bottom") ? area.y + area.height - bounds.height - margin : area.y + margin;

  overlayWindow.setBounds({ ...bounds, x, y }, true);
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

async function getDesktopAudioSources(): Promise<DesktopAudioSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1, height: 1 }
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name
  }));
}

function base64ToFile(base64Audio: string, mimeType: string) {
  const bytes = Buffer.from(base64Audio, "base64");
  const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "wav";
  const blob = new Blob([bytes], { type: mimeType });
  return new File([blob], `audio-chunk.${extension}`, { type: mimeType });
}

function dataUrlToInlineData(dataUrl: string) {
  const match = /^data:(?<mimeType>[^;]+);base64,(?<data>.+)$/.exec(dataUrl);
  if (!match?.groups) return undefined;
  return {
    mimeType: match.groups.mimeType,
    data: match.groups.data
  };
}

async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  if (cachedSettings.transcriptionProvider === "groq") {
    return transcribeWithGroq(input);
  }

  return transcribeWithOpenAi(input);
}

async function transcribeWithOpenAi(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  if (!cachedSettings.openAiApiKey) {
    throw new Error("OpenAI API key is required for OpenAI audio transcription. Switch transcription provider to Groq to use a Groq API key.");
  }

  const body = new FormData();
  body.append("model", cachedSettings.transcriptionModel);
  body.append("file", base64ToFile(input.base64Audio, input.mimeType));
  body.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cachedSettings.openAiApiKey}`
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transcription failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { text?: string };
  return { text: data.text?.trim() ?? "" };
}

async function transcribeWithGroq(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  if (!cachedSettings.groqApiKey) {
    throw new Error("Groq API key is required for Groq audio transcription.");
  }

  const body = new FormData();
  body.append("model", cachedSettings.groqTranscriptionModel);
  body.append("file", base64ToFile(input.base64Audio, input.mimeType));
  body.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cachedSettings.groqApiKey}`
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq transcription failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { text?: string };
  return { text: data.text?.trim() ?? "" };
}

function buildAssistantPrompt(input: AnalyzeInput, settings: AppSettings) {
  const modeInstruction =
    input.mode === "coding"
      ? `You are a discreet coding interview assistant. Produce a concise answer for the overlay. Prefer ${settings.preferredLanguage}. Include: key idea, steps, edge cases, time and space complexity, and code only if enough detail is visible.`
      : input.mode === "behavioral"
        ? "You are a behavioral interview coach. Produce a short spoken answer, then a STAR outline."
        : "You are a meeting copilot. Produce a concise response, summary, and next action.";

  return `${modeInstruction}

Use the screenshot and recent transcript together. If a screenshot is attached, read the visible screen content directly even when the transcript is empty. Prioritize visible problem statements, code, examples, constraints, and error messages from the screenshot. Only say content is missing if neither the screenshot nor transcript contains enough detail.

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

async function callOpenRouter(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string) {
  if (!settings.openRouterApiKey) {
    return "Add your OpenRouter API key in Settings, then press Analyze again.";
  }

  const prompt = buildAssistantPrompt(input, settings);
  const userContent =
    settings.sendScreenshotToOpenRouter && screenshotDataUrl
      ? [
          {
            type: "text",
            text: `${prompt}

Provider note: OpenRouter screenshot mode is enabled. Use the image and any transcript/manual context together. If the image is unclear, ask for the missing details.`
          },
          {
            type: "image_url",
            image_url: {
              url: screenshotDataUrl
            }
          }
        ]
      : `${prompt}

Provider note: OpenRouter screenshot mode is disabled, so use only the transcript/manual context. Ask for screen details if needed.`;

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
          content: userContent
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
    error?: { message?: string; code?: string | number };
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | Array<{ text?: string; type?: string }>;
      };
      text?: string;
    }>;
  };

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message ?? data.error.code ?? "unknown error"}`);
  }

  const firstChoice = data.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content.map((item) => item.text).filter(Boolean).join("\n").trim();
    if (text) return text;
  }

  if (firstChoice?.text?.trim()) {
    return firstChoice.text;
  }

  const finishReason = firstChoice?.finish_reason ? ` Finish reason: ${firstChoice.finish_reason}.` : "";
  return `OpenRouter returned no message content.${finishReason}

Try a different specific free model in Settings, for example one currently listed at:
https://openrouter.ai/models?max_price=0

Raw response:
${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}

async function callGemini(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string) {
  if (!settings.geminiApiKey) {
    return "Add your Gemini API key in Settings, then press Analyze again.";
  }

  const parts: Array<Record<string, unknown>> = [
    {
      text: `${buildAssistantPrompt(input, settings)}

Provider note: Gemini mode is enabled. A screenshot image part is attached when screenshot sending is enabled. If the transcript is empty, inspect the screenshot and answer from the visible screen content. Keep the response compact for an overlay.`
    }
  ];

  const inlineData = screenshotDataUrl && settings.sendScreenshotToGemini ? dataUrlToInlineData(screenshotDataUrl) : undefined;
  if (inlineData) {
    parts.push({
      inline_data: {
        mime_type: inlineData.mimeType,
        data: inlineData.data
      }
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": settings.geminiApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 900
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message ?? "unknown error"}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (text) return text;

  const finishReason = data.candidates?.[0]?.finishReason ? ` Finish reason: ${data.candidates[0].finishReason}.` : "";
  return `Gemini returned no message content.${finishReason}

Raw response:
${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}

ipcMain.handle("settings:get", () => cachedSettings);

ipcMain.handle("settings:save", (_event, settings: AppSettings) => {
  saveSettings(settings);
  registerShortcuts();
  return cachedSettings;
});

ipcMain.handle("teams:status", () => getTeamsStatus());

ipcMain.handle("audio:sources", () => getDesktopAudioSources());

ipcMain.handle("audio:transcribe", (_event, input: TranscribeAudioInput) => transcribeAudio(input));

ipcMain.handle("window:click-through", (_event, enabled: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(enabled, { forward: true });
});

ipcMain.handle("window:resizable", (_event, enabled: boolean) => {
  overlayWindow?.setResizable(enabled);
});

ipcMain.handle("window:compact", (_event, enabled: boolean) => {
  if (!overlayWindow) return;
  overlayWindow.setResizable(!enabled);
  overlayWindow.setSize(enabled ? compactSize.width : fullSize.width, enabled ? compactSize.height : fullSize.height, true);
});

ipcMain.handle("window:nudge", (_event, direction: WindowNudgeDirection, amount?: number) => {
  nudgeWindow(direction, amount);
});

ipcMain.handle("window:snap", (_event, position: WindowSnapPosition) => {
  snapWindow(position);
});

ipcMain.handle("window:hide", () => {
  overlayWindow?.hide();
});

ipcMain.handle("assistant:analyze", async (_event, input: AnalyzeInput): Promise<AnalyzeResult> => {
  const settings = cachedSettings;
  const [screenshotDataUrl, teams] = await Promise.all([capturePrimaryScreen(), getTeamsStatus()]);
  const answer =
    settings.provider === "openrouter"
      ? await callOpenRouter(settings, input, screenshotDataUrl)
      : settings.provider === "gemini"
        ? await callGemini(settings, input, screenshotDataUrl)
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
