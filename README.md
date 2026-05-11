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
- Microsoft Teams process detection on Windows.
- Primary screen capture using Electron `desktopCapturer`.
- OpenAI Responses API integration using screenshot + transcript context.
- OpenRouter chat completions integration with optional screenshot sending.
- Experimental desktop/system audio capture with OpenAI transcription.
- Groq transcription provider support.
- Assistant modes: coding, behavioral, and meeting.
- Manual analyze hotkey.
- Auto-analyze toggle with configurable interval.
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
  - Optional: Gemini API key for text/screenshot answer generation.
  - Optional: Groq API key for free-tier speech-to-text testing.

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
3. Choose a provider:
   - `OpenAI` for screenshot + transcript analysis.
   - `OpenRouter` for free-model text-only testing.
4. Add the API key for your selected provider.
5. Set your preferred coding language, for example `Python`, `Java`, `TypeScript`, `C++`, or `C#`.
6. Save settings.

Settings are stored locally in Electron's app user data directory. Do not commit API keys to GitHub.

## Gemini Testing

Gemini is useful for screenshot + transcript analysis.

1. Create or copy a Gemini API key from Google AI Studio:

```text
https://aistudio.google.com/app/apikey
```

2. In app Settings, set Provider to `Gemini`.

3. Paste the Gemini API key.

4. Use the default model:

```text
gemini-2.5-flash
```

5. Keep `Send screenshot to Gemini` enabled for screen-reading tests.

6. Press `Analyze`.

Gemini mode calls:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

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

On macOS during development, Electron maps `CommandOrControl` to Command. The target platform for this prototype is Windows.

## Screen Share Workflow

To reduce visible cursor movement during screen sharing:

1. Use `Full` mode for setup, settings, transcript entry, and debugging.
2. Switch to `Glass` mode during normal interview assistance.
3. Switch to `Stealth` mode during screen sharing.
4. Position the overlay before sharing.
5. Turn on resize lock with the lock button.
6. Use the corner snap buttons instead of dragging.
7. Use `Ctrl + Alt + Arrow keys` to nudge the overlay without moving the mouse.
8. Use click-through mode when you do not need to interact with the overlay.

The resize lock avoids accidental resize cursors around the window border. Compact mode also disables resizing while it is active.

## Teams Test Flow

Use this flow on the Windows laptop:

1. Run the app with `npm run dev`.
2. Open Microsoft Teams.
3. Join or start a test meeting.
4. Put a coding question, code snippet, error message, or shared screen content on the display.
5. Press `Ctrl + Shift + Space`.
6. Check whether the overlay returns a useful suggestion.

You can also click `Auto` to rerun analysis periodically. The interval is controlled in Settings by `Auto analyze interval seconds`. Keep this conservative when using rate-limited free models.

## Audio Testing

The `Audio` button attempts to capture desktop/system audio and transcribe it into the transcript box.

Current behavior:

- Requires either an OpenAI API key or a Groq API key.
- Uses `Transcription provider` in Settings.
- OpenAI default model: `gpt-4o-mini-transcribe`.
- Groq default model: `whisper-large-v3-turbo`.
- Appends transcribed audio as `[Interviewer/System] ...`.
- Works best on Windows when desktop audio capture is available.

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
