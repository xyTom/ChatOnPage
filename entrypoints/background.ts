import { browser } from 'wxt/browser';

type Provider = 'perplexity' | 'chatgpt' | 'claude';
type OpenMode = 'popup' | 'tab';
type Action = 'summary' | 'translate' | 'rewrite' | 'followup';

interface Settings {
  provider: Provider;
  openMode: OpenMode;
}

interface LanguageInfo {
  code: string;
  displayName: string;
}

interface BuildExtras {
  language?: LanguageInfo;
  followupQuestion?: string;
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
const CONTEXT_MENU_ROOT_ID = 'chatonpage.ask';
const CONTEXT_MENU_SUMMARY_ID = 'chatonpage.ask.summary';
const CONTEXT_MENU_TRANSLATE_ID = 'chatonpage.ask.translate';
const CONTEXT_MENU_REWRITE_ID = 'chatonpage.ask.rewrite';
const CONTEXT_MENU_FOLLOWUP_ID = 'chatonpage.ask.followup';
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

// Serialize context menu setup calls to avoid duplicate IDs from overlapping runs
let setupContextMenusChain: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  // Initialize sequentially to avoid racing menu creation
  void (async () => {
    await ensureDefaultSettings();
    await setupContextMenus();
  })();

  browser.action.onClicked.addListener((tab) => {
    void handleTrigger(tab, 'summary');
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
      case CONTEXT_MENU_SUMMARY_ID:
        void handleTrigger(tab, 'summary');
        break;
      case CONTEXT_MENU_TRANSLATE_ID:
        void handleTrigger(tab, 'translate');
        break;
      case CONTEXT_MENU_REWRITE_ID:
        void handleTrigger(tab, 'rewrite');
        break;
      case CONTEXT_MENU_FOLLOWUP_ID:
        void handleTrigger(tab, 'followup');
        break;
      default:
        break;
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === COMMAND_ID) {
      void handleTrigger(undefined, 'summary');
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

async function handleTrigger(tab: BrowserTab | undefined, action: Action = 'summary') {
  const activeTab = tab?.id !== undefined ? tab : await getActiveTab();
  if (!activeTab?.id) {
    await notifyFailure('Unable to get the current page information. Please try again.');
    return;
  }

  const settings = await getSettings();
  const pageInfo = await extractPageInfo(activeTab.id);
  const extras: BuildExtras = {};

  if (action === 'translate') {
    extras.language = getPreferredUILanguage();
  }

  if (action === 'followup') {
    const followupQuestion = await requestFollowupQuestion(activeTab.id);
    if (!followupQuestion) {
      return;
    }
    extras.followupQuestion = followupQuestion;
  }

  const targetUrl = buildProviderUrl(pageInfo, activeTab, settings.provider, action, extras);

  if (!targetUrl) {
    await notifyFailure('Unable to generate the question. Please try again.');
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
  action: Action,
  extras: BuildExtras = {},
): string | null {
  const baseUrl = PROVIDER_URLS[provider] ?? PROVIDER_URLS.perplexity;
  const context = createPageContext(pageInfo, tab);
  let payload: string | null = null;

  switch (action) {
    case 'summary':
      if (context.selectionIsShort) {
        payload = context.selection;
      } else if (context.pageIsLong) {
        payload = context.pageUrl ?? context.truncatedSelection;
        if (!payload && context.title) {
          payload = `Summarize: ${context.title}`;
        }
      } else if (context.pageUrl) {
        payload = context.title
          ? `Summarize this page: ${context.title} ${context.pageUrl}`
          : `Summarize this page: ${context.pageUrl}`;
      } else if (context.truncatedSelection) {
        payload = context.truncatedSelection;
      } else if (context.title) {
        payload = `Summarize: ${context.title}`;
      }
      break;
    case 'translate': {
      const language = extras.language;
      if (!language) {
        return null;
      }
      const languageLabel = language.displayName || language.code;

      if (context.selectionIsShort) {
        payload = `Translate the following into ${languageLabel}: ${context.selection}`;
      } else if (context.pageUrl) {
        payload = `Translate this page into ${languageLabel}: ${context.pageUrl}`;
      } else if (context.hasSelection) {
        payload = `Translate the following into ${languageLabel} (long content; partial excerpt): ${context.truncatedSelection}`;
      } else if (context.title) {
        payload = `Translate content related to "${context.title}" into ${languageLabel}.`;
      } else {
        payload = `Translate into ${languageLabel}.`;
      }
      break;
    }
    case 'rewrite':
      if (context.selectionIsShort) {
        payload = `Rewrite and polish the following: ${context.selection}`;
      } else if (context.pageUrl) {
        payload = context.title
          ? `Read the page "${context.title}" and rewrite/polish its key content: ${context.pageUrl}`
          : `Rewrite and polish the key content of this page: ${context.pageUrl}`;
      } else if (context.hasSelection) {
        payload = `Rewrite and polish the following (long content; partial excerpt): ${context.truncatedSelection}`;
      } else if (context.title) {
        payload = `Rewrite and polish content related to "${context.title}".`;
      }
      break;
    case 'followup': {
      const question = extras.followupQuestion?.trim();
      if (!question) {
        return null;
      }

      if (context.selectionIsShort) {
        payload = `Here is relevant content: ${context.selection}\nPlease answer my follow-up question based on it: ${question}`;
      } else if (context.pageUrl) {
        payload = context.title
          ? `Page "${context.title}": ${context.pageUrl}\nPlease answer my follow-up question based on this page: ${question}`
          : `Page: ${context.pageUrl}\nPlease answer my follow-up question based on this page: ${question}`;
      } else if (context.hasSelection) {
        payload = `Here is relevant content (long content; partial excerpt): ${context.truncatedSelection}\nPlease answer my follow-up question based on it: ${question}`;
      } else if (context.title) {
        payload = `Please answer my follow-up question using information related to "${context.title}": ${question}`;
      } else {
        payload = question;
      }
      break;
    }
    default:
      payload = context.selection;
      break;
  }

  if (!payload) {
    return null;
  }

  return `${baseUrl}${encodeURIComponent(payload)}`;
}

interface PageContext {
  selection: string;
  truncatedSelection: string;
  hasSelection: boolean;
  selectionIsShort: boolean;
  selectionIsLong: boolean;
  pageIsLong: boolean;
  pageUrl: string | null;
  title: string;
}

function createPageContext(
  pageInfo: PageExtractionResult | null,
  tab: BrowserTab,
): PageContext {
  const extractionSucceeded = pageInfo?.success ?? false;
  const rawSelection = extractionSucceeded && pageInfo ? pageInfo.selection : '';
  const selection = rawSelection.trim();
  const hasSelection = selection.length > 0;
  const pageTextLength = extractionSucceeded && pageInfo ? pageInfo.pageTextLength : 0;
  const selectionIsShort = hasSelection && selection.length <= MAX_Q;
  const selectionIsLong = hasSelection && selection.length > MAX_Q;
  const truncatedSelection = selectionIsShort ? selection : selection.slice(0, MAX_Q).trim();
  const pageUrlCandidate =
    (extractionSucceeded && pageInfo ? pageInfo.url : undefined) || tab.url || '';
  const pageUrl = pageUrlCandidate && pageUrlCandidate.trim().length > 0 ? pageUrlCandidate : null;
  const titleCandidate =
    (extractionSucceeded && pageInfo ? pageInfo.title : undefined) ?? tab.title ?? '';
  const title = titleCandidate.trim();
  const pageIsLong =
    (!hasSelection && pageTextLength > LONG_PAGE_THRESHOLD) || selectionIsLong;

  return {
    selection,
    truncatedSelection,
    hasSelection,
    selectionIsShort,
    selectionIsLong,
    pageIsLong,
    pageUrl,
    title,
  };
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
  const run = async () => {
    const idsToRemove = [
      CONTEXT_MENU_FOLLOWUP_ID,
      CONTEXT_MENU_REWRITE_ID,
      CONTEXT_MENU_TRANSLATE_ID,
      CONTEXT_MENU_SUMMARY_ID,
      CONTEXT_MENU_ROOT_ID,
    ];

    for (const id of idsToRemove) {
      try {
        await browser.contextMenus.remove(id);
      } catch (error) {
        if (!isIgnorableContextMenuError(error)) {
          console.warn('Failed to remove context menu', id, error as any);
        }
      }
    }

    const settings = await getSettings();
    const language = getPreferredUILanguage();
    const rootTitle = `ChatOnPage: Ask with ${PROVIDER_LABELS[settings.provider]}`;
    const translationLabel = formatLanguageMenuLabel(language);

    try {
      await browser.contextMenus.create({
        id: CONTEXT_MENU_ROOT_ID,
        title: rootTitle,
        contexts: ['selection', 'page'],
        // Keep root enabled so its submenu can be opened
        // (a disabled parent prevents expanding children in some browsers)
      });

      await browser.contextMenus.create({
        id: CONTEXT_MENU_SUMMARY_ID,
        parentId: CONTEXT_MENU_ROOT_ID,
        title: 'Summarize this content',
        contexts: ['selection', 'page'],
      });

      await browser.contextMenus.create({
        id: CONTEXT_MENU_TRANSLATE_ID,
        parentId: CONTEXT_MENU_ROOT_ID,
        title: `Translate to ${translationLabel} (system language)`,
        contexts: ['selection', 'page'],
      });

      await browser.contextMenus.create({
        id: CONTEXT_MENU_REWRITE_ID,
        parentId: CONTEXT_MENU_ROOT_ID,
        title: 'Rewrite & polish',
        contexts: ['selection', 'page'],
      });

      await browser.contextMenus.create({
        id: CONTEXT_MENU_FOLLOWUP_ID,
        parentId: CONTEXT_MENU_ROOT_ID,
        title: 'Ask a follow-up…',
        contexts: ['selection', 'page'],
      });
    } catch (error) {
      const message = (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message?: string }).message)
        : '';
      if (message.includes('duplicate id')) {
        // Another instance likely created menus concurrently; safe to ignore
        console.warn('Context menus already exist; skipping duplicate creation');
      } else {
        console.error('Failed to create context menus', error);
      }
    }
  };

  // Chain to avoid overlapping executions which cause duplicate IDs
  setupContextMenusChain = setupContextMenusChain.then(run, run);
  await setupContextMenusChain;
}

function isIgnorableContextMenuError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false;
  }
  const message = String((error as { message?: string }).message);
  return message.includes('Invalid menu item') || message.includes('Cannot find menu item');
}

function getPreferredUILanguage(): LanguageInfo {
  const code = browser.i18n?.getUILanguage?.() ?? 'en';
  const normalized = code && code.length > 0 ? code : 'en';
  const base = normalized.split(/[-_]/)[0] ?? normalized;
  let displayName = normalized;

  try {
    const displayNames = new Intl.DisplayNames([normalized], { type: 'language' });
    const resolved = displayNames.of(base);
    if (resolved) {
      displayName = resolved;
    }
  } catch (error) {
    try {
      const fallbackDisplay = new Intl.DisplayNames(['en'], { type: 'language' });
      const resolved = fallbackDisplay.of(base);
      if (resolved) {
        displayName = resolved;
      }
    } catch (innerError) {
      console.warn('Failed to resolve language display name', innerError);
    }
  }

  return {
    code: normalized,
    displayName: displayName.trim() || normalized,
  };
}

function formatLanguageMenuLabel(language: LanguageInfo): string {
  const code = language.code.trim();
  const name = language.displayName.trim();
  if (!name && !code) {
    return 'System language';
  }
  if (!name) {
    return code;
  }
  if (!code) {
    return name;
  }
  return name.toLowerCase() === code.toLowerCase() ? name : `${name} (${code})`;
}

async function requestFollowupQuestion(tabId: number): Promise<string | null> {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: showFollowupPrompt,
    });

    const value = result?.result as string | null | undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  } catch (error) {
    console.error('Failed to collect follow-up question', error);
    return null;
  }
}

function showFollowupPrompt(): Promise<string | null> {
  const OVERLAY_ID = 'chatonpage-followup-overlay';
  return new Promise<string | null>((resolve) => {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      existing.remove();
    }

    if (!document.body) {
      resolve(null);
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.background = 'rgba(15, 23, 42, 0.55)';
    overlay.style.backdropFilter = 'blur(2px)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';

    let resolved = false;
    const cleanup = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(value);
    };

    const container = document.createElement('div');
    container.style.width = 'min(480px, 92vw)';
    container.style.background = '#ffffff';
    container.style.borderRadius = '16px';
    container.style.boxShadow = '0 24px 48px rgba(15, 23, 42, 0.25)';
    container.style.padding = '24px';
    container.style.fontFamily =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    container.style.color = '#0f172a';
    container.style.lineHeight = '1.55';

    const title = document.createElement('h2');
    title.textContent = 'Enter follow-up question';
    title.style.margin = '0 0 12px 0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';

    const description = document.createElement('p');
    description.textContent = 'Enter your follow-up question (press Ctrl/⌘ + Enter to submit).';
    description.style.margin = '0 0 16px 0';
    description.style.fontSize = '14px';
    description.style.color = '#475569';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Example: Please elaborate on the second point.';
    textarea.style.width = '100%';
    textarea.style.minHeight = '112px';
    textarea.style.resize = 'vertical';
    textarea.style.border = '1px solid rgba(148, 163, 184, 0.6)';
    textarea.style.borderRadius = '10px';
    textarea.style.padding = '12px';
    textarea.style.fontSize = '15px';
    textarea.style.boxSizing = 'border-box';
    textarea.style.outline = 'none';
    textarea.style.color = '#0f172a';
    textarea.style.background = '#f8fafc';
    textarea.maxLength = 500;
    textarea.spellcheck = true;

    textarea.addEventListener('focus', () => {
      textarea.style.background = '#ffffff';
      textarea.style.border = '1px solid #2563eb';
      textarea.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.15)';
    });

    textarea.addEventListener('blur', () => {
      textarea.style.background = '#f8fafc';
      textarea.style.border = '1px solid rgba(148, 163, 184, 0.6)';
      textarea.style.boxShadow = 'none';
    });

    const actions = document.createElement('div');
    actions.style.marginTop = '18px';
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '12px';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.style.padding = '8px 16px';
    cancelButton.style.fontSize = '14px';
    cancelButton.style.borderRadius = '999px';
    cancelButton.style.border = '1px solid rgba(148, 163, 184, 0.6)';
    cancelButton.style.background = '#fff';
    cancelButton.style.color = '#1f2937';
    cancelButton.style.cursor = 'pointer';

    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.textContent = 'Send';
    submitButton.style.padding = '8px 18px';
    submitButton.style.fontSize = '14px';
    submitButton.style.borderRadius = '999px';
    submitButton.style.border = 'none';
    submitButton.style.background = '#2563eb';
    submitButton.style.color = '#ffffff';
    submitButton.style.cursor = 'pointer';
    submitButton.style.boxShadow = '0 12px 20px rgba(37, 99, 235, 0.25)';

    const handleSubmit = () => {
      const value = textarea.value.trim();
      cleanup(value.length > 0 ? value : null);
    };

    cancelButton.addEventListener('click', () => {
      cleanup(null);
    });

    submitButton.addEventListener('click', handleSubmit);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(null);
      }
    });

    container.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(null);
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleSubmit();
      }
    });

    actions.append(cancelButton, submitButton);
    container.append(title, description, textarea, actions);
    overlay.append(container);
    document.body.append(overlay);

    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
    });
  });
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
