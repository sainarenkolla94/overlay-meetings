import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, screen } from "electron";
import type { Rectangle } from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { createWorker } from "tesseract.js";
import type {
  AnalyzeInput,
  AnalyzeResult,
  AppSettings,
  CaptureContextResult,
  CaptureSource,
  DesktopAudioSource,
  ExportSessionInput,
  ExportSessionResult,
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
  captureSourceId: "",
  captureMode: "screen"
};

let cachedSettings: AppSettings = { ...defaultSettings };
let overlayWindow: BrowserWindow | null = null;
const fullSize = { width: 460, height: 860 };
const compactSize = { width: 430, height: 520 };
const launcherSize = { width: 62, height: 62 };
const minimumSize = { width: 340, height: 420 };
let restoreBounds: Rectangle | null = null;
let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

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

function slugDate() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportSession(input: ExportSessionInput): ExportSessionResult {
  const sessionsDirectory = path.join(app.getPath("documents"), "Overlay Meetings Sessions");
  mkdirSync(sessionsDirectory, { recursive: true });
  const filePath = path.join(sessionsDirectory, `session-${slugDate()}.md`);
  const history = input.history
    .map(
      (item, index) => `### ${index + 1}. ${item.createdAt} · ${item.mode}

${item.answer}`
    )
    .join("\n\n");

  const contents = `# Overlay Meetings Session

- Provider: ${input.metadata.provider}
- Transcription provider: ${input.metadata.transcriptionProvider}
- Started at: ${input.metadata.startedAt ?? "Not recorded"}
- Exported at: ${input.metadata.exportedAt}

## Current Answer

${input.answer || "(No answer.)"}

## Transcript

${input.transcript || "(No transcript.)"}

## Screen Context

${input.screenContext || "(No saved screen context.)"}

## Suggestion History

${history || "(No suggestion history.)"}
`;

  writeFileSync(filePath, contents, "utf8");
  return { filePath };
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: compactSize.width,
    height: compactSize.height,
    minWidth: minimumSize.width,
    minHeight: minimumSize.height,
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

  const sendAction = (action: string) => {
    overlayWindow?.webContents.send("shortcut:global-action", action);
  };

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
  globalShortcut.register("CommandOrControl+Alt+C", () => sendAction("add-context"));
  globalShortcut.register("CommandOrControl+Alt+X", () => sendAction("clear-context"));
  globalShortcut.register("CommandOrControl+Alt+D", () => sendAction("toggle-detect"));
  globalShortcut.register("CommandOrControl+Alt+A", () => sendAction("toggle-audio"));
  globalShortcut.register("CommandOrControl+Alt+K", () => sendAction("copy-answer"));
  globalShortcut.register("CommandOrControl+Alt+P", () => sendAction("toggle-click-through"));
  globalShortcut.register("CommandOrControl+Alt+V", () => sendAction("cycle-view"));
  globalShortcut.register("CommandOrControl+Alt+B", () => sendAction("toggle-bubble"));
}

function nudgeWindow(direction: WindowNudgeDirection, amount = 24) {
  if (!overlayWindow) return;
  const bounds = overlayWindow.getBounds();
  const next = { x: bounds.x, y: bounds.y };

  if (direction === "up") next.y -= amount;
  if (direction === "down") next.y += amount;
  if (direction === "left") next.x -= amount;
  if (direction === "right") next.x += amount;

  overlayWindow.setBounds({ ...bounds, ...next }, false);
}

function snapWindow(position: WindowSnapPosition) {
  if (!overlayWindow) return;
  const bounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const margin = 16;
  const x = position.endsWith("right") ? area.x + area.width - bounds.width - margin : area.x + margin;
  const y = position.startsWith("bottom") ? area.y + area.height - bounds.height - margin : area.y + margin;

  overlayWindow.setBounds({ ...bounds, x, y }, false);
}

function setLauncherMode(enabled: boolean) {
  if (!overlayWindow) return;
  const currentBounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const area = display.workArea;
  const margin = 18;

  if (enabled) {
    restoreBounds = currentBounds;
    overlayWindow.setResizable(false);
    overlayWindow.setMinimumSize(launcherSize.width, launcherSize.height);
    overlayWindow.setBounds(
      {
        x: area.x + area.width - launcherSize.width - margin,
        y: area.y + area.height - launcherSize.height - margin,
        width: launcherSize.width,
        height: launcherSize.height
      },
      false
    );
    return;
  }

  overlayWindow.setResizable(true);
  overlayWindow.setMinimumSize(minimumSize.width, minimumSize.height);
  const nextBounds = restoreBounds ?? {
    x: area.x + area.width - compactSize.width - margin,
    y: area.y + area.height - compactSize.height - margin,
    width: compactSize.width,
    height: compactSize.height
  };
  overlayWindow.setBounds(nextBounds, false);
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
  const displaySize = {
    width: Math.round(primary.size.width * primary.scaleFactor),
    height: Math.round(primary.size.height * primary.scaleFactor)
  };
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: displaySize
  });

  const source =
    sources.find((item) => item.id === cachedSettings.captureSourceId) ??
    sources.find((item) => item.display_id === String(primary.id)) ??
    sources[0];
  return source?.thumbnail.toDataURL();
}

async function getCaptureSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 240, height: 160 }
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith("screen:") ? "screen" : "window"
  }));
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

function prepareScreenshotForProvider(dataUrl?: string) {
  if (!dataUrl) return undefined;
  const image = nativeImage.createFromDataURL(dataUrl);
  const size = image.getSize();
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(size.width, size.height));
  const resized =
    scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: "best"
        })
      : image;

  const jpeg = resized.toJPEG(82).toString("base64");
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg}`,
    width: resized.getSize().width,
    height: resized.getSize().height,
    mimeType: "image/jpeg"
  };
}

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker("eng", 1, {
      logger: () => undefined
    });
  }
  return ocrWorker;
}

async function extractOcrText(screenshotDataUrl?: string) {
  if (!screenshotDataUrl) return "";
  try {
    const prepared = prepareScreenshotForProvider(screenshotDataUrl);
    if (!prepared) return "";
    const worker = await getOcrWorker();
    const result = await worker.recognize(prepared.dataUrl);
    return result.data.text.replace(/\s+\n/g, "\n").trim().slice(0, 6000);
  } catch (error) {
    console.warn("OCR failed", error);
    return "";
  }
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

function buildAssistantPrompt(input: AnalyzeInput, settings: AppSettings, ocrText = "") {
  const modeInstruction =
    input.mode === "coding"
      ? `You are a discreet coding interview assistant. Produce a concise answer for the overlay. Prefer ${settings.preferredLanguage}. Include: key idea, steps, edge cases, time and space complexity, and code only if enough detail is visible.`
      : input.mode === "behavioral"
        ? "You are a behavioral interview coach. Produce a short spoken answer, then a STAR outline."
        : "You are a meeting copilot. Produce a concise response, summary, and next action.";

  return `${modeInstruction}

Use the screenshot and recent transcript together. If a screenshot is attached, read the visible screen content directly even when the transcript is empty. Prioritize visible problem statements, code, examples, constraints, and error messages from the screenshot. Only say content is missing if neither the screenshot nor transcript contains enough detail.

If accumulated screen context is present, treat it as the primary source because it may contain multiple screenshots, multiple pages, and multiple questions. Captures are labeled as "--- Capture 1 ---", "--- Capture 2 ---", and so on. Read every capture block in order, combine related fragments across adjacent captures, and use the latest screenshot/OCR only as additional context, not as a replacement for accumulated screen context.

If the content contains multiple questions across one or more capture blocks, answer every detected question. Do not stop after the first question and do not answer only the latest capture.

If the content is multiple choice, do not provide a coding solution format or explanations. Return only a compact answer key:
1. <short question identifier if useful>: <option letter/number>. <option text if visible>
2. <short question identifier if useful>: <option letter/number>. <option text if visible>
Keep identifiers brief, such as the first few words or topic name. Do not repeat long questions. Continue numbering until every visible question is answered. If options are split across captures, compare all visible options before choosing. If a specific question cannot be determined, include that question number and say what is missing.

For non-MCQ coding questions, return a complete answer using this exact structure:
Detected:
Approach:
Code:
Complexity:
Edge cases:
Do not stop mid-sentence. Keep code compact but complete.

Recent transcript:
${input.transcript || "(No transcript captured yet.)"}

Accumulated screen context:
${input.screenContext || "(No accumulated screen context.)"}

OCR extracted from screenshot:
${ocrText || "(No OCR text extracted.)"}`;
}

async function callOpenAi(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string, ocrText = "") {
  if (!settings.openAiApiKey) {
    return "Add your OpenAI API key in Settings, then press Analyze again.";
  }

  const content: Array<Record<string, string>> = [
    { type: "input_text", text: buildAssistantPrompt(input, settings, ocrText) }
  ];

  const preparedScreenshot = prepareScreenshotForProvider(screenshotDataUrl);
  if (preparedScreenshot) {
    content.push({ type: "input_image", image_url: preparedScreenshot.dataUrl });
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
      max_output_tokens: 1600
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

async function callOpenRouter(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string, ocrText = "") {
  if (!settings.openRouterApiKey) {
    return "Add your OpenRouter API key in Settings, then press Analyze again.";
  }

  const prompt = buildAssistantPrompt(input, settings, ocrText);
  const preparedScreenshot = prepareScreenshotForProvider(screenshotDataUrl);
  const userContent =
    settings.sendScreenshotToOpenRouter && preparedScreenshot
      ? [
          {
            type: "text",
            text: `${prompt}

Provider note: OpenRouter screenshot mode is enabled. Use the image and any transcript/manual context together. If the image is unclear, ask for the missing details.`
          },
          {
            type: "image_url",
            image_url: {
              url: preparedScreenshot.dataUrl
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
      max_tokens: 1600,
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

async function callGemini(settings: AppSettings, input: AnalyzeInput, screenshotDataUrl?: string, ocrText = "") {
  if (!settings.geminiApiKey) {
    return "Add your Gemini API key in Settings, then press Analyze again.";
  }

  const preparedScreenshot = prepareScreenshotForProvider(screenshotDataUrl);
  const parts: Array<Record<string, unknown>> = [
    {
      text: `${buildAssistantPrompt(input, settings, ocrText)}

Provider note: Gemini mode is enabled. A screenshot image part is attached when screenshot sending is enabled. If the transcript is empty, inspect the screenshot and answer from the visible screen content.
Screenshot status: ${settings.sendScreenshotToGemini && preparedScreenshot ? `attached as ${preparedScreenshot.mimeType}, ${preparedScreenshot.width}x${preparedScreenshot.height}` : "not attached"}.

Before answering, silently read all accumulated screen context plus the latest screenshot. If you can see a multiple-choice question, answer with the option only and a short reason. If you can see a non-MCQ coding problem, start with "Detected:" followed by a 1-line problem summary, then give the concise overlay answer. Do not ask for the problem statement unless the screenshot/context is blank, unreadable, or unrelated.`
    }
  ];

  const inlineData = settings.sendScreenshotToGemini && preparedScreenshot ? dataUrlToInlineData(preparedScreenshot.dataUrl) : undefined;
  if (inlineData) {
    parts.unshift({
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
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingBudget: 0
          }
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

  const firstCandidate = data.candidates?.[0];
  const text = firstCandidate?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (text) {
    return firstCandidate?.finishReason && firstCandidate.finishReason !== "STOP"
      ? `${text}

[Gemini finish reason: ${firstCandidate.finishReason}]`
      : text;
  }

  const finishReason = firstCandidate?.finishReason ? ` Finish reason: ${firstCandidate.finishReason}.` : "";
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

ipcMain.handle("capture:sources", () => getCaptureSources());

ipcMain.handle("capture:context", async (): Promise<CaptureContextResult> => {
  const screenshotDataUrl = await capturePrimaryScreen();
  const ocrText = await extractOcrText(screenshotDataUrl);
  return {
    screenshotDataUrl,
    ocrText
  };
});

ipcMain.handle("audio:sources", () => getDesktopAudioSources());

ipcMain.handle("audio:transcribe", (_event, input: TranscribeAudioInput) => transcribeAudio(input));

ipcMain.handle("session:export", (_event, input: ExportSessionInput) => exportSession(input));

ipcMain.handle("window:click-through", (_event, enabled: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(enabled, { forward: true });
});

ipcMain.handle("window:resizable", (_event, enabled: boolean) => {
  overlayWindow?.setResizable(enabled);
});

ipcMain.handle("window:compact", (_event, enabled: boolean) => {
  if (!overlayWindow) return;
  overlayWindow.setResizable(!enabled);
  overlayWindow.setSize(enabled ? compactSize.width : fullSize.width, enabled ? compactSize.height : fullSize.height, false);
});

ipcMain.handle("window:launcher", (_event, enabled: boolean) => {
  setLauncherMode(enabled);
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
  const ocrText = await extractOcrText(screenshotDataUrl);
  const sentImageToProvider =
    Boolean(screenshotDataUrl) &&
    (settings.provider === "openai" ||
      (settings.provider === "openrouter" && settings.sendScreenshotToOpenRouter) ||
      (settings.provider === "gemini" && settings.sendScreenshotToGemini));
  const answer =
    settings.provider === "openrouter"
      ? await callOpenRouter(settings, input, screenshotDataUrl, ocrText)
      : settings.provider === "gemini"
        ? await callGemini(settings, input, screenshotDataUrl, ocrText)
        : await callOpenAi(settings, input, screenshotDataUrl, ocrText);

  return {
    answer,
    screenshotDataUrl,
    teamsDetected: teams.detected,
    sentImageToProvider,
    imageProvider: settings.provider,
    ocrText
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
  void ocrWorker?.terminate();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
