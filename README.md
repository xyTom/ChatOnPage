# ChatOnPage

ChatOnPage is a lightweight browser extension that sends the current selection or page to your preferred AI assistant (Perplexity, ChatGPT, or Claude) with a single click, right-click, or keyboard shortcut.

## What you get
- One-click launcher: toolbar button, context menu, or `⌘⇧Y` / `Ctrl+Shift+Y`.
- Provider choice: Perplexity, ChatGPT, or Claude with popup or new-tab mode.
- Prompt control: smart assist, summary, key takeaways, explain, translate, or a custom prompt.
- Metadata protection: optionally include title and URL so the AI can cite and reopen sources.
- Polished options page with fast persistence and helpful defaults.

## Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the extension in watch mode:
   ```bash
   npm run dev     # Chromium-based
   npm run dev:firefox
   ```
3. Load the generated extension from `.output/` in your browser’s extensions page.

## Build for release
```
npm run build
npm run zip          # creates uploadable zip
npm run build:firefox
npm run zip:firefox
```

## Usage
- Highlight any text and trigger ChatOnPage; the highlight is sent directly.
- No highlight? It sends the page URL with your chosen prompt (smart assist or your custom text).
- Open the Options page from the extension menu to switch providers, prompt style, and metadata.

## Notes
- Permissions: activeTab, scripting, contextMenus, tabs, storage, and notifications are used to read the current page context, inject the lightweight extractor, persist preferences, and show failure notifications.
