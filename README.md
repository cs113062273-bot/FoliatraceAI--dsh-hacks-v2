# FoliaTrace AI

FoliaTrace AI turns supplement labels and everyday medicine descriptions into a brief for the pharmacy conversation. Try Ray: “my cholesterol pill” becomes a group suggested by AI, a relevant NIH source card and a question to confirm the exact medicine.

## Try the product

**[Open FoliaTrace AI](https://foliatrace-research.civil-bell-5511.chatgpt.site)**

- Add a bottle through NIH search, pasted ingredients or a label photo.
- Describe your medicines and your goal for the supplement.
- Read the questions and cited research, then share the brief by QR or export.

**Core AI:** MiniLM sentence embeddings for medicine descriptions, plus BM25 retrieval and MiniLM cross-encoder reranking for research. Inference runs in the browser. This repository includes the static product and its pinned model assets.

## Downloads

[One-page project description](build/one-page.pdf) · [Product source](build/source.zip) · [Complete code PDF](build/code.pdf)

The source archive includes the full local app, reproducible evaluations and AI development disclosure. [Data and model attribution](build/DATA-NOTICE.md) · [MIT code licence](build/CODE-LICENSE.txt)
