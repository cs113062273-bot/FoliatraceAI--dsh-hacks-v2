# FoliaTrace — public site

**Bring the bottle. Start a better conversation.** A supplement label goes in; a pharmacist brief comes out, with every warning quoted word-for-word from the U.S. National Institutes of Health (NCCIH) and matched to the person's own medicines.

Live: https://foliatrace-research.civil-bell-5511.chatgpt.site

This repository is the deployable static build (`build/`, published by `.openai/hosting.json`). Everything runs in the browser:

| Path | Purpose |
|---|---|
| `index.html`, `check.js`, `demo.css` | Checker: NIH label search, paste or photo input, medicines, pharmacist brief, QR handoff |
| `safety-engine.js`, `safety-knowledge.json`, `safety-examples.js` | Matching engine, NIH-verified knowledge base (25 herbs, 74 quoted passages, 134 medicines), fictional examples |
| `ocr/`, `vendor/qrcode.js` | On-device text recognition (Tesseract) and QR encoder |
| `demo.js`, `model-search-worker.js`, `pair-tokenizer.js`, `inference/`, `browser-library.json`, `care-cases.json` | On-device research ranking and recorded pharmacist evidence cases |
| `source.zip` | Full source: local app, knowledge-base builder, tests, browser QA and real-label evaluation |
| `one-page.pdf`, `DATA-NOTICE.md`, `CODE-LICENSE.txt` | One-page overview, data attribution, MIT licence |

FoliaTrace prepares a conversation with a pharmacist; it does not give medical advice or state that a combination is safe. Example people and labels are fictional.
