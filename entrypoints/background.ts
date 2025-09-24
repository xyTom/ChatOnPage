const MAX_Q = 1500;
const LONG_PAGE_THRESHOLD = 4000;
const POPUP_WIDTH = 960;
const POPUP_HEIGHT = 800;
const CONTEXT_MENU_ID = 'chat-on-page:ask';

const PROVIDER_ENDPOINTS = {
  perplexity: 'https://www.perplexity.ai/search',
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
} as const;

const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: 'perplexity',
  openMode: 'popup',
};

type Provider = keyof typeof PROVIDER_ENDPOINTS;
type OpenMode = 'popup' | 'tab';

type ExtensionSettings = {
  provider: Provider;
  openMode: OpenMode;
};

type PageContext = {
  selectionText: string;
  selectionLength: number;
  pageTextLength: number;
  title: string;
  url: string;
};

type TriggerSource = 'action' | 'context-menu' | 'command';

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && value in PROVIDER_ENDPOINTS;
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === 'popup' || value === 'tab';
}

async function initContextMenus() {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch (error) {
    // Ignore errors when the menu does not exist yet.
  }

  await browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Ask AI about this page',
    contexts: ['page', 'selection'],
  });
}

async function getSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await browser.storage.sync.get(['provider', 'openMode']);
    const provider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;
    const openMode = isOpenMode(stored.openMode) ? stored.openMode : DEFAULT_SETTINGS.openMode;
    return { provider, openMode };
  } catch (error) {
    console.warn('Failed to read settings from storage, using defaults.', error);
    return { ...DEFAULT_SETTINGS };
  }
}

async function getPageContext(tabId: number): Promise<PageContext | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection?.()?.toString?.() ?? '';
        const trimmedSelection = selection.trim();
        const bodyText = document.body?.innerText ?? '';

        return {
          selectionText: trimmedSelection,
          selectionLength: trimmedSelection.length,
          pageTextLength: bodyText.length,
          title: document.title ?? '',
          url: document.location.href,
        } satisfies PageContext;
      },
    });

    return result?.result ?? null;
  } catch (error) {
    console.warn('Failed to collect page context, falling back to URL.', error);
    return null;
  }
}

function buildQueryPayload(tab: browser.tabs.Tab, context: PageContext | null): string {
  const fallbackUrl = tab.url ?? '';
  const url = context?.url || fallbackUrl;
  if (!url) {
    return '';
  }

  const selectionText = context?.selectionText ?? '';
  const selectionLength = context?.selectionLength ?? selectionText.length;
  const pageLength = context?.pageTextLength ?? 0;

  if (selectionText && selectionLength <= MAX_Q) {
    return selectionText;
  }

  if ((selectionText && selectionLength > MAX_Q) || (!selectionText && pageLength > LONG_PAGE_THRESHOLD)) {
    return url;
  }

  const title = context?.title || tab.title || '';
  const summaryTarget = [title, url].filter(Boolean).join(' ');
  if (summaryTarget) {
    return `请总结：${summaryTarget}`;
  }

  return url;
}

function buildProviderUrl(provider: Provider, payload: string): string {
  const base = PROVIDER_ENDPOINTS[provider];
  const encoded = encodeURIComponent(payload);
  return `${base}?q=${encoded}`;
}

async function openProvider(url: string, openMode: OpenMode) {
  if (openMode === 'popup') {
    await browser.windows.create({
      url,
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    });
    return;
  }

  await browser.tabs.create({ url, active: true });
}

async function showFailureNotification() {
  const iconUrl = browser.runtime.getURL('icon/128.png');
  try {
    await browser.notifications.create({
      type: 'basic',
      title: 'Open failed',
      message: '打开失败，请重试或切换 Provider。',
      iconUrl,
    });
  } catch (error) {
    console.warn('Failed to show notification.', error);
  }
}

async function resolveActiveTab(triggeredTab?: browser.tabs.Tab): Promise<browser.tabs.Tab | null> {
  if (triggeredTab && triggeredTab.id !== undefined) {
    return triggeredTab;
  }

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  return activeTab ?? null;
}

async function handleTrigger(source: TriggerSource, triggeredTab?: browser.tabs.Tab) {
  const tab = await resolveActiveTab(triggeredTab);
  if (!tab || tab.id === undefined) {
    console.warn('No active tab available for trigger', source);
    return;
  }

  const settings = await getSettings();
  const context = await getPageContext(tab.id);
  const payload = buildQueryPayload(tab, context) || tab.url || '';
  const targetUrl = buildProviderUrl(settings.provider, payload);

  try {
    await openProvider(targetUrl, settings.openMode);
  } catch (error) {
    console.error('Failed to open provider.', error);
    await showFailureNotification();
  }
}

export default defineBackground(() => {
  initContextMenus().catch((error) => {
    console.error('Failed to initialize context menus.', error);
  });

  browser.runtime.onInstalled.addListener(() => {
    initContextMenus().catch((error) => {
      console.error('Failed to initialize context menus on install.', error);
    });
  });

  browser.action.onClicked.addListener((tab) => {
    handleTrigger('action', tab).catch((error) => {
      console.error('Action trigger failed.', error);
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
      handleTrigger('context-menu', tab ?? undefined).catch((error) => {
        console.error('Context menu trigger failed.', error);
      });
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'ask-ai') {
      handleTrigger('command', tab ?? undefined).catch((error) => {
        console.error('Command trigger failed.', error);
      });
    }
  });
});
