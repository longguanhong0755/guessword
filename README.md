# GuessWord

纯本地的英文语义猜词游戏（Semantle 类）。单文件离线应用，所有计算都在浏览器里跑，没有后端。

- 玩法：猜一个英文单词，系统告诉你它和神秘词的语义距离排名（1 = 答案，越小越近），提示不限次，难度按 CEFR 等级区间选择（A1–C2）。
- 词库 21,376 词（Oxford 3000/5000 + Octanove C2 词表，已清理专名与语料垃圾、合并变形）；谜底池 8,573 词。
- 语义引擎：ConceptNet Numberbatch 19.08（CC BY-SA 4.0）300 维词向量，int8 量化内嵌，本地计算余弦相似度。
- 变形自动归并：复数/时态/比较级/英式拼写自动算作原形（cats→cat、went→go、colour→color），内嵌 6,630 条映射。
- 词典：Wiktionary 英文释义（CC BY-SA）+ ECDICT 中文，内嵌懒加载，点任意词可查。
- 附加：生词本、历史记录、明暗主题、音效、移动端适配。全程无 emoji，线条 SVG 图标。

## 直接玩

线上：https://guessword-173.pages.dev/

本地：双击 `guessword.html` 即可（单文件零依赖），或 `python -m http.server 8137` 后访问 `http://127.0.0.1:8137/guessword.html`。

## 仓库结构

- `guessword.html` — 母本，唯一真源（单文件，内嵌词向量/词典/样式/逻辑）
- `build-variant.mjs` — 从母本生成分片部署变体（0.37MB 壳 + 词向量 8 分片双源并行 + 词典 6 分片懒加载 + Cache API）
- `deploy.sh` — 两阶段发布到 Cloudflare Pages（需要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，可放在 gitignore 的 `deploy.local.env` 里）
- `build/` — 数据管线脚本：
  - `nb-extract.mjs` / `nb-fallback.mjs` / `nb-swap.mjs` — Numberbatch 向量提取→词形兜底→置换进母本
  - `extract-kaikki.py` / `plan-vocab.py` / `apply-vocab.mjs` — 词表手术（去专名/合并变形）
  - `nb-compare.mjs` — 新旧模型近邻对比
- `test-live.py` / `test-variant.py` / `probe.py` / `diag-boot.py` / `build/test-lemma.py` — patchright 无头浏览器验证
- `site/` — 构建产物（gitignore，随时可用 build-variant.mjs 重建）

## 数据管线注意事项

- 改了词向量/词典内容必须 bump `build-variant.mjs` 顶部的 `VER`（分片 immutable 一年缓存，靠 URL 破缓存）；纯逻辑改动不用。
- 大型原始数据（Wiktionary jsonl、ECDICT sqlite、Numberbatch 向量）不在仓库里，管线脚本需要它们在位才能重跑。
- 词表手术的核心护栏：`plan-vocab.py` 里"有独立词义的词不合并"（thought/spoke/gone 这类）、"无证据不动谜底级词"、词频选最优词元（does→do 而非 does→doe）。
