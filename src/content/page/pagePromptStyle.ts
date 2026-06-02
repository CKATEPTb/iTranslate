export function getPageTranslationPromptStyle(promptId: string): string {
    const root = `#${promptId}`

    return `
${root} {
  --itranslate-page-prompt-progress: 1;
  --itranslate-page-prompt-bg: rgba(15, 23, 42, .9);
  --itranslate-page-prompt-fg: #f8fafc;
  --itranslate-page-prompt-muted: #cbd5e1;
  --itranslate-page-prompt-border: rgba(148, 163, 184, .24);
  --itranslate-page-prompt-shadow: 0 14px 38px rgba(15, 23, 42, .34);
  --itranslate-page-prompt-close-bg: rgba(255, 255, 255, .08);
  --itranslate-page-prompt-secondary-bg: rgba(255, 255, 255, .06);
  --itranslate-page-prompt-secondary-border: rgba(255, 255, 255, .12);
  --itranslate-page-prompt-progress-bg: rgba(148, 163, 184, .2);
  --itranslate-page-prompt-progress-fg: #38bdf8;
  position: fixed;
  right: 14px;
  top: 14px;
  z-index: 2147483647;
  display: none;
  width: min(304px, calc(100vw - 28px));
  padding: 10px 10px 9px;
  border-radius: 14px;
  background: var(--itranslate-page-prompt-bg);
  color: var(--itranslate-page-prompt-fg);
  border: 1px solid var(--itranslate-page-prompt-border);
  box-shadow: var(--itranslate-page-prompt-shadow);
  font: 12px/1.35 -apple-system, "Segoe UI", sans-serif;
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  overflow: hidden;
}

${root}.itranslate-page-prompt-light {
  --itranslate-page-prompt-bg: rgba(248, 250, 252, .95);
  --itranslate-page-prompt-fg: #0f172a;
  --itranslate-page-prompt-muted: #64748b;
  --itranslate-page-prompt-border: rgba(15, 23, 42, .12);
  --itranslate-page-prompt-shadow: 0 14px 34px rgba(15, 23, 42, .14);
  --itranslate-page-prompt-close-bg: rgba(15, 23, 42, .07);
  --itranslate-page-prompt-secondary-bg: rgba(255, 255, 255, .72);
  --itranslate-page-prompt-secondary-border: rgba(15, 23, 42, .1);
  --itranslate-page-prompt-progress-bg: rgba(15, 23, 42, .1);
  --itranslate-page-prompt-progress-fg: #0284c7;
}

${root} .itranslate-page-prompt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px;
  align-items: start;
  gap: 8px;
  margin-bottom: 9px;
}

${root} .itranslate-page-prompt-title-wrap {
  min-width: 0;
}

${root} .itranslate-page-prompt-title {
  min-width: 0;
  margin: 0;
  font-weight: 760;
  color: var(--itranslate-page-prompt-fg);
  font-size: 13px;
  line-height: 1.2;
}

${root} .itranslate-page-prompt-context {
  display: block;
  margin-top: 3px;
  color: var(--itranslate-page-prompt-muted);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

${root} .itranslate-page-prompt-close {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: var(--itranslate-page-prompt-close-bg);
  color: var(--itranslate-page-prompt-muted);
  cursor: pointer;
  font: 15px/1 -apple-system, "Segoe UI", sans-serif;
}

${root} .itranslate-page-prompt-actions {
  display: grid;
  grid-template-columns: 1.18fr .82fr .82fr;
  gap: 6px;
}

${root} button {
  font: 11.5px/1.15 -apple-system, "Segoe UI", sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

${root} .itranslate-page-prompt-primary,
${root} .itranslate-page-prompt-secondary {
  min-width: 0;
  min-height: 28px;
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
  text-align: center;
}

${root} .itranslate-page-prompt-primary {
  border: 1px solid rgba(56, 189, 248, .72);
  background: #38bdf8;
  color: #082f49;
  font-weight: 750;
}

${root} .itranslate-page-prompt-secondary {
  border: 1px solid var(--itranslate-page-prompt-secondary-border);
  background: var(--itranslate-page-prompt-secondary-bg);
  color: var(--itranslate-page-prompt-fg);
}

${root} button:hover {
  filter: brightness(1.06);
}

${root} button:focus {
  outline: 2px solid rgba(56, 189, 248, .45);
  outline-offset: 1px;
}

${root} .itranslate-page-prompt-progress {
  height: 2px;
  margin: 9px -10px -9px;
  background: var(--itranslate-page-prompt-progress-bg);
  overflow: hidden;
}

${root} .itranslate-page-prompt-progress-bar {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--itranslate-page-prompt-progress-fg);
  transform-origin: left center;
  transform: scaleX(var(--itranslate-page-prompt-progress));
}

@media (max-width: 340px) {
  ${root} .itranslate-page-prompt-actions {
    grid-template-columns: 1fr 1fr;
  }

  ${root} .itranslate-page-prompt-primary {
    grid-column: 1 / -1;
  }
}
`.trim()
}
