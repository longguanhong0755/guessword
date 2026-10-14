# GuessWord

纯本地的多语言语义猜词游戏（Semantle 类）。没有后端，所有计算都在浏览器里跑。

- 玩法：猜一个单词，系统告诉你它和神秘词的语义距离排名（1 = 答案，越小越近），提示不限次，难度按等级区间选择。
- **六种语言**：英语（牛津 CEFR A1–C2）、日语（JLPT N5–N1）、韩语（延世韩国语 1–6 册）、法语/德语/西班牙语（语料词频 6 档）。
- 词库：英语 21,376 词（已清理专名与语料垃圾、合并变形）；日语 21,867（JLPT 7,608 谜底 + 扩展）；韩语 6,411；法/德/西各约 3.9 万。
- 语义引擎：ConceptNet Numberbatch 19.08（CC BY-SA 4.0）多语言 300 维词向量，int8 量化内嵌，本地计算余弦相似度。
- 变形自动归并（英语）：复数/时态/比较级/英式拼写自动算作原形（cats→cat、went→go、colour→color），内嵌 6,630 条映射。
- 词典：Wiktionary 释义（CC BY-SA）+ 中文翻译；非英语语言附读音（日语假名等），点任意词可查。
- 附加：生词本、历史记录（含语言标签）、明暗主题、音效、移动端适配。全程无 emoji，线条 SVG 图标。

## 直接玩

线上：https://guessword-173.pages.dev/

本地：双击 `index.html` 即可（零依赖、不需要服务器）。仓库内嵌英语 + 日语 + 韩语数据；法/德/西三种语言的数据不在仓库里，需要 `build-variant.mjs` 生成部署版（或在线游玩）。

离线单文件版：`node build/bundle.mjs` 生成 `dist/guessword.html`（把 index.html + css + js 全部内联回单个文件，方便分发）。

## 仓库结构

- `index.html` — 页面结构（拆出来的入口，引用下面这些文件）
- `css/app.css` — 全部样式
- `js/app.js` — 全部游戏逻辑（可读、可搜索；原来是 34MB 单文件里的一整块）
- `js/data-en.js` / `js/data-ja.js` / `js/data-ko.js` — 各语言词向量 + 词典数据（生成产物，改动用 `build/` 脚本）
- `js/data-extra.js` — 法/德/西数据的占位（真实数据在 `D:/gw-dl/lang/pack-<L>.json`、`dict-<L>.json`，部署时由构建脚本注入）
- `build/compose.mjs` — 把上面这些合成单文件形态（构建与打包共用）
- `build-variant.mjs` — 生成分片部署变体（0.39MB 壳 + 每语言独立的词向量/词典分片 + 双源并行 + Cache API + 单次尝试超时重试）
- `deploy.sh` — 两阶段发布到 Cloudflare Pages（需要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，可放在 gitignore 的 `deploy.local.env` 里）
- `build/` — 数据管线脚本：
  - 词向量：`nb-extract.mjs` / `nb-fallback.mjs` / `nb-swap.mjs`（英语），`extract-multi.mjs`（多语言单遍提取）
  - 词表手术：`extract-kaikki.py` / `plan-vocab.py` / `apply-vocab.mjs`
  - 多语言：`build-lang-vocab.py`（JLPT/延世/词频词表）→ `build-pack-lang.mjs`（量化打包）；`extract-kaikki-lang.py` + `merge-vocab-dict.py`（词典）
  - 维护工具：`split-master.py`（把单文件母本拆成当前结构）、`set-dict.mjs`（词典数据改动后回写 `js/data-<L>.js`）、`bundle.mjs`（离线单文件产物）
- `test-live.py` / `test-variant.py` / `test-split.py` / `probe.py` / `diag-boot.py` / `build/test-lang.py` — patchright 无头浏览器验证
- `site/` — 构建产物（gitignore，随时可用 build-variant.mjs 重建）

## 数据管线注意事项

- 改了词向量/词典内容必须 bump `build-variant.mjs` 顶部的 `VER`（分片 immutable 一年缓存，靠 URL 破缓存）；纯逻辑改动不用。
- 大型原始数据（Wiktionary/kaikki jsonl、ECDICT sqlite、Numberbatch 向量）不在仓库里，管线脚本需要它们在位才能重跑。
- 词表手术的核心护栏：`plan-vocab.py` 里"有独立词义的词不合并"（thought/spoke/gone 这类）、"无证据不动谜底级词"、词频选最优词元（does→do 而非 does→doe）。
- 浏览器对超大单文件有实际限制（实测本机 ~46MB 可加载、81MB 崩溃），所以母本只内嵌三语；分片部署不受此限制。
