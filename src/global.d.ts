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
} from "./shared/types";

declare global {
  interface Window {
    overlayApi: {
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      analyzeNow: (input: AnalyzeInput) => Promise<AnalyzeResult>;
      captureContext: () => Promise<CaptureContextResult>;
      getCaptureSources: () => Promise<CaptureSource[]>;
      getDesktopAudioSources: () => Promise<DesktopAudioSource[]>;
      transcribeAudio: (input: TranscribeAudioInput) => Promise<TranscribeAudioResult>;
      exportSession: (input: ExportSessionInput) => Promise<ExportSessionResult>;
      getTeamsStatus: () => Promise<TeamsStatus>;
      setClickThrough: (enabled: boolean) => Promise<void>;
      setResizable: (enabled: boolean) => Promise<void>;
      setCompact: (enabled: boolean) => Promise<void>;
      setLauncher: (enabled: boolean) => Promise<void>;
      nudgeWindow: (direction: WindowNudgeDirection, amount?: number) => Promise<void>;
      snapWindow: (position: WindowSnapPosition) => Promise<void>;
      hideOverlay: () => Promise<void>;
      onAnalyzeShortcut: (callback: () => void) => () => void;
      onToggleVisibility: (callback: () => void) => () => void;
      onGlobalAction: (callback: (action: string) => void) => () => void;
    };
  }
}

export {};
