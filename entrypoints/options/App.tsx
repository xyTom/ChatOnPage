import { browser } from 'wxt/browser';
import { useEffect, useRef, useState } from 'react';
import './App.css';

type Provider = 'perplexity' | 'chatgpt' | 'claude';
type OpenMode = 'popup' | 'tab';

interface Settings {
  provider: Provider;
  openMode: OpenMode;
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

const DEFAULT_SETTINGS: Settings = {
  provider: 'perplexity',
  openMode: 'popup',
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
        setSettings({ ...DEFAULT_SETTINGS, ...stored } as Settings);
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
          <h1>ChatOnPage</h1>
          <p>Configure the default AI provider and how it opens.</p>
        </div>
      </header>

      {settings ? (
        <>
          <section className="section">
            <h2>Default provider</h2>
            <p className="section-hint">Choose the AI tool that opens when you ask with one click.</p>
            <div className="option-list">
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
        </>
      ) : (
        <div className="loading">Loading settings…</div>
      )}

      {renderStatus()}
    </div>
  );
}

export default App;
