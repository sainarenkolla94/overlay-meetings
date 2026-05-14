# Overlay Meetings

Windows-first desktop overlay assistant prototype for Microsoft Teams meetings.

The first version is a manual, hotkey-driven MVP: it captures the current screen, combines it with recent transcript/context entered in the overlay, sends that context to OpenAI, and shows a suggested response in an always-on-top pane.

## Current Status

Implemented:

- Electron + React + TypeScript desktop app.
- Always-on-top overlay window.
- Settings panel for OpenAI API key, model, language, and hotkeys.
- Provider selection for OpenAI or OpenRouter.
- Gemini answer provider support with optional screenshot sending.
- OCR fallback for screenshots using Tesseract.js.
- Multi-capture screen context buffer for long problems.
- Microsoft Teams process detection on Windows.
- Primary screen capture using Electron `desktopCapturer`.
- OpenAI Responses API integration using screenshot + transcript context.
- OpenRouter chat completions integration with optional screenshot sending.
- Experimental desktop/system audio capture with OpenAI transcription.
- Groq transcription provider support.
- Assistant modes: coding, behavioral, and meeting.
- Manual analyze hotkey.
- Auto-analyze toggle with configurable interval.
- Question detection toggle for transcript-driven auto answers.
- Session start/stop timer and clear-all control.
- Markdown session export.
- In-session suggestion history.
- Compact mode, resize lock, corner snapping, and keyboard nudging.
- View modes: Full, Glass, and Stealth.
- Hide/show hotkey.
- Initial Windows capture-protection attempt with Electron `setContentProtection(true)`.

Not implemented yet:

- Native Windows WASAPI helper.
- Automatic question detection.
- Strong native `SetWindowDisplayAffinity` helper.
- Zoom-specific support.
- Installer/packaging.

## Requirements

- Node.js 20+.
- npm.
- Microsoft Teams desktop app for Windows testing.
- OpenAI API key.
  - Optional: OpenRouter API key for free-model testing.
  - Optional: one or more Gemini API keys for text/screenshot answer generation.
  - Optional: one or more Groq API keys for free-tier speech-to-text testing.

ChatGPT Plus is not enough for automated app usage. This app needs an API key because it calls model APIs directly.

Audio transcription can use OpenAI or Groq. OpenRouter can still generate answers, but it does not transcribe audio in this prototype.

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
3. Choose a provider preset:
   - `Gemini answers + Groq transcription`
   - `OpenRouter answers + Groq transcription`
   - `OpenAI answers + OpenAI transcription`
4. Choose a provider manually if needed:
   - `OpenAI` for screenshot + transcript analysis.
   - `OpenRouter` for free-model text-only testing.
   - `Gemini` for screenshot + transcript analysis.
5. Add the API key for your selected provider. Gemini and Groq support multiple keys, one per line.
6. Set your preferred coding language, for example `Python`, `Java`, `TypeScript`, `C++`, or `C#`.
7. Save settings.

Settings are stored locally in Electron's app user data directory. Do not commit API keys to GitHub.

## Gemini Testing

Gemini is useful for screenshot + transcript analysis.

1. Create or copy a Gemini API key from Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

2. In app Settings, set Provider to `Gemini`.

3. Paste one or more Gemini API keys. Use one key per line.

4. Use the default model:

```text
gemini-2.5-flash
```

5. Keep `Send screenshot to Gemini` enabled for screen-reading tests.

6. If Gemini says it cannot see the problem, choose the exact browser/window/screen from `Capture source` in Settings, then press `Analyze` again.

Gemini mode calls:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

When multiple Gemini keys are configured, the app rotates through them round-robin. If a key hits quota or rate limits, the app temporarily cools it down and tries the next configured key.

## OpenRouter Testing

OpenRouter support is useful for early testing without paying OpenAI API costs.

1. Create an OpenRouter API key at:

```text
https://openrouter.ai/settings/keys
```

2. In the app settings, set Provider to `OpenRouter`.

3. Paste the OpenRouter API key.

4. Use a specific free model instead of the generic router when possible. For screenshot analysis, try a vision-capable free model such as:

```text
google/gemma-4-26b-a4b-it:free
```

Free model availability changes. If that model fails, choose another currently listed free model from:

```text
https://openrouter.ai/models?max_price=0
```

OpenRouter has a `Send screenshot to OpenRouter` setting. Keep it enabled when using a vision-capable model. Turn it off if a selected free model rejects image input or rate limits.

## Default Hotkeys

- Analyze current screen/context: `Ctrl + Shift + Space`
- Hide/show overlay: `Ctrl + Shift + H`
- Nudge overlay position: `Ctrl + Alt + Arrow keys`
- Cycle view mode: `Ctrl + Alt + V`
- Add screen context: `Ctrl + Alt + C`
- Clear screen context: `Ctrl + Alt + X`
- Toggle Detect: `Ctrl + Alt + D`
- Toggle Audio: `Ctrl + Alt + A`
- Copy answer: `Ctrl + Alt + K`
- Toggle click-through: `Ctrl + Alt + P`
- Collapse/expand bubble: `Ctrl + Alt + B`

On macOS during development, Electron maps `CommandOrControl` to Command. The target platform for this prototype is Windows.

Most operational shortcuts are registered as Electron global shortcuts, so they should work even when Teams, Chrome, or LeetCode has focus.

## Screen Share Workflow

To reduce visible cursor movement during screen sharing:

1. Use `Full` mode for setup, settings, transcript entry, and debugging.
2. Switch to `Glass` mode during normal interview assistance.
3. Switch to `Stealth` mode during screen sharing. Stealth hides setup controls and shows a scrollable answer-only surface. Use the tiny `Full` button or `Ctrl + Alt + V` to leave Stealth mode.
4. Position the overlay before sharing.
5. Turn on resize lock with the lock button.
6. Use the corner snap buttons instead of dragging.
7. Use `Ctrl + Alt + Arrow keys` to nudge the overlay without moving the mouse.
8. Use click-through mode when you do not need to interact with the overlay.

The resize lock avoids accidental resize cursors around the window border. Compact mode also disables resizing while it is active.

## Capture Source

By default, the app captures the primary screen. If your coding problem is on another monitor or in a specific browser window:

1. Open Settings.
2. Click `Refresh capture sources`.
3. Choose the screen or window that contains the problem.
4. Save.
5. Press `Analyze`.

Use `Last screen capture` to confirm the app is actually seeing the right content.

The overlay also reports OCR status after each Analyze, for example:

```text
Image sent to gemini · OCR extracted 1234 chars
```

If OCR extracts no text, zoom in on the problem statement or choose a better capture source.

## Long Problem Statements

For questions that span multiple screens:

1. Scroll to the first part of the problem.
2. Click `Context`.
3. Scroll to the next part.
4. Click `Context` again.
5. Repeat until the full prompt is captured.
6. Click `Analyze`.

The app stores accumulated OCR text as screen context and sends it with Analyze. Duplicate lines are filtered out where possible. Use `Clear ctx` to reset the saved screen context.

## Teams Test Flow

Use this flow on the Windows laptop:

1. Run the app with `npm run dev`.
2. Open Microsoft Teams.
3. Join or start a test meeting.
4. Click `Start` in the session bar. Start switches to Stealth mode, enables Detect, refreshes capture sources, starts the timer, and attempts to start Audio.
5. Put a coding question, code snippet, error message, or shared screen content on the display.
6. Press `Ctrl + Shift + Space`.
7. Check whether the overlay returns a useful suggestion.
8. Click `Export` to save a Markdown record of the transcript, screen context, current answer, and history.

You can also click `Auto` to rerun analysis periodically. The interval is controlled in Settings by `Auto analyze interval seconds`. Keep this conservative when using rate-limited free models.

Use `Detect` to watch the transcript for likely interviewer questions and trigger Analyze automatically. Detect uses local keyword heuristics and the same cooldown as the Auto interval, so it is conservative by design.

When Detect fires, the debug line shows the matched signal, for example:

```text
Detected: can you
```

If an answer stops early, click `Continue` in the Suggestion panel to ask the provider to finish from the previous answer.

## Session Export

Click `Export` to save a Markdown file containing:

- provider metadata,
- current answer,
- transcript,
- saved screen context,
- suggestion history.

Exports are saved under:

```text
Documents/Overlay Meetings Sessions
```

## Audio Testing

The `Audio` button attempts to capture desktop/system audio and transcribe it into the transcript box.

Current behavior:

- Requires either an OpenAI API key or a Groq API key.
- Uses `Transcription provider` in Settings.
- OpenAI default model: `gpt-4o-mini-transcribe`.
- Groq default model: `whisper-large-v3-turbo`.
- Appends transcribed audio as `[Interviewer/System] ...`.
- Works best on Windows when desktop audio capture is available.
- Groq supports multiple API keys in Settings, one per line. The app rotates through them and temporarily skips rate-limited keys.

Recommended low-cost test setup:

```text
Answer Provider: OpenRouter or Gemini
Transcription Provider: Groq
Groq transcription model: whisper-large-v3-turbo
```

Test flow:

1. Add an OpenAI or Groq API key in Settings.
2. Set `Transcription provider` to `Groq` if using Groq.
3. Open Teams and join a test meeting.
4. Click `Audio`.
5. Have the meeting audio play through your speakers/headphones.
6. Wait around 9-12 seconds for the first chunk to transcribe.
7. Confirm text appears in Recent transcript.
8. Click `Analyze` or enable `Auto`.
9. Enable `Detect` if you want likely questions in the transcript to trigger answers automatically.

If audio capture fails, the next planned implementation is a native Windows WASAPI loopback helper.

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

With OpenRouter selected:

```text
Screenshot, if enabled
+ transcript/manual context
        |
        v
OpenRouter chat completions
        |
        v
Suggested answer in overlay
```

With Gemini selected:

```text
Screenshot, if enabled
+ transcript/manual context
        |
        v
Gemini generateContent
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

1. Replace experimental desktop audio capture with native Windows WASAPI loopback.
2. Add local Whisper transcription option.
3. Add rolling transcript buffer controls.
4. Improve automatic question detection with model-based classification.
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
