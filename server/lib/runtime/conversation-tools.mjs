import { searchConversationIndex, readConversationMessages } from "./conversation-index.mjs";

export const CONVERSATION_SEARCH_DEFINITION = {
  type: "function",
  function: {
    name: "conversation_search",
    description: "Search past conversation messages, summaries, and memories across personal chats, archived chats, or projects.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Keyword or search query to find in past conversations."
        },
        timeRange: {
          type: "string",
          description: "Optional time range restriction, e.g. 'last_week', 'last_month', or a custom ISO date string."
        },
        scope: {
          type: "string",
          description: "Optional scope filter: 'all_personal_chats', 'project_chats', 'folder_chats'."
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of search results to return."
        },
        folderId: {
          type: "string",
          description: "Filter search to a specific conversation folder."
        },
        projectId: {
          type: "string",
          description: "Filter search to a specific project."
        },
        includeArchived: {
          type: "boolean",
          description: "Include archived sessions in search results."
        },
        reason: {
          type: "string",
          description: "The reason why you are performing this conversation search."
        }
      },
      required: ["query"]
    }
  }
};

export const CONVERSATION_READ_DEFINITION = {
  type: "function",
  function: {
    name: "conversation_read",
    description: "Retrieve specific messages and their surrounding context from a past conversation session.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: {
          type: "string",
          description: "The ID of the session containing the messages."
        },
        messageIds: {
          type: "array",
          items: {
            type: "string"
          },
          description: "The list of specific message IDs to read."
        },
        includeSurroundingMessages: {
          type: "boolean",
          description: "Whether to include surrounding messages (context window) around the target messages."
        },
        surroundingWindow: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Number of messages to retrieve before and after the target message (defaults to 4)."
        }
      },
      required: ["sessionId"]
    }
  }
};

export async function executeConversationSearch(workspaceRoot, args = {}) {
  const query = args.query || "";
  const options = {
    timeRange: args.timeRange,
    scope: args.scope,
    maxResults: args.maxResults || 10,
    folderId: args.folderId,
    projectId: args.projectId,
    includeArchived: args.includeArchived === true
  };
  const results = await searchConversationIndex(workspaceRoot, query, options);
  return { results };
}

export async function executeConversationRead(workspaceRoot, args = {}) {
  const sessionId = args.sessionId;
  const messageIds = args.messageIds || [];
  const options = {
    includeSurroundingMessages: args.includeSurroundingMessages !== false,
    surroundingWindow: args.surroundingWindow || 4
  };
  return await readConversationMessages(workspaceRoot, sessionId, messageIds, options);
}
