import type { AnalyzeInput, AnalyzeResult, AppSettings, TeamsStatus } from "./shared/types";

declare global {
  interface Window {
    overlayApi: {
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      analyzeNow: (input: AnalyzeInput) => Promise<AnalyzeResult>;
      getTeamsStatus: () => Promise<TeamsStatus>;
      setClickThrough: (enabled: boolean) => Promise<void>;
      hideOverlay: () => Promise<void>;
      onAnalyzeShortcut: (callback: () => void) => () => void;
      onToggleVisibility: (callback: () => void) => () => void;
    };
  }
}

export {};
