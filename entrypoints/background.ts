import { browser } from 'wxt/browser';

const MAX_Q = 1500;
const LONG_PAGE_THRESHOLD = 4000;

const DEFAULT_WINDOW_WIDTH = 960;
const DEFAULT_WINDOW_HEIGHT = 800;

const CONTEXT_MENU_ID = 'chat-on-page-send';
const COMMAND_ID = 'trigger-ai-search';

const PROVIDER_ENDPOINTS = {
  perplexity: 'https://www.perplexity.ai/search?q=',
  chatgpt: 'https://chatgpt.com/?q=',
  claude: 'https://claude.ai/new?q=',
} as const satisfies Record<string, string>;

const OPEN_MODES = {
  popup: true,
  tab: true,
} as const;

type OpenMode = keyof typeof OPEN_MODES;
type Provider = keyof typeof PROVIDER_ENDPOINTS;

interface Settings {
  openMode: OpenMode;
  provider: Provider;
}

const DEFAULT_SETTINGS: Settings = {
  openMode: 'popup',
  provider: 'perplexity',
};

interface PageProbeResult {
  selectionText: string;
  pageLength: number;
  title: string;
  url: string;
}

type ActionListener = Parameters<typeof browser.action.onClicked.addListener>[0];
type ExtensionTab = ActionListener extends (tab: infer T, ...args: any[]) => any ? T : never;

export default defineBackground(() => {
  void initialize();

  browser.action.onClicked.addListener((tab) => {
    void handleTrigger(tab);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
      void handleTrigger(tab);
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command !== COMMAND_ID) {
      return;
    }
    void (async () => {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) {
        await showErrorNotification('无法获取当前标签页，请重试或切换 Provider');
        return;
      }
      await handleTrigger(activeTab);
    })();
  });
});

async function initialize() {
  await ensureDefaultSettings();
  await setupContextMenus();

  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaultSettings();
    void setupContextMenus();
  });

  browser.runtime.onStartup.addListener(() => {
    void setupContextMenus();
  });
}

async function ensureDefaultSettings() {
  const stored = await browser.storage.sync.get(['openMode', 'provider']);
  const updates: Partial<Settings> = {};

  if (!isOpenMode(stored.openMode)) {
    updates.openMode = DEFAULT_SETTINGS.openMode;
  }

  if (!isProvider(stored.provider)) {
    updates.provider = DEFAULT_SETTINGS.provider;
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.sync.set(updates);
  }
}

async function setupContextMenus() {
  try {
    await browser.contextMenus.removeAll();
  } catch (error) {
    console.error('Failed to clear context menus', error);
  }

  try {
    await browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '发送到 AI 工具',
      contexts: ['selection', 'page'],
    });
  } catch (error) {
    console.error('Failed to create context menu', error);
  }
}

async function handleTrigger(tab?: ExtensionTab | null) {
  if (!tab || typeof tab.id !== 'number') {
    await showErrorNotification('无法获取当前标签页，请重试或切换 Provider');
    return;
  }

  const settings = await getSettings();
  const pageInfo = await collectPageInfo(tab.id);
  const payload = decidePayload(pageInfo, tab);

  if (!payload) {
    await showErrorNotification('当前页面无法处理，请在可访问的页面重试');
    return;
  }

  const targetUrl = buildProviderUrl(settings.provider, payload);

  try {
    await openProvider(targetUrl, settings.openMode);
  } catch (error) {
    console.error('Failed to open provider', error);
    await showErrorNotification('打开失败，请重试或切换 Provider');
  }
}

async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(['openMode', 'provider']);
  const openMode = isOpenMode(stored.openMode) ? stored.openMode : DEFAULT_SETTINGS.openMode;
  const provider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;

  return { openMode, provider };
}

async function collectPageInfo(tabId: number): Promise<PageProbeResult | null> {
  try {
    const [injection] = (await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const selection = window.getSelection()?.toString() ?? '';
          const trimmedSelection = selection.trim();
          const body = document.body;
          const pageText = body ? body.innerText ?? '' : '';

          return {
            selectionText: trimmedSelection,
            pageLength: pageText.length,
            title: document.title ?? '',
            url: window.location.href ?? '',
          };
        } catch (scriptError) {
          console.error('Failed to probe page', scriptError);
          return null;
        }
      },
    })) as Array<{ result: PageProbeResult | null }>;

    return injection?.result ?? null;
  } catch (error) {
    console.error('Failed to execute probing script', error);
    return null;
  }
}

function decidePayload(pageInfo: PageProbeResult | null, tab: ExtensionTab): string | null {
  const fallbackUrl = pageInfo?.url || tab.url || '';

  if (!fallbackUrl) {
    return null;
  }

  if (!pageInfo) {
    return fallbackUrl;
  }

  const selectionLength = pageInfo.selectionText.length;

  if (selectionLength > 0 && selectionLength <= MAX_Q) {
    return pageInfo.selectionText;
  }

  if (selectionLength > MAX_Q || (!selectionLength && pageInfo.pageLength > LONG_PAGE_THRESHOLD)) {
    return fallbackUrl;
  }

  const title = pageInfo.title || tab.title || '';
  const summaryTarget = title ? `${title} ${fallbackUrl}` : fallbackUrl;
  return `请总结：${summaryTarget}`;
}

function buildProviderUrl(provider: Provider, payload: string): string {
  const base = PROVIDER_ENDPOINTS[provider] ?? PROVIDER_ENDPOINTS[DEFAULT_SETTINGS.provider];
  return `${base}${encodeURIComponent(payload)}`;
}

async function openProvider(url: string, mode: OpenMode) {
  if (mode === 'popup') {
    await browser.windows.create({
      url,
      type: 'popup',
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      focused: true,
    });
    return;
  }

  await browser.tabs.create({ url });
}

async function showErrorNotification(message: string) {
  if (!browser.notifications) {
    console.warn('Notifications API is unavailable in this environment');
    return;
  }

  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: 'ChatOnPage',
      message,
    });
  } catch (error) {
    console.error('Failed to show notification', error);
  }
}

function isOpenMode(value: unknown): value is OpenMode {
  return typeof value === 'string' && value in OPEN_MODES;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && value in PROVIDER_ENDPOINTS;
}
