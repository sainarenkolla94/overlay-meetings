export type AssistantStatus = "idle" | "listening" | "analyzing" | "capturing" | "ready" | "error";

export type AppSettings = {
  provider: "openai" | "openrouter" | "gemini";
  transcriptionProvider: "openai" | "groq" | "deepgram";
  openAiApiKey: string;
  openRouterApiKey: string;
  geminiApiKey: string;
  geminiApiKeys: string;
  groqApiKey: string;
  groqApiKeys: string;
  deepgramApiKey: string;
  model: string;
  openRouterModel: string;
  geminiModel: string;
  sendScreenshotToOpenRouter: boolean;
  sendScreenshotToGemini: boolean;
  transcriptionModel: string;
  groqTranscriptionModel: string;
  preferredLanguage: string;
  triggerHotkey: string;
  hideHotkey: string;
  autoAnalyzeIntervalSeconds: number;
  captureSourceId: string;
  captureMode: "screen";
};

export type AnalyzeInput = {
  transcript: string;
  screenContext: string;
  mode: "coding" | "behavioral" | "meeting";
  useScreenshot?: boolean;
  responseStyle?: "overlay" | "spoken";
};

export type AnalyzeResult = {
  answer: string;
  screenshotDataUrl?: string;
  teamsDetected: boolean;
  sentImageToProvider: boolean;
  imageProvider: AppSettings["provider"];
  ocrText: string;
};

export type CaptureContextResult = {
  screenshotDataUrl?: string;
  ocrText: string;
};

export type ExportSessionInput = {
  transcript: string;
  screenContext: string;
  answer: string;
  history: Array<{
    answer: string;
    mode: AnalyzeInput["mode"];
    createdAt: string;
  }>;
  metadata: {
    provider: AppSettings["provider"];
    transcriptionProvider: AppSettings["transcriptionProvider"];
    startedAt?: string;
    exportedAt: string;
  };
};

export type ExportSessionResult = {
  filePath: string;
};

export type DesktopAudioSource = {
  id: string;
  name: string;
};

export type CaptureSource = {
  id: string;
  name: string;
  type: "screen" | "window";
};

export type TranscribeAudioInput = {
  base64Audio: string;
  mimeType: string;
  source: "system" | "mic";
};

export type TranscribeAudioResult = {
  text: string;
};

export type TeamsStatus = {
  detected: boolean;
  platform: NodeJS.Platform;
  message: string;
};

export type WindowNudgeDirection = "up" | "down" | "left" | "right";
export type WindowSnapPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
