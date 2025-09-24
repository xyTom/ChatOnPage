const MAX_QUERY_LENGTH = 1500;
const LONG_PAGE_THRESHOLD = 4000;
const POPUP_WIDTH = 960;
const POPUP_HEIGHT = 800;
const CONTEXT_MENU_ID = 'chatonpage:send-to-ai';
const COMMAND_ID = 'chatonpage.send-to-ai';

type Provider = 'perplexity' | 'chatgpt' | 'claude';
type OpenMode = 'popup' | 'tab';

interface Settings {
  openMode: OpenMode;
  provider: Provider;
}

interface PageSnapshot {
  selectionText: string;
  selectionLength: number;
  pageTextLength: number;
  title: string;
  url: string;
}

const PROVIDER_URLS: Record<Provider, string> = {
  perplexity: 'https://www.perplexity.ai/search?q=',
  chatgpt: 'https://chatgpt.com/?q=',
  claude: 'https://claude.ai/new?q=',
};

const DEFAULT_SETTINGS: Settings = {
  openMode: 'popup',
  provider: 'perplexity',
};

function isOpenMode(value: unknown): value is OpenMode {
  return value === 'popup' || value === 'tab';
}

function isProvider(value: unknown): value is Provider {
  return value === 'perplexity' || value === 'chatgpt' || value === 'claude';
}

function isScriptableUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return !/^(chrome|edge|about|moz|opera|safari|view-source|chrome-extension):/.test(lower);
}

async function ensureDefaults(): Promise<Settings> {
  const stored = (await browser.storage.sync.get(DEFAULT_SETTINGS)) as Partial<Settings>;

  const openMode = isOpenMode(stored.openMode) ? stored.openMode : DEFAULT_SETTINGS.openMode;
  const provider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;

  const normalized: Settings = { openMode, provider };

  if (stored.openMode !== openMode || stored.provider !== provider) {
    await browser.storage.sync.set(normalized);
  }

  return normalized;
}

async function getSettings(): Promise<Settings> {
  return ensureDefaults();
}

async function gatherPageSnapshot(tabId: number): Promise<PageSnapshot | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: (maxSelectionLength: number) => {
        try {
          const rawSelection = window.getSelection?.()?.toString() ?? '';
          const trimmedSelection = rawSelection.trim();
          const selectionLength = trimmedSelection.length;
          const selectionText =
            selectionLength <= maxSelectionLength
              ? trimmedSelection
              : trimmedSelection.slice(0, maxSelectionLength);
          const pageTextLength = document.body?.innerText?.length ?? 0;
          return {
            selectionText,
            selectionLength,
            pageTextLength,
            title: document.title ?? '',
            url: location.href,
          } satisfies PageSnapshot;
        } catch (error) {
          console.error('Failed to gather page snapshot in content context.', error);
          return null;
        }
      },
      args: [MAX_QUERY_LENGTH],
    });

    return (result?.result as PageSnapshot | null | undefined) ?? null;
  } catch (error) {
    console.error('Failed to execute script for page snapshot.', error);
    return null;
  }
}

function buildProviderUrl(provider: Provider, query: string): string {
  const encodedQuery = encodeURIComponent(query);
  return `${PROVIDER_URLS[provider]}${encodedQuery}`;
}

function choosePayload(snapshot: PageSnapshot | null, tab: browser.tabs.Tab): string | null {
  const selectionLength = snapshot?.selectionLength ?? 0;
  const selectionText = snapshot?.selectionText ?? '';
  const pageTextLength = snapshot?.pageTextLength ?? 0;
  const tabUrl = tab.url ?? snapshot?.url ?? '';
  const tabTitle = (tab.title ?? snapshot?.title ?? '').trim();

  if (!tabUrl) {
    return null;
  }

  if (selectionLength > 0 && selectionLength <= MAX_QUERY_LENGTH) {
    return selectionText;
  }

  if (selectionLength > MAX_QUERY_LENGTH || (!selectionLength && pageTextLength > LONG_PAGE_THRESHOLD)) {
    return tabUrl;
  }

  const summaryTitle = tabTitle || '该页面';
  return `请总结：${summaryTitle} ${tabUrl}`;
}

async function showErrorToast(tabId: number, message: string): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (text: string) => {
        try {
          const existing = document.getElementById('chatonpage-toast');
          existing?.remove();

          const container = document.createElement('div');
          container.id = 'chatonpage-toast';
          container.textContent = text;
          container.style.position = 'fixed';
          container.style.top = '16px';
          container.style.right = '16px';
          container.style.zIndex = '2147483647';
          container.style.background = 'rgba(32, 32, 32, 0.92)';
          container.style.color = '#fff';
          container.style.padding = '12px 16px';
          container.style.borderRadius = '10px';
          container.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.2)';
          container.style.fontSize = '14px';
          container.style.fontFamily =
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          container.style.opacity = '0';
          container.style.transition = 'opacity 150ms ease-out';

          document.body.appendChild(container);

          requestAnimationFrame(() => {
            container.style.opacity = '1';
          });

          window.setTimeout(() => {
            container.style.opacity = '0';
            window.setTimeout(() => container.remove(), 200);
          }, 3200);
        } catch (error) {
          console.error('Failed to display toast message.', error);
        }
      },
      args: [message],
      injectImmediately: true,
    });
  } catch (error) {
    console.error('Failed to inject toast message.', error);
  }
}

async function getActiveTab(): Promise<browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function openProvider(url: string, settings: Settings): Promise<void> {
  if (settings.openMode === 'popup') {
    await browser.windows.create({
      url,
      type: 'popup',
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    });
    return;
  }

  await browser.tabs.create({ url });
}

async function handleTrigger(tab?: browser.tabs.Tab): Promise<void> {
  const activeTab = tab ?? (await getActiveTab());

  if (!activeTab || activeTab.id === undefined) {
    console.warn('No active tab available for ChatOnPage trigger.');
    return;
  }

  const settings = await getSettings();

  let snapshot: PageSnapshot | null = null;
  if (isScriptableUrl(activeTab.url)) {
    snapshot = await gatherPageSnapshot(activeTab.id);
  }

  const payload = choosePayload(snapshot, activeTab) ?? activeTab.url;

  if (!payload) {
    console.warn('Unable to determine payload for ChatOnPage trigger.');
    return;
  }

  const providerUrl = buildProviderUrl(settings.provider, payload);

  try {
    await openProvider(providerUrl, settings);
  } catch (error) {
    console.error('Failed to open provider window.', error);
    if (activeTab.id !== undefined) {
      await showErrorToast(activeTab.id, '打开失败，请重试或切换 Provider');
    }
  }
}

async function setupContextMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
  } catch (error) {
    console.error('Failed to clear existing context menus.', error);
  }

  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '发送到 AI 助手',
    contexts: ['selection', 'page'],
  });
}

export default defineBackground(() => {
  void ensureDefaults();
  void setupContextMenus();

  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaults();
    void setupContextMenus();
  });

  browser.contextMenus.onClicked.addListener((_info, tab) => {
    if (_info.menuItemId === CONTEXT_MENU_ID) {
      void handleTrigger(tab ?? undefined);
    }
  });

  browser.action.onClicked.addListener((tab) => {
    void handleTrigger(tab ?? undefined);
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === COMMAND_ID) {
      void handleTrigger();
    }
  });
});
