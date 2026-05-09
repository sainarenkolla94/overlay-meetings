# Overlay Meetings

Windows-first desktop overlay assistant prototype for Microsoft Teams meetings.

The first version is a manual, hotkey-driven MVP: it captures the current screen, combines it with recent transcript/context entered in the overlay, sends that context to OpenAI, and shows a suggested response in an always-on-top pane.

## Current Status

Implemented:

- Electron + React + TypeScript desktop app.
- Always-on-top overlay window.
- Settings panel for OpenAI API key, model, language, and hotkeys.
- Microsoft Teams process detection on Windows.
- Primary screen capture using Electron `desktopCapturer`.
- OpenAI Responses API integration using screenshot + transcript context.
- Assistant modes: coding, behavioral, and meeting.
- Manual analyze hotkey.
- Hide/show hotkey.
- Initial Windows capture-protection attempt with Electron `setContentProtection(true)`.

Not implemented yet:

- Windows WASAPI system audio capture.
- Reliable live meeting transcription.
- Automatic question detection.
- Strong native `SetWindowDisplayAffinity` helper.
- Zoom-specific support.
- Installer/packaging.

## Requirements

- Node.js 20+.
- npm.
- Microsoft Teams desktop app for Windows testing.
- OpenAI API key.

ChatGPT Plus is not enough for automated app usage. This app needs an OpenAI API key because it calls the OpenAI API directly.

## Setup

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

This starts the Vite renderer and launches the Electron overlay.

## First-Time App Setup

1. Open the overlay.
2. Click the settings icon.
3. Add your OpenAI API key.
4. Set your preferred coding language, for example `Python`, `Java`, `TypeScript`, `C++`, or `C#`.
5. Save settings.

Settings are stored locally in Electron's app user data directory. Do not commit API keys to GitHub.

## Default Hotkeys

- Analyze current screen/context: `Ctrl + Shift + Space`
- Hide/show overlay: `Ctrl + Shift + H`

On macOS during development, Electron maps `CommandOrControl` to Command. The target platform for this prototype is Windows.

## Teams Test Flow

Use this flow on the Windows laptop:

1. Run the app with `npm run dev`.
2. Open Microsoft Teams.
3. Join or start a test meeting.
4. Put a coding question, code snippet, error message, or shared screen content on the display.
5. Press `Ctrl + Shift + Space`.
6. Check whether the overlay returns a useful suggestion.

Report these results after testing:

- Did the overlay start correctly?
- Did it detect Teams?
- Did Analyze return an answer?
- Did the screenshot preview show the right screen?
- Did the overlay appear during Teams window share?
- Did the overlay appear during entire screen share?
- Were there any errors in the overlay or terminal?

## Screen Share Visibility

The current version only includes the first capture-protection attempt:

```ts
overlayWindow.setContentProtection(true);
```

This may help prevent the overlay from appearing in some capture paths, but it is not guaranteed for every Teams sharing mode.

Expected behavior:

- Teams window share: more likely to hide the overlay.
- Entire screen share: not guaranteed.
- Recording/screenshot tools: behavior varies.

If the overlay appears while sharing, the next step is to add a stronger Windows-native implementation using `SetWindowDisplayAffinity`.

## Development Commands

Type-check:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Audit dependencies:

```bash
npm audit
```

## Architecture

High-level flow:

```text
Teams / screen content
        |
        v
Electron screen capture
        |
        v
Overlay transcript/context
        |
        v
OpenAI Responses API
        |
        v
Suggested answer in overlay
```

Important files:

- `src/main/main.ts`: Electron main process, window creation, settings, hotkeys, Teams detection, screen capture, OpenAI request.
- `src/preload/preload.ts`: Safe IPC bridge exposed to the renderer.
- `src/renderer/App.tsx`: Overlay UI and user interactions.
- `src/renderer/styles.css`: Overlay styling.
- `src/shared/types.ts`: Shared TypeScript types.
- `scripts/start-electron.cjs`: Electron launcher that clears `ELECTRON_RUN_AS_NODE` for this environment.

## Next Planned Steps

Recommended next implementation order:

1. Add Windows WASAPI loopback capture for Teams/system audio.
2. Add OpenAI or local transcription for system audio chunks.
3. Add rolling transcript buffer.
4. Add automatic question detection.
5. Add native Windows `SetWindowDisplayAffinity` helper.
6. Add document upload for resume/job description context.
7. Add Zoom detection and testing.

## Privacy Notes

This prototype can send screenshots and transcript text to the OpenAI API when Analyze is triggered. Be careful during real meetings, interviews, and screen shares.

Before using this in real calls, add:

- explicit pause/listening controls,
- clear local data deletion,
- consent-aware UX,
- stronger API key storage,
- and organization-specific compliance review if needed.

