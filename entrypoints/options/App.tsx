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
    description: '默认推荐，支持直接解析长文 URL 并快速生成总结。',
  },
  {
    value: 'chatgpt',
    label: 'ChatGPT',
    description: '适合自由提问，支持将选中文本或页面信息直接带入对话。',
  },
  {
    value: 'claude',
    label: 'Claude',
    description: '强调长文理解与分析，在复杂问题场景表现稳定。',
  },
];

const OPEN_MODE_OPTIONS: { value: OpenMode; label: string; description: string }[] = [
  {
    value: 'popup',
    label: '弹出窗口（960×800）',
    description: '在独立的小窗中打开 AI 工具，保持当前页面可见。',
  },
  {
    value: 'tab',
    label: '新标签页',
    description: '在当前窗口中新开标签页进行提问。',
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
        setErrorMessage('加载设置失败，请刷新页面后重试。');
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
      setErrorMessage('保存失败，请稍后重试。');
    }
  };

  const renderStatus = () => {
    if (status === 'idle') return null;
    if (status === 'saving') {
      return <p className="status saving">正在保存…</p>;
    }
    if (status === 'saved') {
      return <p className="status saved">已保存</p>;
    }
    return <p className="status error">{errorMessage || '发生未知错误'}</p>;
  };

  return (
    <div className="options">
      <header className="header">
        <div>
          <h1>ChatOnPage</h1>
          <p>配置默认的 AI Provider 与打开方式。</p>
        </div>
      </header>

      {settings ? (
        <>
          <section className="section">
            <h2>默认 Provider</h2>
            <p className="section-hint">选择用于一键提问时打开的 AI 工具。</p>
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
            <h2>打开方式</h2>
            <p className="section-hint">决定打开 Provider 时是在弹窗还是新标签页中展示。</p>
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
        <div className="loading">正在加载设置…</div>
      )}

      {renderStatus()}
    </div>
  );
}

export default App;
