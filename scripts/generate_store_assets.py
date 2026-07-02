from __future__ import annotations

import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "store-assets" / "chrome-web-store"

EDGE_CANDIDATES = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
)


SCENES = {
    "screenshot-1-sidepanel": (1280, 800),
    "screenshot-2-selection-tooltip": (1280, 800),
    "screenshot-3-page-translation-prompt": (1280, 800),
    "screenshot-4-original-tooltip": (1280, 800),
    "screenshot-5-provider-rules": (1280, 800),
    "promo-small-440x280": (440, 280),
    "promo-large-1400x560": (1400, 560),
}


CSS = """
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: "Segoe UI", Inter, Arial, sans-serif;
  color: #e5f2ff;
  background: #06111f;
}
body { -webkit-font-smoothing: antialiased; }
.scene {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 15% 12%, rgba(56, 189, 248, 0.18), transparent 28%),
    linear-gradient(135deg, #07111f 0%, #0a1224 42%, #071a27 100%);
}
.chrome {
  position: absolute;
  inset: 28px;
  border-radius: 18px;
  background: #0a101d;
  border: 1px solid rgba(148, 163, 184, 0.26);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42);
  overflow: hidden;
}
.browser-bar {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 16px;
  background: #0e1729;
  border-bottom: 1px solid rgba(148, 163, 184, 0.20);
  color: #8ca3c2;
  font-size: 13px;
}
.dot { width: 11px; height: 11px; border-radius: 50%; }
.red { background: #f87171; }
.yellow { background: #fbbf24; }
.green { background: #34d399; }
.address {
  margin-left: 12px;
  flex: 1;
  height: 25px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.20);
  display: flex;
  align-items: center;
  padding: 0 14px;
}
.site-body {
  position: absolute;
  left: 0;
  top: 42px;
  bottom: 0;
  right: 0;
  padding: 38px 44px;
  color: #cbd5e1;
}
.article {
  max-width: 770px;
  line-height: 1.62;
  font-size: 18px;
}
.article h1 {
  margin: 0 0 18px;
  color: #f8fafc;
  font-size: 36px;
  line-height: 1.14;
  letter-spacing: 0;
}
.article p { margin: 0 0 18px; }
.article .muted { color: #91a4bc; font-size: 15px; }
.sidepanel {
  position: absolute;
  top: 42px;
  right: 0;
  bottom: 0;
  width: 380px;
  background: #050b19;
  border-left: 1px solid rgba(148, 163, 184, 0.22);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel-card, .field, .output, .history-card, .popup-card, .prompt, .tooltip {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.80);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.26);
}
.panel-card {
  border-radius: 13px;
  padding: 13px;
}
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #93c5fd;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 11px;
}
.theme-btn {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  display: grid;
  place-items: center;
  color: #bfdbfe;
  background: rgba(2, 6, 23, 0.45);
}
.select-row { display: grid; grid-template-columns: 1fr 36px 1fr; gap: 9px; }
.select, .input-mini {
  height: 36px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #070d1e;
  color: #f8fafc;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  min-width: 0;
}
.swap {
  height: 36px;
  width: 36px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: #93c5fd;
  background: #070d1e;
  border: 1px solid rgba(148, 163, 184, 0.28);
}
.field, .output {
  border-radius: 13px;
  padding: 16px;
  min-height: 178px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 15px;
  line-height: 1.48;
}
.field { color: #eef6ff; }
.output { color: #c7f9d4; }
.button-row { display: grid; grid-template-columns: 1fr 76px 76px; gap: 9px; }
.primary, .secondary {
  height: 38px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-weight: 650;
  font-size: 14px;
}
.primary { color: #fff; background: #2563eb; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.30); }
.secondary { color: #dbeafe; border: 1px solid rgba(148, 163, 184, 0.28); background: #0b1224; }
.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}
.history-pill {
  width: 102px;
  height: 31px;
  border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #0b1224;
  color: #9db5d5;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 650;
}
.count {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #334155;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 11px;
}
.trash {
  width: 31px;
  height: 31px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #0b1224;
}
.history-card {
  margin-top: 9px;
  border-radius: 10px;
  padding: 12px;
  overflow: hidden;
}
.history-card p {
  margin: 6px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-meta {
  color: #60a5fa;
  font-size: 12px;
  font-weight: 700;
}
.highlight {
  background: #0b63ce;
  color: white;
  padding: 2px 3px;
  border-radius: 2px;
}
.tooltip {
  position: absolute;
  max-width: 380px;
  border-radius: 14px;
  padding: 14px 16px;
  color: #eaf2ff;
  z-index: 10;
}
.tooltip .label, .prompt .label {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}
.tooltip .text {
  font-size: 16px;
  line-height: 1.44;
}
.prompt {
  position: absolute;
  top: 70px;
  right: 64px;
  width: 405px;
  border-radius: 14px;
  padding: 16px;
  overflow: hidden;
}
.prompt h3 {
  margin: 0 0 12px;
  color: #f8fafc;
  font-size: 17px;
}
.prompt-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.prompt button, .chip {
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 999px;
  background: #111827;
  color: #dbeafe;
  padding: 9px 13px;
  font-size: 13px;
}
.prompt .cta, .chip.cta { background: #38bdf8; color: #082f49; border-color: transparent; font-weight: 700; }
.timer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: #38bdf8;
}
.status-dot {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  margin-left: 6px;
  background: #10b981;
  color: #042f2e;
  font-size: 12px;
  font-weight: 900;
}
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(56, 189, 248, 0.25);
  border-top-color: #38bdf8;
  border-radius: 50%;
}
.translated {
  color: #eaf2ff;
}
.translated mark {
  background: rgba(14, 165, 233, 0.20);
  color: #e0f2fe;
  border-radius: 4px;
  padding: 1px 3px;
}
.mock-input {
  margin-top: 18px;
  width: 520px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #07111f;
  color: #9db5d5;
  display: flex;
  align-items: center;
  padding: 0 14px;
}
.popup {
  position: absolute;
  width: 390px;
  top: 78px;
  left: 110px;
}
.popup-card {
  border-radius: 18px;
  padding: 20px;
}
.popup-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
}
.brand {
  font-size: 24px;
  font-weight: 800;
  color: #fff;
}
.toolbar {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.tool {
  width: 33px;
  height: 33px;
  border: 1px solid rgba(148, 163, 184, 0.30);
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: #bfdbfe;
}
.ready {
  margin-left: auto;
  border-radius: 999px;
  color: #7dd3fc;
  background: rgba(6, 78, 59, 0.55);
  padding: 5px 9px;
  font-size: 11px;
}
.section-title {
  color: #93c5fd;
  font-size: 12px;
  text-transform: uppercase;
  margin: 18px 0 9px;
}
.rule-box {
  position: absolute;
  left: 560px;
  top: 154px;
  width: 430px;
  border-radius: 18px;
  padding: 20px;
}
.rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 12px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}
.rule-row:last-child { border-bottom: 0; }
.rule-title { color: #f8fafc; font-weight: 700; }
.rule-sub { color: #94a3b8; font-size: 13px; margin-top: 3px; }
.danger {
  color: #fecaca;
  background: rgba(127, 29, 29, 0.32);
  border: 1px solid rgba(248, 113, 113, 0.36);
  border-radius: 9px;
  padding: 7px 10px;
}
.hero {
  position: absolute;
  inset: 0;
  padding: 62px;
  display: grid;
  grid-template-columns: 0.95fr 1.35fr;
  gap: 46px;
  align-items: center;
}
.hero h1 {
  margin: 0 0 18px;
  font-size: 60px;
  line-height: 1.02;
  color: white;
}
.hero p {
  margin: 0 0 22px;
  max-width: 470px;
  color: #b8c7dc;
  font-size: 21px;
  line-height: 1.45;
}
.hero .chips { display: flex; flex-wrap: wrap; gap: 10px; }
.hero-preview {
  position: relative;
  height: 420px;
}
.promo-panel {
  position: absolute;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.86);
  box-shadow: 0 30px 80px rgba(0,0,0,0.38);
}
.small-scene {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: linear-gradient(135deg, #07111f, #0d2340 58%, #082f49);
  position: relative;
  padding: 26px;
}
.small-title {
  font-size: 36px;
  font-weight: 850;
  color: white;
  margin-bottom: 8px;
}
.small-copy {
  font-size: 16px;
  line-height: 1.35;
  color: #c8ddf6;
  max-width: 210px;
}
.small-card {
  position: absolute;
  right: 24px;
  top: 32px;
  width: 176px;
  height: 210px;
  border-radius: 17px;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(191, 219, 254, 0.28);
  padding: 12px;
  box-shadow: 0 22px 55px rgba(0,0,0,0.34);
}
.small-field {
  height: 62px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  padding: 9px;
  font-size: 11px;
  line-height: 1.25;
  color: #e0f2fe;
  margin-bottom: 9px;
}
.small-button {
  height: 30px;
  border-radius: 9px;
  background: #2563eb;
  color: white;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}
.small-tooltip {
  position: absolute;
  left: 34px;
  bottom: 24px;
  width: 234px;
  border-radius: 13px;
  border: 1px solid rgba(191, 219, 254, 0.30);
  background: rgba(2, 6, 23, 0.82);
  color: #eaf2ff;
  padding: 12px;
  font-size: 13px;
  line-height: 1.36;
}
"""


def screenshot_1_sidepanel() -> str:
    return """
    <div class="scene">
      <div class="chrome">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <div class="address">reddit.com/r/MachineLearning/comments/example</div>
        </div>
        <div class="site-body">
          <div class="article">
            <p class="muted">Discussion thread</p>
            <h1>Why page translation has to follow dynamic content</h1>
            <p>Modern websites render comments, replies, and search results after the page is already visible. A translator has to watch updates without translating the same text again.</p>
            <p>Long answers and nested comments should remain readable, even when the sidebar is open and the page keeps changing.</p>
            <p class="muted">The side panel keeps manual translation, history, and provider selection in one place.</p>
          </div>
          <aside class="sidepanel">
            <div class="panel-card">
              <div class="panel-title"><span>Translator</span><span class="theme-btn">☾</span></div>
              <div class="select" style="margin-bottom:9px">Google <span>⌄</span></div>
              <div class="select-row"><div class="select">English</div><div class="swap">⇄</div><div class="select">Russian</div></div>
            </div>
            <div class="field">iTranslate helps you translate selected text, input fields, and full web pages directly inside the browser. Very long lines now wrap instead of stretching the side panel.</div>
            <div class="button-row"><div class="primary">Translate</div><div class="secondary">Copy</div><div class="secondary">Clear</div></div>
            <div class="output">iTranslate помогает переводить выделенный текст, поля ввода и полные веб-страницы прямо в браузере.</div>
            <div>
              <div class="history-head"><div class="history-pill">⌄ History <span class="count">2</span></div><div class="trash">⌫</div></div>
              <div class="history-card">
                <div class="history-meta">Google · English -> Russian</div>
                <p>iTranslate helps you translate selected text, input fields...</p>
                <p style="color:#e0f2fe;font-weight:700">iTranslate помогает переводить выделенный текст...</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
    """


def screenshot_2_selection_tooltip() -> str:
    return """
    <div class="scene">
      <div class="chrome">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <div class="address">news.example.dev/articles/agentic-browsing</div>
        </div>
        <div class="site-body">
          <div class="article" style="max-width:880px">
            <p class="muted">Selected text translation</p>
            <h1>Translate a paragraph without leaving the page</h1>
            <p>When you select visible text, iTranslate checks the detected language first and only then shows translation progress.</p>
            <p><span class="highlight">Selected text can be translated in context, while hidden comments, collapsed replies, and off-screen metadata are ignored.</span></p>
            <p>The result appears next to the text instead of in a distant corner, so the translation stays connected to what you are reading.</p>
          </div>
          <div class="tooltip" style="left:390px; top:302px">
            <div class="label">Google · English -> Russian</div>
            <div class="text">Выделенный текст переводится в контексте, а скрытые комментарии и свернутые ответы игнорируются.</div>
          </div>
        </div>
      </div>
    </div>
    """


def screenshot_3_page_translation_prompt() -> str:
    return """
    <div class="scene">
      <div class="chrome">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <div class="address">docs.example.com/guide/localization</div>
        </div>
        <div class="site-body">
          <div class="article">
            <p class="muted">Visible-language analysis</p>
            <h1>Automatic page translation suggestions</h1>
            <p>The page contains enough visible English text to offer translation into Russian. Numbers, code, and punctuation are ignored while estimating the language mismatch.</p>
            <p>The prompt respects provider capabilities and page translation rules. If the user does nothing, it disappears automatically.</p>
          </div>
          <div class="prompt">
            <h3>Похоже, страница не на русском. Перевести?</h3>
            <div class="prompt-buttons">
              <button class="cta">Перевести страницу</button>
              <button>Никогда не переводить docs.example.com</button>
              <button>Всегда переводить с английского</button>
            </div>
            <div class="timer"></div>
          </div>
        </div>
      </div>
    </div>
    """


def screenshot_4_original_tooltip() -> str:
    return """
    <div class="scene">
      <div class="chrome">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <div class="address">app.example.dev/search?q=browser+translator</div>
        </div>
        <div class="site-body">
          <div class="article translated" style="max-width:900px">
            <p class="muted">Page translation in progress</p>
            <h1>Переведенный контент остается связанным с оригиналом</h1>
            <p><mark>Расширение переводит только видимые элементы</mark><span class="status-dot">✓</span>, а затем продолжает следить за обновлениями страницы.</p>
            <p style="position:relative">При наведении после короткой задержки можно открыть оригинальный текст в копируемом тултипе.</p>
            <div class="mock-input">Введите поисковый запрос...</div>
          </div>
          <div class="tooltip" style="left:420px; top:284px; width:420px">
            <div class="label">Original text</div>
            <div class="text">The extension translates only visible elements and then keeps watching page updates.</div>
          </div>
          <div style="position:absolute; left:918px; top:184px; display:flex; align-items:center; gap:9px; color:#7dd3fc; font-size:14px">
            <span class="spinner"></span><span>Translating updated content</span>
          </div>
        </div>
      </div>
    </div>
    """


def screenshot_5_provider_rules() -> str:
    return """
    <div class="scene">
      <div class="chrome">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <div class="address">chrome-extension://itranslate/popup.html</div>
        </div>
        <div class="site-body">
          <div class="popup">
            <div class="popup-card">
              <div class="popup-head">
                <div class="brand">iTranslate</div>
                <div class="toolbar"><div class="tool">▣</div><div class="tool">⚙</div><div class="tool">☾</div></div>
              </div>
              <div style="display:flex;align-items:center;margin-bottom:8px"><span style="color:#cbd5e1;font-size:13px">Translator</span><span class="ready">Page ready</span></div>
              <div class="select">Google <span>⌄</span></div>
              <div style="color:#34d399;font-size:13px;margin-top:10px">Page translation is available for this provider.</div>
              <div class="section-title">Selected text</div>
              <div class="select-row" style="grid-template-columns:1fr 1fr"><div class="select">auto</div><div class="select">ru</div></div>
              <div class="section-title">Input text</div>
              <div class="select-row" style="grid-template-columns:1fr 1fr"><div class="select">ru</div><div class="select">en</div></div>
              <div class="section-title">API key (optional)</div>
              <div class="input-mini"></div>
            </div>
          </div>
          <div class="popup-card rule-box">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div class="brand" style="font-size:22px">Page translation rules</div>
              <div class="tool">×</div>
            </div>
            <div class="rule-row">
              <div><div class="rule-title">Always translate English</div><div class="rule-sub">Global language rule</div></div>
              <div class="danger">Delete</div>
            </div>
            <div class="rule-row">
              <div><div class="rule-title">Never translate reddit.com</div><div class="rule-sub">Site-specific rule</div></div>
              <div class="danger">Delete</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    """


def promo_small() -> str:
    return """
    <div class="small-scene">
      <div class="small-title">iTranslate</div>
      <div class="small-copy">Selected text, input fields, and full-page translation in one compact extension.</div>
      <div class="small-card">
        <div style="color:#93c5fd;font-size:10px;text-transform:uppercase;margin-bottom:8px">Translator</div>
        <div class="small-field">Hello! Translate this paragraph without leaving the page.</div>
        <div class="small-field" style="color:#c7f9d4">Привет! Переведите этот абзац прямо на странице.</div>
        <div class="small-button">Translate</div>
      </div>
      <div class="small-tooltip">Tooltip translation stays next to the selected text.</div>
    </div>
    """


def promo_large() -> str:
    return """
    <div class="scene">
      <div class="hero">
        <div>
          <div style="color:#7dd3fc;font-size:18px;font-weight:800;margin-bottom:12px">iTranslate</div>
          <h1>Translate where you read and write</h1>
          <p>Selected text, input fields, dynamic pages, and provider rules in a compact Chromium extension.</p>
          <div class="chips">
            <span class="chip cta">Selected text</span>
            <span class="chip">Input fields</span>
            <span class="chip">Page translation</span>
            <span class="chip">Language rules</span>
          </div>
        </div>
        <div class="hero-preview">
          <div class="promo-panel" style="left:20px;top:12px;width:365px;height:360px;padding:18px">
            <div class="panel-title"><span>Translator</span><span class="theme-btn">☾</span></div>
            <div class="select" style="margin-bottom:9px">Google <span>⌄</span></div>
            <div class="field" style="min-height:112px">Translate selected text and page updates without opening a new tab.</div>
            <div class="primary" style="margin:10px 0">Translate</div>
            <div class="output" style="min-height:100px">Переводите выделенный текст и обновления страницы без новой вкладки.</div>
          </div>
          <div class="prompt" style="top:58px;right:18px;width:430px">
            <h3>Похоже, страница не на русском. Перевести?</h3>
            <div class="prompt-buttons"><button class="cta">Перевести страницу</button><button>Всегда переводить с английского</button></div>
            <div class="timer"></div>
          </div>
          <div class="tooltip" style="right:72px;bottom:32px;width:385px">
            <div class="label">Original text</div>
            <div class="text">Copyable tooltips keep translations and source text close to the content.</div>
          </div>
        </div>
      </div>
    </div>
    """


MARKUP = {
    "screenshot-1-sidepanel": screenshot_1_sidepanel,
    "screenshot-2-selection-tooltip": screenshot_2_selection_tooltip,
    "screenshot-3-page-translation-prompt": screenshot_3_page_translation_prompt,
    "screenshot-4-original-tooltip": screenshot_4_original_tooltip,
    "screenshot-5-provider-rules": screenshot_5_provider_rules,
    "promo-small-440x280": promo_small,
    "promo-large-1400x560": promo_large,
}


def find_browser() -> Path:
    for candidate in EDGE_CANDIDATES:
        if candidate.exists():
            return candidate
    for name in ("msedge", "chrome", "chromium"):
        found = shutil.which(name)
        if found:
            return Path(found)
    raise RuntimeError("Could not find Microsoft Edge, Chrome, or Chromium.")


def html_for(scene: str) -> str:
    markup = MARKUP[scene]()
    return textwrap.dedent(
        f"""\
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>{scene}</title>
          <style>{CSS}</style>
        </head>
        <body>{markup}</body>
        </html>
        """
    )


def render_scene(browser: Path, scene: str, width: int, height: int, user_data_dir: Path) -> Path:
    html_path = OUT_DIR / f"_{scene}.html"
    png_path = OUT_DIR / f"_{scene}.png"
    jpg_path = OUT_DIR / f"{scene}.jpg"
    html_path.write_text(html_for(scene), encoding="utf-8")

    try:
        subprocess.run(
            [
                str(browser),
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--no-first-run",
                "--no-default-browser-check",
                "--force-device-scale-factor=1",
                f"--user-data-dir={user_data_dir}",
                f"--window-size={width},{height}",
                f"--screenshot={png_path}",
                html_path.resolve().as_uri(),
            ],
            check=True,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        with Image.open(png_path) as image:
            rgb = image.convert("RGB")
            if rgb.size != (width, height):
                rgb = rgb.resize((width, height), Image.Resampling.LANCZOS)
            rgb.save(jpg_path, format="JPEG", quality=94, subsampling=0, optimize=True)
        return jpg_path
    finally:
        html_path.unlink(missing_ok=True)
        png_path.unlink(missing_ok=True)


def verify(paths: list[Path]) -> None:
    for path in paths:
        expected = SCENES[path.stem]
        with Image.open(path) as image:
            if image.mode != "RGB":
                raise RuntimeError(f"{path.name}: expected RGB JPEG, got {image.mode}")
            if image.size != expected:
                raise RuntimeError(f"{path.name}: expected {expected}, got {image.size}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    browser = find_browser()
    paths: list[Path] = []
    with tempfile.TemporaryDirectory(prefix="itranslate-store-assets-") as profile:
        profile_path = Path(profile)
        for scene, (width, height) in SCENES.items():
            paths.append(render_scene(browser, scene, width, height, profile_path))
    verify(paths)
    for path in paths:
        with Image.open(path) as image:
            print(f"{path.relative_to(ROOT)} {image.size[0]}x{image.size[1]} {image.mode}")


if __name__ == "__main__":
    main()
