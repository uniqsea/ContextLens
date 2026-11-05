# ContextLens

看见模型真正看到的。ContextLens 让 AI 助手的上下文与记忆可见、可改、可追溯：

- **取景条**：输入框上方的分段横条就是下一次请求的完整上下文，每段宽度对应它的 token 数。输入问题后可查看相关材料，再选择本轮要带入的记忆和文件。
- **句子级来源**：模型回答时标注每句话依据的上下文，记忆场里的卡片用连线直接连到那句话。悬停一句话，它的依据被"对焦"，其余卡片虚化。
- **步骤卡**：展开每一轮实际执行的步骤，可以检查输入、输出和发送的上下文。修改上下文后可以重新生成，并查看回答版本。
- **情境**：每轮用记忆前自动判断主要属于哪个情境（真的横跨时最多两个）、此刻在做什么、提到了什么，显示在回答下方；判断错了可以直接改、调亮或调暗概念，回答会原地重写。默认有工作、学习、生活三个大情境并带定义，可在设置里修改，也可以描述你的使用习惯让 AI 帮你选或生成，只用来浏览和轻微参考；项目才是边界，默认隔离。
- **记忆场**：卡片显示材料与问题的相关性。把记忆或文件拖入本轮输入区，按希望发送的顺序排好。

## 快速开始

需要 Node.js 22+ 和 [uv](https://docs.astral.sh/uv/)。

```bash
npm install
npm run setup
```

模型在输入框旁边选择：第一次点 **连接模型**，连接一家服务商（DeepSeek、OpenAI、Kimi、通义、智谱等，目录来自 [models.dev](https://models.dev)，均通过兼容 OpenAI 的接口调用）；之后在同一个弹窗里换模型、调推理强度，或从底部的“添加或管理模型”进入服务商设置。密钥只保存在本机 `~/.contextlens/settings.json`（仅本人可读），不会发回浏览器。

这是密钥和模型选择的唯一来源，不读环境变量。

**向量检索不用配置**：`npm run setup` 会下载约 2.4 GB 的 `Qwen3-Embedding-0.6B`，运行时常驻约 2 GB 内存，全程在本机计算。记忆检索会在关键词之外按意思匹配，跨语言也能找到（用中文问能找到英文写的记忆）。没有模型文件时只按关键词检索。也可以在“添加或管理模型 → 高级”里换成服务商的 embedding 模型，这时记忆内容会发给该服务商，相似度阈值也要重新核对。

在 `frontend/.env.local` 写入：

```bash
LANGGRAPH_API_URL=http://localhost:2026
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=context_agent
```

然后：

```bash
npm run dev:demo   # 独立演示数据库，位于 agent/data/lens-demo-memories.sqlite3
npm run dev        # 你自己的记忆，数据库在 agent/data/contextlens.sqlite3
```

新数据库默认从空记忆开始。本地可选的初始化文件为 `shared/memory-seeds.json`（普通模式）和 `shared/lens-demo-seeds.json`（演示模式）；两者均不纳入版本控制，已有本地文件仍会用于初始化新数据库。缺少文件时应用正常启动，不导入示例记忆。

打开 [http://localhost:3001](http://localhost:3001)。端口可用 `LANGGRAPH_PORT`、`FRONTEND_PORT` 覆盖。两个服务都只监听本机。

## 结构

后端依赖只从外层指向内层：`graph`、`api` → `engine`、`context`、`provenance` → `records` → `memory` → `models` → `config`。

| 位置 | 作用 |
|---|---|
| `agent/contextlens/graph.py` | 应用图：一轮 = 组装上下文快照 → 引擎回答 → 记录版本；可重写或撤销任意一轮 |
| `agent/contextlens/engine.py` | 引擎：[Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) 跑模型与工具循环；只有这里依赖 deepagents。关闭了子 agent 和自动摘要，上下文只能经由快照进入 |
| `agent/contextlens/context/` | 选择上下文：想起的记忆、文档与历史、历史依赖失效，输出带原因的快照和指纹 |
| `agent/contextlens/provenance/` | 句子级来源：提示模型标注，再把回答解析成"句子 + 来源" |
| `agent/contextlens/memory/` | 记忆系统：记忆与概念、只追加的事件账本（改动都能撤销）、用记忆前的情境识别、想起（按概念、当时情况、内容排序）、每轮写入、后台整理、agent 记忆工具；项目默认隔离 |
| `agent/contextlens/records.py` | 记忆系统和界面、上下文之间的转换 |
| `agent/contextlens/models/` | 模型目录（models.dev 缓存）、本地设置与密钥、按角色构建模型、测试连接 |
| `frontend/components/model-settings/` | 输入框旁的模型选择器（shadcn/ui 与 Base UI）与服务商设置弹窗 |
| `agent/contextlens/api.py` | `/lens/preview`（每次按键预览下一次请求，不调用对话模型）、`/lens/settings`、`/lens/memories` 与 `/lens/memory-events`（记忆库与改动历史）；拒绝一切来自浏览器的直接请求 |
| `frontend/components/lens/` | 记忆场引擎、取景条、回答与步骤卡、页面编排 |
| `frontend/app/memories/`、`frontend/components/memory-library/` | 记忆库：记忆列表与版本历史、全部改动的时间线（看前后对比、逐条撤销）、回收站与永久删除 |
| `frontend/proxy.ts`、`frontend/app/api/` | 只接受同源请求；代理只放行界面用到的 agent 接口 |
| `frontend/messages/`、`frontend/i18n/` | 中英文文案（next-intl） |

## 测试

仓库只允许公开明确的模拟数据，不提交个人信息、真实记忆、对话导出、密钥或运行数据库。个人数据、内部研究资料及来源不明确的数据保留本地。

```bash
npm run test:agent
```

依赖版本锁定在 `agent/uv.lock`，并且只解析发布满两周的版本（`agent/pyproject.toml` 中的 `exclude-newer`）。
