# GuessWord

多语言语义猜词游戏（Semantle 类）。

- 玩法：猜一个单词，系统告诉你它和神秘词的语义距离排名（1 = 答案，越小越近），提示不限次，难度按等级区间选择（双滑块：默认全区间，拖动两端圆点或依次点选起止等级，同一等级点两次 = 只玩该等级；键盘方向键可调）。
- **六种语言**：英语（牛津 CEFR A1–C2）、日语（JLPT N5–N1）、韩语（延世韩国语 1–6 册）、法语/德语/西班牙语（语料词频 6 档）。
- 词库：英语 21,376 词（已清理专名与语料垃圾、合并变形）；日语 21,867（JLPT 7,608 谜底 + 扩展）；韩语 6,411；法/德/西各约 3.9 万。
- 语义引擎：ConceptNet Numberbatch 19.08（CC BY-SA 4.0）多语言 300 维词向量，int8 量化的余弦相似度排名。
  - **线上版（Pages Functions）**：排名与词典都在服务端（`functions/api/*`）。浏览器只拉每种语言 ~200KB 的轻量词表，切换语言接近秒开、永不卡界面；谜底加密存放在签名 token 里，直到揭晓前不落到浏览器。首页加载、切换语言、回到标签页都会提前预热服务端（`/api/warm`），把边缘冷启动藏进用户操作的空隙里。
  - **离线版（单文件 / 本地双击）**：没有后端，浏览器内嵌词向量、本地算排名（`buildRanks()`）。
  - 两条路径的排名逐位一致（`node test-rank-parity.mjs` 会拿六种语言逐词比对）。线上引擎不可用时自动回退到本地模式（下载该语言词向量包）。
- 变形自动归并（英语）：复数/时态/比较级/英式拼写自动算作原形（cats→cat、went→go、colour→color），内嵌 6,630 条映射。
- 词典：Wiktionary 释义（CC BY-SA）+ 中文翻译；非英语语言附读音（日语假名等），点任意词可查。线上按词查询（服务端词典分桶，`/api/def`），不再整包下载。词典未收录或加载失败时给出该语言的外部词典入口（剑桥/Jisho/NAVER/Larousse/Duden/RAE）与重试按钮。
- 未完成的对局会全部自动存档（本地保存 token/棋盘），首页"继续上局"或历史记录里的"未完成"区随时可接着玩，切换语言也能恢复。
- 结果页展示本局每次猜测的名次曲线：横轴为猜第几次、纵轴为该词在词库里的绝对名次（对数刻度，1 在顶），提示为橙色菱形；猜得很多时画布加宽、可左右滑动。
- **每日挑战**：每天每种语言自动生成一道题——同日同语言全站同一个谜底、各语言互不相同（谜底 = 词表按日期确定性取样，客户端与服务端算出的一样）。第一局记为当天正式成绩，之后重玩算练习；历史记录里会带"每日挑战"标记。
- **分享卡片**：结果页一键把本局画成图片（名次曲线 + 语言/难度 + 次数 + 站点地址），预览后可保存或发出去。
- **跨局战绩统计**：历史记录弹窗顶部一栏——局数、胜率、当前连胜、最长连胜、平均猜中、最快猜中。
- 谜底保证打得出来：英文的过常用词/屏蔽词不会被选为谜底；法/德输入的字符校验放宽了撇号、连字符与常见重音字母（aujourd'hui、Café 这类词能正常输入）。
- 附加：生词本、历史记录（含语言标签）、明暗主题、音效、移动端适配（触控热区加大、刘海/底部横条安全区、进度条动画走合成层）。全程无 emoji，线条 SVG 图标；首页右上角有 GitHub 仓库入口。
- 仓库：https://github.com/longguanhong0755/guessword

## 直接玩

线上：https://guessword-173.pages.dev/ （同一 Pages 项目的自定义域名会自动同步）

本地：双击 `index.html` 即可（零依赖、不需要服务器）。仓库内嵌英语 + 日语 + 韩语数据；法/德/西三种语言的数据不在仓库里，需要 `build-variant.mjs` 生成部署版（或在线游玩）。

离线单文件版：`node build/bundle.mjs` 生成 `dist/guessword.html`（把 index.html + css + js 全部内联回单个文件，方便分发）。

## 仓库结构

- `index.html` — 页面结构（拆出来的入口，引用下面这些文件）
- `css/app.css` — 全部样式
- `js/app.js` — 全部游戏逻辑（可读、可搜索；原来是 34MB 单文件里的一整块）
- `js/data-en.js` / `js/data-ja.js` / `js/data-ko.js` — 各语言词向量 + 词典数据（生成产物，改动用 `build/` 脚本）
- `js/data-extra.js` — 法/德/西数据的占位（真实数据在 `D:/gw-dl/lang/pack-<L>.json`、`dict-<L>.json`，部署时由构建脚本注入）
- `functions/api/` — 线上排名的 Pages Functions（`_engine.js` 共享引擎 + `new/guess/hint/def.js` 四个路由）；`__GW_VER__` 由构建脚本注入
- `build/compose.mjs` — 把上面这些合成单文件形态（构建与打包共用）
- `build-variant.mjs` — 生成部署变体到 `site/`：壳（~0.4MB）+ 每语言词表 meta + 词向量/词典分片（本地回退用）+ 词典 256 分桶（`/api/def` 用）+ `functions/`，并注入 loader
- `deploy.sh` — 两阶段发布到 Cloudflare Pages（需要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，可放在 gitignore 的 `deploy.local.env` 里）
- `deploy-vps.sh` — 发布到自托管服务器（loongsite VPS，`ssh` 走 `loongsite-vps` 别名）：无参 rebuild → sha256 清单增量对比 → tar 增量包经 ssh 上传 → 服务器端原子切换/重启引擎/冒烟。`deploy.sh` 末尾自动调用（过渡期非致命）。注意它产出的 `site/` 不含 SECHOST，别拿它再 wrangler 部署
- `build/` — 数据管线脚本：
  - 词向量：`nb-extract.mjs` / `nb-fallback.mjs` / `nb-swap.mjs`（英语），`extract-multi.mjs`（多语言单遍提取）
  - 词表手术：`extract-kaikki.py` / `plan-vocab.py` / `apply-vocab.mjs`
  - 多语言：`build-lang-vocab.py`（JLPT/延世/词频词表）→ `build-pack-lang.mjs`（量化打包）；`extract-kaikki-lang.py` + `merge-vocab-dict.py`（词典）
  - 维护工具：`split-master.py`（把单文件母本拆成当前结构）、`set-dict.mjs`（词典数据改动后回写 `js/data-<L>.js`）、`bundle.mjs`（离线单文件产物）
- 测试：
  - `test-rank-parity.mjs` — 服务端引擎 vs 客户端 `buildRanks()` 逐词逐位一致（六语言，含 HTTP 层与每日谜底取样）
  - `test-rank-parity-remote.mjs <url> [langs|all]` — 远程逐位 parity（验收自托管部署的硬证据）：从目标站现拉 meta+词向量构建本地参考，经 `/api/hint r=1` 取回谜底后，比对 `/api/guess` 与 `/api/hint` 的名次与距离逐位一致
  - `test-online.py <url>` — 线上版全链路（不下载词向量、答题/提示/查词、未完成存档与跨语言续玩、预热请求、每日挑战确定性与记分、分享卡片、统计条、词典兜底与重试、回退本地模式）
  - `test-split.py [url]` / `test-live.py` / `probe.py` / `diag-boot.py` — patchright 无头浏览器验证（`test-variant.py` 已被 `test-online.py` 取代删除；test-split 另含难度滑块默认/拖动/键盘/点选断言、GitHub 入口断言、30+ 猜长对局的名次曲线滚动断言与离线每日挑战）
- `site/` — 构建产物（gitignore，随时可用 build-variant.mjs 重建）

## 数据管线注意事项

- 改了词向量/词典内容必须 bump `build-variant.mjs` 顶部的 `VER`（分片 immutable 一年缓存，靠 URL 破缓存）；纯逻辑改动不用。
- 大型原始数据（Wiktionary/kaikki jsonl、ECDICT sqlite、Numberbatch 向量）不在仓库里，管线脚本需要它们在位才能重跑。
- 词表手术的核心护栏：`plan-vocab.py` 里"有独立词义的词不合并"（thought/spoke/gone 这类）、"无证据不动谜底级词"、词频选最优词元（does→do 而非 does→doe）。
- 浏览器对超大单文件有实际限制（实测本机 ~46MB 可加载、81MB 崩溃），所以母本只内嵌三语；分片部署不受此限制。
- 服务端排名每次请求要跑一遍全词表余弦（约 50–90ms CPU）。Cloudflare Workers 免费版单次调用 CPU 上限 10ms，付费版 30s；本项目的请求是持续性的重计算，若账号在免费计划上会出现 1102 错误——此时客户端会自动回退到本地词库模式（这也是回退路径存在的原因）。
