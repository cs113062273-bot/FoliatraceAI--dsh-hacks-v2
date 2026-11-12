# FoliaTrace — public browser product

**Bring the bottle. Start a better conversation.** On-device language AI suggests a group from "my water pill" or "my cholesterol pill"; a neural cross-encoder finds research for the bottle and each goal. Every warning stays a verbatim NIH sentence.

Live: https://foliatrace-research.civil-bell-5511.chatgpt.site

This repository contains the static `build/` declared in `.openai/hosting.json`. `ai-worker.js` and `medicine-language.js` handle language inference/exclusions. `model-search-worker.js` and `research-evidence.js` rank evidence and extract literal context. `safety-engine.js` matches verified NIH text. OCR is an optional input aid; QR carries brief data in a URL fragment. All analysis runs locally in the browser.

Fresh synthetic language holdout: 37/39 medicine descriptions assigned to the correct group (94.9%); 0 wrong group assignments, 2 left unknown; all 15 other/negated phrases left unassigned (54 synthetic English phrases total). Library: 423 licensed abstracts. Verification: 49/49 public-build and 49/49 local `/check/` real-browser checks; 18/18 behavioral unit tests. Development-calibrated research floor, unreviewed medicine mappings, synthetic language tests and other limits are disclosed in `source.zip` → `README.md` and `docs/ai_disclosure.md`.

`source.zip` contains the complete local app, source, builders, behavioral tests and evaluation reports. `one-page.pdf` introduces the product; `DATA-NOTICE.md`, `CODE-LICENSE.txt` and `inference/*LICENSE*` retain attribution. Models/tokenizers are pinned and hash-checked. `.gitattributes` preserves exact deployed bytes.

Fictional people/products. A pharmacist must confirm inferred medicine groups and clinical applicability. No generated medical warning, dose recommendation or safety guarantee.
