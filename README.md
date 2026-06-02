# iTranslate

iTranslate is a Chromium extension for fast text and page translation. It can translate selected text, focused input fields, the side panel text box, and full web pages with configurable translation providers.

Version: 1.4.3

## Release Notes

### 1.4.3

- Made one-time page translation document-scoped, so clicking Translate page no longer persists across full page reloads.
- Clear legacy persisted tab translation state from older builds instead of restoring it after navigation.
- Keep one-time page translation active across same-document page updates, including SPA-style content changes.
- Keep automatic page translation tied to explicit always-translate language rules.
- Split page translation runtime state, DOM scanning, visibility tracking, prompts, status indicators, diagnostics, and contracts into dedicated modules.
- Reduced background bundle size by moving DeepL internals into a lazy translator chunk.
- Verified visible-only page translation, dynamic content updates, and reload behavior with browser E2E coverage.

### 1.4.2

- Improved page translation prompts, provider support indicators, rule management, and original-text/error tooltips.
- Added automatic page-translation suggestions based on visible language mismatch.
- Added continued translation for changed page content, placeholders, open shadow roots, and accessible frames.

### 1.4.1

- Reduced the extension bundle by removing the Floating UI runtime dependency and using a small local floating-position helper.
- Simplified Free DeepL translation code while preserving the unauthenticated DeepL flow.
- Split page translation UI responsibilities into dedicated controllers for prompts, original-text tooltips, and per-text translation status indicators.
- Moved page-translation suggestion scheduling and mutation watching into a dedicated watcher controller.
- Kept page translation behavior focused on visible text, placeholders, page updates, iframes, and duplicate-content avoidance.
- Trimmed generated CSS by importing only the Tailwind layers used by the extension.

## Highlights

- Translate selected text directly on the page.
- Translate focused input, textarea, and contenteditable text with a keyboard shortcut.
- Translate text manually in the side panel with local history.
- Suggest page translation when visible page content does not match the target language.
- Translate only visible page content and continue translating later page updates.
- Translate input and textarea placeholders during page translation.
- Show original page text in a copyable tooltip after a short hover delay.
- Detect source language automatically for selection, input, side panel, and page translation.
- Split large translation requests into chunks up to 32 KB.
- Keep a compact popup UI with dark and light themes.

## Translation Providers

The extension supports these providers:

- Google
- DeepL
- Lingvanex
- Lara
- LibreTranslate
- MyMemory
- OpenAI-compatible providers, including Ollama

Page translation is available for:

- Google
- Lingvanex
- OpenAI-compatible providers
- DeepL when an API key is configured
- LibreTranslate when an API key is configured

Page translation is intentionally unavailable for providers that are more likely to hit rate limits without an API-backed setup.

## Supported Languages

- Auto detect source language
- English
- Russian
- Ukrainian
- German
- French

## Page Translation

iTranslate can offer to translate a page automatically when enough visible text appears to be in a language different from your target language. The prompt includes:

- Translate page
- Never translate this site
- Always translate from the detected language

The prompt closes automatically if you do not interact with it. Hovering the prompt pauses the timer.

When page translation is active, the extension observes the document, open shadow roots, and all extension-accessible frames. New or changed visible text is translated without requiring a page reload. If content updates but the actual text did not change, the extension avoids sending another translation request.

You can manage page translation rules from the popup by opening the Page translation rules button above the provider selector.

## Original Text Tooltip

Translated page text keeps its original value. Hover translated page text briefly to open a copyable tooltip with the original text.

Selection translation and error details also use copyable tooltips, so messages can be selected and copied when needed.

## Provider Settings

Open the popup to configure:

- Translation provider
- Selection language pair
- Input language pair
- Provider-specific settings such as API keys, base URLs, models, and prompts
- Page translation rule management
- Theme

The popup marks whether the selected provider supports page translation, requires an API key for page translation, or is limited to selection/input translation.

## Side Panel

The side panel provides a dedicated translation workspace with:

- Provider selection
- Auto source language
- Target language selection
- Translation history
- Copyable results
- Dark and light theme support

## Keyboard Shortcut

The default shortcut for focused input translation is `Alt+A`.

To change it:

1. Open `chrome://extensions/shortcuts`.
2. Find `iTranslate`.
3. Change the shortcut for `translate-focused-input`.

## Install From Release

1. Download the latest release archive from the GitHub Releases page.
2. Extract the archive.
3. Open `chrome://extensions/`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the extracted extension folder.

## Build Locally

Install dependencies:

```bash
npm install
```

Run a production build:

```bash
npm run build
```

Run the release check:

```bash
npm run check
```

The built extension is written to `dist/`.

## Publish Release

Releases are published by the GitHub workflow when a version tag is pushed:

```bash
git tag v1.4.3
git push origin v1.4.3
```

The workflow installs dependencies with `npm ci`, runs `npm run check`, packages `dist/` as `iTranslate.zip`, and attaches it to the GitHub release.

## Privacy

iTranslate does not collect analytics or store user activity on a remote server.

Text is sent to the translation provider you select. API keys and extension settings are stored with Chrome extension storage.

## License

This project is licensed under the LGPL-3.0-only license. See `LICENSE.md` for details.

## Author

[CKATEPTb](https://github.com/CKATEPTb)
