import { browser } from 'wxt/browser';

type Provider = 'perplexity' | 'chatgpt' | 'claude';
type OpenMode = 'popup' | 'tab';

interface Settings {
  provider: Provider;
  openMode: OpenMode;
}

interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
}

interface PageExtractionResult {
  success: boolean;
  selection: string;
  pageTextLength: number;
  title: string;
  url: string;
}

const MAX_Q = 1500;
const LONG_PAGE_THRESHOLD = 4000;
const POPUP_SIZE = { width: 960, height: 800 } as const;
const CONTEXT_MENU_ID = 'chatonpage.ask';
const COMMAND_ID = 'chatonpage-open-provider';

const PROVIDER_URLS: Record<Provider, string> = {
  perplexity: 'https://www.perplexity.ai/search?q=',
  chatgpt: 'https://chatgpt.com/?q=',
  claude: 'https://claude.ai/new?q=',
};

const PROVIDER_LABELS: Record<Provider, string> = {
  perplexity: 'Perplexity',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
};

const DEFAULT_SETTINGS: Settings = {
  provider: 'perplexity',
  openMode: 'popup',
};

export default defineBackground(() => {
  void ensureDefaultSettings();
  void setupContextMenus();

  browser.action.onClicked.addListener((tab) => {
    void handleTrigger(tab);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
      void handleTrigger(tab);
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === COMMAND_ID) {
      void handleTrigger();
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.provider) {
      void setupContextMenus();
    }
  });

  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaultSettings();
    void setupContextMenus();
  });
});

async function handleTrigger(tab?: BrowserTab) {
  const activeTab = tab?.id !== undefined ? tab : await getActiveTab();
  if (!activeTab?.id) {
    await notifyFailure('Unable to get the current page information. Please try again.');
    return;
  }

  const settings = await getSettings();
  const pageInfo = await extractPageInfo(activeTab.id);
  const targetUrl = buildProviderUrl(pageInfo, activeTab, settings.provider);

  if (!targetUrl) {
    await notifyFailure('Unable to fetch the page URL. Please try again.');
    return;
  }

  try {
    await openProvider(targetUrl, settings.openMode);
  } catch (error) {
    console.error('Failed to open provider window', error);
    await notifyFailure('Failed to open. Please try again or switch the provider.');
  }
}

async function getActiveTab(): Promise<BrowserTab | undefined> {
  const [tab] = (await browser.tabs.query({ active: true, currentWindow: true })) as BrowserTab[];
  return tab;
}

async function extractPageInfo(tabId: number): Promise<PageExtractionResult | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const selection = window.getSelection()?.toString() ?? '';
          const trimmedSelection = selection.trim();
          const bodyText = document.body?.innerText ?? '';

          return {
            success: true,
            selection: trimmedSelection,
            pageTextLength: bodyText.length,
            title: document.title ?? '',
            url: window.location.href,
          } satisfies PageExtractionResult;
        } catch (error) {
          console.error('Content script error', error);
          return {
            success: false,
            selection: '',
            pageTextLength: 0,
            title: document.title ?? '',
            url: window.location.href,
          } satisfies PageExtractionResult;
        }
      },
    });

    return result?.result ?? null;
  } catch (error) {
    console.error('Failed to execute extraction script', error);
    return null;
  }
}

function buildProviderUrl(
  pageInfo: PageExtractionResult | null,
  tab: BrowserTab,
  provider: Provider,
): string | null {
  const baseUrl = PROVIDER_URLS[provider] ?? PROVIDER_URLS.perplexity;
  const extractionSucceeded = pageInfo?.success ?? false;
  const selection = extractionSucceeded && pageInfo ? pageInfo.selection : '';
  const pageTextLength = extractionSucceeded && pageInfo ? pageInfo.pageTextLength : 0;
  const pageUrl = (extractionSucceeded && pageInfo ? pageInfo.url : undefined) || tab.url;

  if (!pageUrl) {
    return null;
  }

  let payload: string;
  const hasSelection = selection.length > 0;
  const selectionIsShort = hasSelection && selection.length <= MAX_Q;
  const selectionIsLong = hasSelection && selection.length > MAX_Q;
  const pageIsLong = (!hasSelection && pageTextLength > LONG_PAGE_THRESHOLD) || selectionIsLong;

  if (selectionIsShort) {
    payload = selection;
  } else if (pageIsLong) {
    payload = pageUrl;
  } else {
    const title =
      (extractionSucceeded && pageInfo ? pageInfo.title : undefined) ?? tab.title ?? '';
    payload = title
      ? `Please summarize: ${title} ${pageUrl}`
      : `Please summarize: ${pageUrl}`;
  }

  return `${baseUrl}${encodeURIComponent(payload)}`;
}

async function openProvider(url: string, mode: OpenMode) {
  if (mode === 'popup') {
    await browser.windows.create({
      url,
      type: 'popup',
      width: POPUP_SIZE.width,
      height: POPUP_SIZE.height,
      focused: true,
    });
  } else {
    await browser.tabs.create({ url, active: true });
  }
}

async function notifyFailure(message: string) {
  try {
    await browser.notifications.create({
      type: 'basic',
      title: 'ChatOnPage',
      message,
      iconUrl: browser.runtime.getURL('/icon/128.png'),
    });
  } catch (error) {
    console.error('Failed to show notification', error);
  }
}

async function ensureDefaultSettings() {
  const stored = await browser.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const normalized = normalizeSettings(stored);
  const updates: Partial<Settings> = {};

  if (!isProvider(stored.provider)) {
    updates.provider = normalized.provider;
  }

  if (!isOpenMode(stored.openMode)) {
    updates.openMode = normalized.openMode;
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.sync.set(updates);
  }
}

async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings(stored);
}

async function setupContextMenus() {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = String((error as { message?: string }).message);
      if (!message.includes('Invalid menu item') && !message.includes('Cannot find menu item')) {
        console.warn('Failed to remove context menu', error);
      }
    }
  }

  const settings = await getSettings();
  const title = `ChatOnPage: Ask with ${PROVIDER_LABELS[settings.provider]}`;

  try {
    await browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title,
      contexts: ['selection', 'page'],
    });
  } catch (error) {
    console.error('Failed to create context menu', error);
  }
}

function isProvider(value: unknown): value is Provider {
  return value === 'perplexity' || value === 'chatgpt' || value === 'claude';
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === 'popup' || value === 'tab';
}

function normalizeSettings(
  stored: Partial<Record<keyof Settings, unknown>>,
): Settings {
  const provider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;
  const openMode = isOpenMode(stored.openMode) ? stored.openMode : DEFAULT_SETTINGS.openMode;
  return { provider, openMode };
}
