# ContextLens

[English](README.en.md) · 中文

看见模型真正看到的。ContextLens 是一个带长期记忆的通用 Agent，它让模型每一轮用到的上下文与记忆看得见、改得动、可追溯。

## 界面

- **取景条**：输入框上方的分段横条就是下一次请求的完整上下文，每段宽度对应它的 token 数。边打字边预览，每一项都写明为什么入选；记忆和文件可以拖进或拖出本轮。
- **记忆场**：画布上的卡片是本轮可用的记忆、项目文件和以前的对话，按与问题的相关程度排布。
- **句子级来源**：回答的每句话都标出依据，卡片用连线连到那句话。悬停一句话，它的依据被"对焦"，其余卡片虚化。
- **情境**：每轮回答前先判断这一刻属于哪个场景、正在做什么、提到了哪些人和事物，结果显示在回答下方。判断错了可以直接改，也可以调亮或调暗某个概念，回答随即重写。
- **步骤卡**：展开每一轮实际执行的步骤，查看每次工具调用的输入、输出和发给模型的上下文。一轮可以重写多次，也可以撤回到上一版。
- **记忆库**：浏览、编辑全部记忆，查看每条记忆的版本历史和所有改动的时间线（带前后对比），逐条撤销；也可以粘贴别的助手或自己的笔记，挑选后批量导入。
- **项目**：一个项目绑定若干本地文件夹，带自己的说明和对话列表。项目默认与其他内容隔离，也可以设为共享，读取普通对话里的记忆。

## 记忆如何工作

- **情境**：情境由三部分组成：场景（默认是工作、学习、生活，各带定义，可在设置里修改，也可以描述自己的习惯让 AI 生成）、正在做的事、提到的人和事物。连续几轮都不属于已有场景时，系统会提议新场景，用户同意后生效。
- **想起**：召回主要看三点：是否涉及同样的人和事物、写下时在做的事与现在是否相近、内容是否相关；场景相同起辅助作用。内容相关同时按关键词和意思匹配，用中文问也能找到英文写的记忆。另有少量"始终带上"的记忆，每轮都在。
- **写入**：每轮回答后自动整理出新记忆，识别用户的更正和已经过时的事实，旧记忆标为被取代。
- **整理**：后台定期合并同一事物的不同叫法、替换过时的记忆；证据互相冲突、无法判断时，向用户提问，问题出现在收件箱里。
- **账本**：每次改动都写进只追加的事件账本，记下谁改的、为什么改、依据哪句话，可以逐条撤销。

## Agent 与上下文

- **快照**：每一轮先由上下文快照组装请求：系统提示、项目说明、对话历史、记忆和文件，每项带入选原因，整体有指纹。Agent 执行与组装分开，快照原样存进这一轮的记录。
- **工具**：Agent 有三类工具：记忆工具（判断情境、召回、写入、修订、遗忘、关联概念、提议场景），历史对话搜索，以及读取项目文件夹的文件工具（`ls`、`glob`、`grep`、`read_file`，只读）。工具查到的内容自动成为回答可引用的来源，并出现在画布上。
- **项目文件**：选中的文件整份放进请求；超过 2 万 token 的文件交给 Agent 用文件工具按需读取。PDF 和 Word 按内容检索，其他文件按文件名出现。
- **检索**：历史对话和 PDF、Word 文档按句切段（LlamaIndex），用 BM25（SQLite FTS5 加 jieba 分词）和本地向量混合检索，以 RRF 融合排序。文件夹在绑定时、文件变动时（监听）和后端启动时，由后台增量更新索引；向量在本机计算。

## 快速开始

需要 Node.js 22+ 和 [uv](https://docs.astral.sh/uv/)。

```bash
npm install
npm run setup
```

`setup` 安装前后端依赖，并下载约 2.4 GB 的向量模型 `Qwen3-Embedding-0.6B`（运行时常驻约 2 GB 内存，全程在本机计算）。也可以在"添加或管理模型 → 高级"里换成服务商的 embedding 模型，这时被检索的内容会发给该服务商。

在 `frontend/.env.local` 写入：

```bash
LANGGRAPH_API_URL=http://localhost:2026
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=context_agent
```

然后：

```bash
npm run dev        # 你自己的记忆：agent/data/contextlens.sqlite3
npm run dev:demo   # 独立的演示数据库：agent/data/lens-demo-memories.sqlite3
```

打开 [http://localhost:3001](http://localhost:3001)，第一次点输入框旁的 **连接模型**，选一家服务商（DeepSeek、OpenAI、Kimi、通义、智谱等，目录来自 [models.dev](https://models.dev)，通过兼容 OpenAI 的接口调用）。之后在同一个弹窗里换模型、调推理强度，或进入服务商设置。密钥只保存在本机 `~/.contextlens/settings.json`（仅本人可读），不会发回浏览器。

两个服务都只监听本机，端口可用 `LANGGRAPH_PORT`、`FRONTEND_PORT` 修改。

## 结构

后端依赖只从外层指向内层：`graph`、`api` → `engine`、`context`、`provenance` → `records` → `memory` → `models` → `config`。

| 位置 | 作用 |
|---|---|
| `agent/contextlens/graph.py` | 应用图：一轮 = 组装上下文快照 → 引擎回答 → 记录版本 → 写入记忆；可重写或撤回任意一轮 |
| `agent/contextlens/engine.py` | 引擎：[Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) 跑模型与工具循环，只有这里依赖 deepagents；关闭了子 agent 和自动摘要，上下文由快照和工具结果构成 |
| `agent/contextlens/context/` | 组装快照：记忆、文件、对话历史，每项带入选原因，输出提示和指纹 |
| `agent/contextlens/provenance/` | 句子级来源：给每项材料分配短编号，把回答解析成"句子 + 来源" |
| `agent/contextlens/memory/` | 记忆系统：记忆与概念、事件账本、情境识别、想起、每轮写入、后台整理、导入、记忆工具 |
| `agent/contextlens/history.py` | 历史对话搜索与 `search_history` 工具 |
| `agent/contextlens/project_files/` | 项目文件夹：绑定、后台索引与监听、检索、给 Agent 的只读文件系统、缩略图 |
| `agent/contextlens/hybrid.py`、`passages.py` | 切段与混合检索（关键词 + 向量，RRF 融合），历史对话与项目文件共用 |
| `agent/contextlens/conversations.py`、`projects.py` | 对话列表与项目设置 |
| `agent/contextlens/models/` | 模型目录（models.dev 缓存）、本地设置与密钥、按角色构建模型、本地向量模型 |
| `agent/contextlens/api.py` | `/lens/*` 接口：每次按键的预览（不调用对话模型）、设置、记忆库、项目、对话、导入；拒绝来自浏览器的直接请求 |
| `frontend/components/lens/` | 记忆场、取景条、回答与步骤卡、情境、收件箱 |
| `frontend/components/memory-library/` | 记忆库：列表、版本历史、改动时间线、导入 |
| `frontend/components/projects/` | 项目页、文件夹浏览、对话列表 |
| `frontend/components/model-settings/` | 模型选择器与服务商设置 |
| `frontend/proxy.ts`、`frontend/app/api/` | 只接受同源请求，代理只放行界面用到的接口 |
| `frontend/messages/`、`frontend/i18n/` | 中英文文案（next-intl） |

## 测试与数据

```bash
npm run test:agent
```

仓库里只有明确虚构的数据：测试和示例中的人物、文件和对话都是编出来的。个人信息、真实记忆、对话、密钥和运行数据库只留在本机。

依赖版本锁定在 `agent/uv.lock`，只解析发布满两周的版本（`agent/pyproject.toml` 的 `exclude-newer`）。
