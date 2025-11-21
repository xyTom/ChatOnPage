import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';

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
    { value: 'perplexity', label: 'Perplexity', description: 'Best for research' },
    { value: 'chatgpt', label: 'ChatGPT', description: 'Versatile chat' },
    { value: 'claude', label: 'Claude', description: 'Deep analysis' },
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

function App() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    useEffect(() => {
        const loadSettings = async () => {
            const stored = await browser.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
            setSettings(normalizeSettings(stored));
        };
        void loadSettings();
    }, []);

    const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
        if (!settings) return;
        const next = { ...settings, [key]: value };
        setSettings(next);
        await browser.storage.sync.set({ [key]: value });
    };

    const handleChatNow = async () => {
        window.close();
        // Send message to background script to trigger chat
        await browser.runtime.sendMessage({ type: 'TRIGGER_CHAT' });
    };

    if (!settings) return <div className="main-content">Loading...</div>;

    return (
        <>
            <header className="header">
                <h1>ChatOnPage</h1>
            </header>

            <div className="main-content">
                <section className="section">
                    <h2>Provider</h2>
                    <div className="option-list">
                        {PROVIDER_OPTIONS.map((option) => (
                            <label
                                key={option.value}
                                className={`option-card${settings.provider === option.value ? ' selected' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="provider"
                                    value={option.value}
                                    checked={settings.provider === option.value}
                                    onChange={() => updateSetting('provider', option.value)}
                                    style={{ display: 'none' }}
                                />
                                <div className="option-content">
                                    <span className="option-title">{option.label}</span>
                                    <span className="option-description">{option.description}</span>
                                </div>
                            </label>
                        ))}
                    </div>
                </section>

                <details className="section">
                    <summary className="details-summary" onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}>
                        Advanced Settings
                    </summary>
                    <div className="details-content">
                        <div className="toggle-row">
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={settings.includeMetadata}
                                    onChange={(e) => updateSetting('includeMetadata', e.target.checked)}
                                />
                                <span className="slider" />
                            </label>
                            <span className="option-title">Include Page Metadata</span>
                        </div>

                        <div className="section">
                            <span className="option-title">Open Mode</span>
                            <div className="toggle-row">
                                <label>
                                    <input
                                        type="radio"
                                        checked={settings.openMode === 'popup'}
                                        onChange={() => updateSetting('openMode', 'popup')}
                                    /> Popup
                                </label>
                                <label style={{ marginLeft: '1rem' }}>
                                    <input
                                        type="radio"
                                        checked={settings.openMode === 'tab'}
                                        onChange={() => updateSetting('openMode', 'tab')}
                                    /> New Tab
                                </label>
                            </div>
                        </div>

                        <div className="section">
                            <span className="option-title">Provider URLs</span>
                            {PROVIDER_OPTIONS.map((option) => (
                                <div key={option.value}>
                                    <label className="url-label">{option.label}</label>
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
                    </div>
                </details>
            </div>

            <footer className="footer">
                <button className="btn-primary" onClick={handleChatNow}>
                    Chat with {PROVIDER_OPTIONS.find(p => p.value === settings.provider)?.label}
                </button>
            </footer>
        </>
    );
}

export default App;

function normalizeSettings(stored: any): Settings {
    // Basic normalization, similar to background.ts but simplified for popup
    return {
        provider: stored.provider || DEFAULT_SETTINGS.provider,
        openMode: stored.openMode || DEFAULT_SETTINGS.openMode,
        promptMode: stored.promptMode || DEFAULT_SETTINGS.promptMode,
        customPrompt: stored.customPrompt || DEFAULT_SETTINGS.customPrompt,
        includeMetadata: stored.includeMetadata ?? DEFAULT_SETTINGS.includeMetadata,
        providerUrls: { ...DEFAULT_SETTINGS.providerUrls, ...stored.providerUrls },
    };
}
