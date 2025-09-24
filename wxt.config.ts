import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ChatOnPage',
    description:
      'Send the current page or selected text to AI assistants like Perplexity, ChatGPT, or Claude with a single action.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'tabs', 'storage'],
    action: {
      default_title: 'Send to AI',
    },
    commands: {
      'chatonpage.send-to-ai': {
        description: 'Send the current selection or URL to the configured AI provider.',
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+Shift+Y',
        },
      },
    },
  },
});
