import { browser } from 'wxt/browser';

type Provider = 'perplexity' | 'chatgpt' | 'claude';
type OpenMode = 'popup' | 'tab';
type PromptMode = 'smart' | 'summary' | 'keypoints' | 'explain' | 'translate';

interface Settings {
  provider: Provider;
  openMode: OpenMode;
  promptMode: PromptMode;
  customPrompt: string;
  includeMetadata: boolean;
  providerUrls: Record<Provider, string>;
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

const PROVIDERS: Record<Provider, { url: string; label: string }> = {
  perplexity: {
    url: 'https://www.perplexity.ai/search?q=',
    label: 'Perplexity',
  },
  chatgpt: {
    url: 'https://chatgpt.com/?q=',
    label: 'ChatGPT',
  },
  claude: {
    url: 'https://claude.ai/new?q=',
    label: 'Claude',
  },
};

const DEFAULT_SETTINGS: Settings = {
  provider: 'perplexity',
  openMode: 'popup',
  promptMode: 'smart',
  customPrompt: '',
  includeMetadata: true,
  providerUrls: {
    perplexity: PROVIDERS.perplexity.url,
    chatgpt: PROVIDERS.chatgpt.url,
    claude: PROVIDERS.claude.url,
  },
};

const PROMPT_TEMPLATES: Record<PromptMode, string> = {
  smart: '',
  summary: 'Summarize this page succinctly and include the key facts.',
  keypoints: 'Extract the 5 most useful bullet-point takeaways from this content.',
  explain: 'Explain this in plain language and add one why-it-matters note.',
  translate: 'Translate the following into English and preserve structure.',
};

export default defineBackground(() => {
  void ensureDefaultSettings();
  // setupContextMenus is called onInstalled and on storage change, so we don't need it here
  // to avoid race conditions and duplicate ID errors.

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

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRIGGER_CHAT') {
      void handleTrigger();
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
  const targetUrl = buildProviderUrl(pageInfo, activeTab, settings);

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
  settings: Settings,
): string | null {
  const baseUrl = settings.providerUrls?.[settings.provider] ?? PROVIDERS[settings.provider]?.url ?? PROVIDERS.perplexity.url;
  const extractionSucceeded = pageInfo?.success ?? false;
  const selection = extractionSucceeded && pageInfo ? pageInfo.selection : '';
  const pageTextLength = extractionSucceeded && pageInfo ? pageInfo.pageTextLength : 0;
  const pageUrl = (extractionSucceeded && pageInfo ? pageInfo.url : undefined) || tab.url;

  if (!pageUrl) {
    return null;
  }

  const payloadTarget = selectPayloadTarget(selection, pageTextLength, pageInfo, tab, pageUrl);
  const payload = buildPayload(payloadTarget, settings);

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

  if (!isPromptMode(stored.promptMode)) {
    updates.promptMode = normalized.promptMode;
  }

  if (typeof stored.customPrompt !== 'string') {
    updates.customPrompt = normalized.customPrompt;
  }

  if (typeof stored.includeMetadata !== 'boolean') {
    updates.includeMetadata = normalized.includeMetadata;
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
  const settings = await getSettings();
  const providerLabel = PROVIDERS[settings.provider]?.label ?? PROVIDERS.perplexity.label;
  const title = `ChatOnPage: Ask with ${providerLabel}`;

  try {
    // Try to update the existing menu item first
    await browser.contextMenus.update(CONTEXT_MENU_ID, { title });
  } catch {
    // If update fails (e.g., item doesn't exist), create it
    try {
      await browser.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title,
        contexts: ['selection', 'page'],
      });
    } catch (error) {
      // Ignore duplicate id error if it happens due to race condition
      const message = String((error as { message?: string }).message);
      if (!message.includes('duplicate id') && !message.includes('Cannot create item with duplicate id')) {
        console.warn('Failed to create context menu', error);
      }
    }
  }
}

function isProvider(value: unknown): value is Provider {
  return value === 'perplexity' || value === 'chatgpt' || value === 'claude';
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === 'popup' || value === 'tab';
}

function isPromptMode(value: unknown): value is PromptMode {
  return (
    value === 'smart' ||
    value === 'summary' ||
    value === 'keypoints' ||
    value === 'explain' ||
    value === 'translate'
  );
}

function normalizeSettings(
  stored: Partial<Record<keyof Settings, unknown>>,
): Settings {
  const provider = isProvider(stored.provider) ? stored.provider : DEFAULT_SETTINGS.provider;
  const openMode = isOpenMode(stored.openMode) ? stored.openMode : DEFAULT_SETTINGS.openMode;
  const promptMode = isPromptMode(stored.promptMode)
    ? stored.promptMode
    : DEFAULT_SETTINGS.promptMode;
  const customPrompt =
    typeof stored.customPrompt === 'string' ? stored.customPrompt : DEFAULT_SETTINGS.customPrompt;
  const includeMetadata =
    typeof stored.includeMetadata === 'boolean'
      ? stored.includeMetadata
      : DEFAULT_SETTINGS.includeMetadata;

  const storedUrls = (stored.providerUrls as Partial<Record<Provider, string>>) || {};
  const providerUrls: Record<Provider, string> = {
    perplexity: typeof storedUrls.perplexity === 'string' ? storedUrls.perplexity : DEFAULT_SETTINGS.providerUrls.perplexity,
    chatgpt: typeof storedUrls.chatgpt === 'string' ? storedUrls.chatgpt : DEFAULT_SETTINGS.providerUrls.chatgpt,
    claude: typeof storedUrls.claude === 'string' ? storedUrls.claude : DEFAULT_SETTINGS.providerUrls.claude,
  };

  return { provider, openMode, promptMode, customPrompt, includeMetadata, providerUrls };
}

function selectPayloadTarget(
  selection: string,
  pageTextLength: number,
  pageInfo: PageExtractionResult | null,
  tab: BrowserTab,
  pageUrl: string,
) {
  const pageTitle = (pageInfo?.title ?? tab.title ?? '').trim();
  const trimmedSelection = selection.trim();

  const hasSelection = trimmedSelection.length > 0;
  const selectionIsShort = hasSelection && trimmedSelection.length <= MAX_Q;
  const selectionIsLong = hasSelection && trimmedSelection.length > MAX_Q;
  const pageIsLong = (!hasSelection && pageTextLength > LONG_PAGE_THRESHOLD) || selectionIsLong;

  if (selectionIsShort) {
    return {
      content: trimmedSelection,
      type: 'selection' as const,
      pageTitle,
      pageUrl,
    };
  }

  if (pageIsLong || selectionIsLong) {
    return {
      content: pageUrl,
      type: 'url' as const,
      pageTitle,
      pageUrl,
    };
  }

  return {
    content: pageUrl,
    type: 'url' as const,
    pageTitle,
    pageUrl,
  };
}

function buildPayload(
  target:
    | {
      content: string;
      type: 'selection';
      pageTitle: string;
      pageUrl: string;
    }
    | {
      content: string;
      type: 'url';
      pageTitle: string;
      pageUrl: string;
    },
  settings: Settings,
) {
  const customPrompt = settings.customPrompt.trim();
  const promptTemplate = customPrompt || PROMPT_TEMPLATES[settings.promptMode] || '';
  const metadata = settings.includeMetadata
    ? buildMetadata(target.pageTitle, target.pageUrl, target.type)
    : '';

  if (settings.promptMode === 'smart' && !customPrompt) {
    const base =
      target.type === 'selection'
        ? target.content
        : `Summarize this page: ${target.content}`;
    return metadata ? `${base}\n\n${metadata}` : base;
  }

  if (target.type === 'url') {
    const instruction = promptTemplate || 'Analyze this page:';
    return metadata
      ? `${instruction} ${target.content}\n\n${metadata}`
      : `${instruction} ${target.content}`;
  }

  const instruction = promptTemplate || 'Use this context:';
  return metadata
    ? `${instruction}\n\n${target.content}\n\n${metadata}`
    : `${instruction}\n\n${target.content}`;
}

function buildMetadata(title: string, url: string, targetType: 'selection' | 'url') {
  const parts = [];
  if (title) {
    parts.push(`Title: ${title}`);
  }
  if (url && targetType === 'selection') {
    parts.push(`Source: ${url}`);
  }
  return parts.join('\n');
}
