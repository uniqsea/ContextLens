# ContextLens

## Start the Project

Install dependencies if this is the first run:

```bash
npm install
npm install --prefix frontend
```

Set up the agent package in the `contextlens` conda environment:

```bash
conda create -n contextlens python=3.11
npm run setup:agent
```

Create or update the environment files:

- `agent/.env`
- `frontend/.env.local`

The frontend can use the local LangGraph server:

```bash
LANGGRAPH_API_URL=http://localhost:2026
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=context_agent
```

Start both the LangGraph agent and the Next.js frontend:

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

Default local services:

- Agent: [http://localhost:2026](http://localhost:2026)
- Frontend: [http://localhost:3001](http://localhost:3001)

You can override ports when starting:

```bash
LANGGRAPH_PORT=2027 FRONTEND_PORT=3002 npm run dev
```

## Original Starter Notes

This is the [assistant-ui](https://github.com/Yonom/assistant-ui) starter project for langgraph.

## Getting Started

First, add your langgraph API url and assistant id to `.env.local` file:

```
LANGCHAIN_API_KEY=your_langchain_api_key
LANGGRAPH_API_URL=your_langgraph_api_url
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=your_assistant_id_or_graph_id
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
