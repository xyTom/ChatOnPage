import { browser } from 'wxt/browser';
import { useEffect, useRef, useState } from 'react';
import './App.css';

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

const PROVIDER_OPTIONS: { value: Provider; label: string; description: string }[] = [
  {
    value: 'perplexity',
    label: 'Perplexity',
    description: 'Recommended default that parses long-form URLs and quickly generates summaries.',
  },
  {
    value: 'chatgpt',
    label: 'ChatGPT',
    description:
      'Great for freeform questions and can send selected text or page details directly into the chat.',
  },
  {
    value: 'claude',
    label: 'Claude',
    description:
      'Emphasizes long-form comprehension and analysis with consistent performance in complex scenarios.',
  },
];

const OPEN_MODE_OPTIONS: { value: OpenMode; label: string; description: string }[] = [
  {
    value: 'popup',
    label: 'Popup window (960×800)',
    description: 'Open the AI tool in a standalone popup while keeping the current page visible.',
  },
  {
    value: 'tab',
    label: 'New tab',
    description: 'Open a new tab in the current window to ask your question.',
  },
];

const PROMPT_MODE_OPTIONS: {
  value: PromptMode;
  label: string;
  description: string;
}[] = [
    {
      value: 'smart',
      label: 'Smart assist',
      description:
        'Send highlighted text as-is. If nothing is selected, it summarizes the current page for you.',
    },
    {
      value: 'summary',
      label: 'Tight summary',
      description: 'One clean paragraph with key details and no fluff.',
    },
    {
      value: 'keypoints',
      label: 'Key takeaways',
      description: 'Returns up to 5 bullet points so you can skim quickly.',
    },
    {
      value: 'explain',
      label: 'Explain simply',
      description: 'Plain-language explanation plus why it matters.',
    },
    {
      value: 'translate',
      label: 'Translate to English',
      description: 'Ideal for non-English pages or snippets.',
    },
  ];

const DEFAULT_SETTINGS: Settings = {
  provider: 'perplexity',
  openMode: 'popup',
  promptMode: 'smart',
  customPrompt: '',
  includeMetadata: true,
  providerUrls: {
    perplexity: 'https://www.perplexity.ai/search?q=',
    chatgpt: 'https://chatgpt.com/?q=',
    claude: 'https://claude.ai/new?q=',
  },
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      try {
        const stored = await browser.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
        if (!mounted) return;
        setSettings(normalizeSettings(stored));
      } catch (error) {
        console.error('Failed to load settings', error);
        if (!mounted) return;
        setStatus('error');
        setErrorMessage('Failed to load settings. Refresh the page and try again.');
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (!settings) return;

    const next = { ...settings, [key]: value };
    setSettings(next);
    setStatus('saving');
    setErrorMessage('');

    try {
      await browser.storage.sync.set({ [key]: value });
      setStatus('saved');
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setStatus('idle');
        resetTimerRef.current = null;
      }, 1600);
    } catch (error) {
      console.error('Failed to save settings', error);
      setStatus('error');
      setErrorMessage('Failed to save. Please try again later.');
    }
  };

  const renderStatus = () => {
    if (status === 'idle') return null;
    if (status === 'saving') {
      return <p className="status saving">Saving…</p>;
    }
    if (status === 'saved') {
      return <p className="status saved">Saved</p>;
    }
    return <p className="status error">{errorMessage || 'An unknown error occurred'}</p>;
  };

  return (
    <div className="options">
      <header className="header">
        <div>
          <p className="eyebrow">ChatOnPage</p>
          <h1>One-click answers on any page</h1>
          <p className="lede">
            Choose your default AI, set the opening behavior, and tune the prompt so you can research
            faster.
          </p>
          <div className="header-pills">
            <span className="pill">Toolbar icon</span>
            <span className="pill">Right-click menu</span>
            <span className="pill">Shortcut ⌘⇧Y / Ctrl+Shift+Y</span>
          </div>
        </div>
      </header>

      {settings ? (
        <>
          <section className="section">
            <h2>Default provider</h2>
            <p className="section-hint">Choose the AI tool that opens when you ask with one click.</p>
            <div className="option-list grid">
              {PROVIDER_OPTIONS.map((option) => {
                const checked = settings.provider === option.value;
                return (
                  <label
                    key={option.value}
                    className={`option-card${checked ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={option.value}
                      checked={checked}
                      onChange={() => updateSetting('provider', option.value)}
                    />
                    <div>
                      <span className="option-title">{option.label}</span>
                      <span className="option-description">{option.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <h2>Provider Configuration</h2>
                <p className="section-hint">
                  Customize the base URLs for each provider. Ensure they end with the query parameter (e.g., ?q=).
                </p>
              </div>
              <span className="chip">Advanced</span>
            </div>
            <div className="url-inputs">
              {PROVIDER_OPTIONS.map((option) => (
                <div key={option.value} className="url-input-group">
                  <label className="url-label">{option.label} URL</label>
                  <input
                    type="text"
                    className="url-input"
                    value={settings.providerUrls[option.value]}
                    onChange={(e) => {
                      const newUrls = { ...settings.providerUrls, [option.value]: e.target.value };
                      updateSetting('providerUrls', newUrls);
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="section">
            <h2>Open mode</h2>
            <p className="section-hint">Decide whether the provider opens in a popup or a new tab.</p>
            <div className="option-list">
              {OPEN_MODE_OPTIONS.map((option) => {
                const checked = settings.openMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={`option-card${checked ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="open-mode"
                      value={option.value}
                      checked={checked}
                      onChange={() => updateSetting('openMode', option.value)}
                    />
                    <div>
                      <span className="option-title">{option.label}</span>
                      <span className="option-description">{option.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="section">
            <h2>Prompt style</h2>
            <p className="section-hint">
              Decide how ChatOnPage frames your request before sending it to the provider.
            </p>
            <div className="option-list grid">
              {PROMPT_MODE_OPTIONS.map((option) => {
                const checked = settings.promptMode === option.value;
                return (
                  <label
                    key={option.value}
                    className={`option-card${checked ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="prompt-mode"
                      value={option.value}
                      checked={checked}
                      onChange={() => updateSetting('promptMode', option.value)}
                    />
                    <div>
                      <span className="option-title">{option.label}</span>
                      <span className="option-description">{option.description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <h2>Custom prompt (optional)</h2>
                <p className="section-hint">
                  Override the preset behavior. Whatever you type here will be prepended before the
                  selected text or page URL.
                </p>
              </div>
              <span className="chip">Power users</span>
            </div>
            <textarea
              className="prompt-input"
              placeholder='Example: "Turn this into a concise executive summary with 3 action items."'
              value={settings.customPrompt}
              onChange={(event) => updateSetting('customPrompt', event.target.value)}
              rows={3}
            />
          </section>

          <section className="section">
            <h2>Context & reliability</h2>
            <div className="toggle-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.includeMetadata}
                  onChange={(event) => updateSetting('includeMetadata', event.target.checked)}
                />
                <span className="slider" aria-hidden="true" />
              </label>
              <div>
                <p className="toggle-title">Include page title & URL</p>
                <p className="toggle-description">
                  Adds source metadata so the AI can cite and re-open the page later, even when you
                  only send text snippets.
                </p>
              </div>
            </div>
          </section>

          <section className="section usage">
            <h2>How to use</h2>
            <ul>
              <li>
                Highlight text and click the ChatOnPage icon, the context menu, or the keyboard
                shortcut.
              </li>
              <li>
                No highlight? We send the page URL with your chosen prompt so your AI can open and
                summarize it.
              </li>
              <li>Switch providers anytime in the context menu title for fast one-off changes.</li>
            </ul>
          </section>
        </>
      ) : (
        <div className="loading">Loading settings…</div>
      )}

      {renderStatus()}
    </div>
  );
}

export default App;

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

  return {
    provider,
    openMode,
    promptMode,
    customPrompt,
    includeMetadata,
    providerUrls,
  };
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
