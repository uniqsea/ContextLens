import { Client, ThreadState } from "@langchain/langgraph-sdk";
import {
  LangChainMessage,
  LangGraphCommand,
} from "@assistant-ui/react-langgraph";

const createClient = () => {
  const apiUrl =
    new URL("/api", window.location.href).href;
  return new Client({
    apiUrl,
  });
};

export const createThread = async () => {
  const client = createClient();
  return client.threads.create();
};

export const getThreadState = async (
  threadId: string,
): Promise<ThreadState<{ messages: LangChainMessage[] }>> => {
  const client = createClient();
  return client.threads.getState(threadId);
};

export const sendMessage = async (params: {
  threadId: string;
  messages?: LangChainMessage[];
  command?: LangGraphCommand | undefined;
  context?: Record<string, unknown>;
}) => {
  const client = createClient();
  return client.runs.stream(
    params.threadId,
    process.env["NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID"]!,
    {
      input: params.messages?.length
        ? {
            ...params.context,
            messages: params.messages,
          }
        : null,
      command: params.command,
      streamMode: ["messages", "updates"],
    },
  );
};
