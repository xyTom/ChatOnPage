import { defineConfig } from 'wxt';

const COMMAND_ID = 'chatonpage-open-provider';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ChatOnPage',
    description:
      'Select content or share the current page with your preferred AI assistant in one click.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'tabs', 'storage', 'notifications'],
    action: {
      default_title: 'ChatOnPage: Ask AI about this page',
    },
    commands: {
      [COMMAND_ID]: {
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+Shift+Y',
        },
        description: 'Send the current selection or page to your AI assistant',
      },
    },
    icons: {
      '16': 'icon/icon.svg',
      '32': 'icon/icon.svg',
      '48': 'icon/icon.svg',
      '96': 'icon/icon.svg',
      '128': 'icon/icon.svg',
    },
    options_ui: {
      page: 'options/index.html',
      open_in_tab: true,
    },
  },
});
