import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ChatOnPage',
    description: 'Quickly send the current page or selection to your preferred AI assistant.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'tabs', 'storage', 'notifications'],
    action: {
      default_title: 'Ask AI with ChatOnPage',
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    commands: {
      'ask-ai': {
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+Shift+Y',
        },
        description: 'Send the current page to the configured AI provider',
      },
    },
  },
});
