# FoliaTrace AI

FoliaTrace AI helps older adults and caregivers prepare for a conversation with a pharmacist about supplements and medicines. It combines the bottle's ingredients, the person's own description of their medicines and their reason for taking the supplement in a source-linked brief.

**[Open the working product](https://foliatrace-research.civil-bell-5511.chatgpt.site)** · [One-page project description](build/one-page.pdf) · [Full product source](build/source.zip)

## The problem and the people using it

A person may remember a medicine as "my cholesterol pill" while a supplement label lists an unfamiliar plant, a proprietary blend or an ingredient already present in another bottle. Connecting that information to a relevant source takes several steps.

- **Older adults and other supplement users** enter the bottle and the medicines they remember.
- **Caregivers** bring together several products and preserve the questions that the labels leave open.
- **Pharmacists** review source passages, confirm suggested medicine groups and compare a product with the preparations used in research.

The resulting brief includes medicine-related NIH cards, ambiguous plant identities, blend-dose questions, repeated ingredients and research leads for the entered goal.

## Use the product

1. Select **Check a bottle**. Search NIH product labels, paste an ingredient list or upload a photo of the Supplement Facts panel. Photo text is editable before it becomes a product.
2. Add medicine names, brands, typos or everyday descriptions. Add the supplement goal and relevant circumstances, such as a planned procedure.
3. Select **Build my brief**. Read the AI medicine-group suggestion beside the original words, inspect the NIH quotations and review the ingredient questions.
4. Open **Research leads, ranked on your device**. Compare the label with the study's population, preparation and comparator excerpts. Pharmacists can also enter a different research question.
5. Select **Hand to pharmacist (QR)** to open the brief on another screen, or use **Print / PDF** or **Download**. Choose which medicine, circumstance and ingredient details to include in the exported copy.

Choose **Mei**, **Sam** or **Ray** on the homepage to run an example immediately.

## AI architecture and its contribution

| Component | Technology | What it does |
|---|---|---|
| Medicine descriptions | `sentence-transformers/all-MiniLM-L6-v2` sentence embeddings | Compares unresolved descriptions with medicine-group prototypes using cosine similarity after exact-name, brand and typo lookup |
| Research retrieval | BM25 | Retrieves up to 20 candidate abstracts for each herb and user goal |
| Research ranking | `cross-encoder/ms-marco-MiniLM-L6-v2` | Scores query/abstract pairs and orders leads from 423 open-access abstracts; up to two leads per herb clear the relevance threshold |
| Label photo input | Tesseract.js LSTM OCR | Reads the photographed ingredient panel into editable text |
| Source cards | Deterministic ingredient/medicine rules | Selects the relevant text from 74 verified NIH passages covering 25 herbs |
| Model execution | ONNX Runtime Web, WebAssembly and browser workers | Runs medicine understanding and research ranking on the device |

**Ray shows the difference AI makes.** With the same products and medicines, a dictionary-only run leaves "my cholesterol pill" unresolved and produces the goldenseal/metformin medicine card. The semantic model proposes a statin group, which adds the red yeast rice NIH card. The original words, suggested group, source passage and question to confirm the exact medicine remain visible together.

Research ranking also uses the person's input: Mei's memory and joint-pain goals produce separate ginkgo and turmeric leads. Ray's unrelated goldenseal studies are withheld by the relevance filter. Each displayed lead retains literal study excerpts for the pharmacist to inspect.

## Completed demonstration workflows

These four workflows ran on the public site on 13 November 2026. Profiles and the photographed label are fictional; the fourth workflow retrieves a live NIH product record.

| Case and input | Observed result |
|---|---|
| **Mei, 72:** warfarin, "her water pill," memory/joint blend | AI suggests a blood-pressure medicine group; ginkgo/garlic source cards for warfarin, ginseng species candidates and blend-dose questions appear; research separates memory from joint pain |
| **Sam, 29:** sertraline, birth control pill, St. John's wort/valerian/chamomile blend | Two medicine-specific NIH cards appear, together with chamomile species candidates |
| **Ray, 61:** metformin, "my cholesterol pill," lisinopril and two supplements | AI adds the red yeast rice medicine card; goldenseal/metformin and green tea repeated across bottles are shown; unrelated goldenseal research is withheld |
| **Own bottle:** live NIH ginkgo label plus photo; Coumadin, "zolpidm," "my blood pressure pill," ibuprofen; sleep goal | Brand/typo lookup and semantic inference work together; ginkgo/Coumadin and valerian/zolpidem cards, duplicate ginkgo and unresolved ibuprofen remain visible; a fresh browser opens the same brief from its QR link, and the medicine-excluded download removes all four names |

The source archive preserves the inputs, source URLs, model outputs, research scores and handoff/export results in `reports/project_scenarios_2026-11-13.json`. The same-input AI comparison is in `reports/ai_feature_ablation_2026-11-12.json`.

## Evaluation results

| Evaluation | Dataset and result | Evidence in the source archive |
|---|---|---|
| Medicine understanding | 54 synthetic English phrases: 37/39 medicine descriptions assigned to the correct group, 0 wrong groups, 2 left unassigned; all 15 negative/other inputs unassigned | `reports/ai_medicine_understanding_v2_2026-11-12.json` |
| Ingredient matching | 789 held-out NIH labels: 96.3% exact-species precision and 99.3% genus-or-better precision | `reports/label_matching_holdout_2026-11-12.json` |
| Separate full-local research benchmark | SciFact: 188 annotated claims, 5,183 abstracts; nDCG@10 0.812 with BM25, 0.826 with hybrid retrieval, 0.866 with neural reranking | `reports/retrieval_external.json` |

The browser worker and Python agree on group decisions across the original 34-phrase regression set and the fresh 54-phrase evaluation.

## Data flow and handoff

Medicine descriptions, goals, circumstances and photos are processed in the browser. NIH receives the separate product-search query or label record ID. A handoff link stores the case inputs in its compressed URL fragment, and the receiving browser rebuilds the brief. The recipient can choose to save it on that device. Export settings recompute the shared content so excluded medicine names also disappear from source cards and personal questions.

## Repository contents

This repository contains the deployable browser product in `build/`. The complete development source is packaged in `build/source.zip`, including the FastAPI/SQLite application, frontend source, build scripts, evaluation inputs/results and AI development disclosure.

| Location | Contents |
|---|---|
| `build/index.html`, CSS and JavaScript | Interactive checker, pharmacist research and brief handoff |
| `build/inference/` | Pinned sentence-embedding and cross-encoder models, tokenizers and ONNX Runtime |
| `build/ocr/`, `build/vendor/` | Browser-local label recognition and QR generation |
| `build/*.json` | NIH knowledge, licensed abstracts, recorded comparisons and report-derived metrics |
| `build/one-page.pdf`, `build/source.zip` | One-page project description and full development source |

## Run the browser product locally

Clone this repository and serve its included assets with Python 3.11+:

```powershell
git clone https://github.com/cs113062273-bot/FoliatraceAI--dsh-hacks-v2.git
cd FoliatraceAI--dsh-hacks-v2
python -m http.server 8015 --directory build
```

Open **http://127.0.0.1:8015/**. The two neural models and OCR assets are included. Live NIH label lookup uses an internet connection; the first inference loads the model files into browser memory.

## Run the full application from source

Extract `build/source.zip`, open its `foliatrace/` directory and use Python 3.11+ and Node 24. Install the pinned dependencies and generate the browser assets:

```powershell
npm ci
python -m pip install -r requirements.lock
python scripts/setup_model.py
python scripts/setup_reranker.py
node scripts/build_browser_inference.mjs
python scripts/build_safety_knowledge.py
python scripts/build_care_demo.py
python scripts/sync_public_demo.py
.\scripts\start.ps1
```

Open **http://127.0.0.1:8000/check/**. The full FastAPI/SQLite application adds saved consultations, version history and pharmacist reading decisions. The browser product also includes five recorded study-to-product comparisons, explicitly labelled as replays.

To run the software checks from the extracted source directory:

```powershell
npm test
node scripts/verify_checker.mjs http://127.0.0.1:8000/check
```

## Source rights and development

[Data and model attribution](build/DATA-NOTICE.md) · [MIT code licence](build/CODE-LICENSE.txt)

`docs/ai_disclosure.md` in the source archive documents the model architecture, evaluation methods and development provenance. Hao directed the product with substantial Codex and Claude assistance. The project grew from an EthnoHack literature workspace into the DSH bottle-to-pharmacist workflow. NIH quotations, article licences and pinned model revisions are recorded with the source. Product code uses the MIT licence.
