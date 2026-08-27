import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import { randomUUID } from "node:crypto";

export class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };

  constructor(botToken: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const predefinedChannelIds = process.env.SLACK_CHANNEL_IDS;
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: process.env.SLACK_TEAM_ID || "",
      });
      if (cursor) params.append("cursor", cursor);
      const response = await fetch(`https://slack.com/api/conversations.list?${params}`, { headers: this.botHeaders });
      return response.json();
    }
    const predefinedChannelIdsArray = predefinedChannelIds.split(",").map((id: string) => id.trim());
    const channels = [];
    for (const channelId of predefinedChannelIdsArray) {
      const params = new URLSearchParams({ channel: channelId });
      const response = await fetch(`https://slack.com/api/conversations.info?${params}`, { headers: this.botHeaders });
      const data = await response.json();
      if (data.ok && data.channel && !data.channel.is_archived) {
        channels.push(data.channel);
      }
    }
    return { ok: true, channels: channels, response_metadata: { next_cursor: "" } };
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, text: text }),
    });
    return response.json();
  }

  async postReply(channel_id: string, thread_ts: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, thread_ts: thread_ts, text: text }),
    });
    return response.json();
  }

  async addReaction(channel_id: string, timestamp: string, reaction: string): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, timestamp: timestamp, name: reaction }),
    });
    return response.json();
  }

  async getChannelHistory(channel_id: string, limit: number = 10): Promise<any> {
    const params = new URLSearchParams({ channel: channel_id, limit: limit.toString() });
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({ channel: channel_id, ts: thread_ts });
    const response = await fetch(`https://slack.com/api/conversations.replies?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({ limit: Math.min(limit, 200).toString(), team_id: process.env.SLACK_TEAM_ID || "" });
    if (cursor) params.append("cursor", cursor);
    const response = await fetch(`https://slack.com/api/users.list?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({ user: user_id, include_labels: "true" });
    const response = await fetch(`https://slack.com/api/users.profile.get?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async authTest(): Promise<any> {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: this.botHeaders,
    });
    return response.json();
  }
}

export function createSlackServer(slackClient: SlackClient): McpServer {
  const server = new McpServer({
    name: "Spark Assistant Slack MCP Server",
    version: "1.0.0",
  });

  server.registerTool("slack_auth_test", { title: "Test Slack Authentication", description: "Test bot token authentication", inputSchema: {} }, async () => {
    const response = await slackClient.authTest();
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_list_channels", { title: "List Slack Channels", description: "List channels", inputSchema: { limit: z.number().optional().default(100), cursor: z.string().optional() } }, async ({ limit, cursor }) => {
    const response = await slackClient.getChannels(limit, cursor);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_post_message", { title: "Post Slack Message", description: "Post message", inputSchema: { channel_id: z.string(), text: z.string() } }, async ({ channel_id, text }) => {
    const response = await slackClient.postMessage(channel_id, text);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_reply_to_thread", { title: "Reply to Slack Thread", description: "Reply thread", inputSchema: { channel_id: z.string(), thread_ts: z.string(), text: z.string() } }, async ({ channel_id, thread_ts, text }) => {
    const response = await slackClient.postReply(channel_id, thread_ts, text);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_add_reaction", { title: "Add Slack Reaction", description: "Add reaction", inputSchema: { channel_id: z.string(), timestamp: z.string(), reaction: z.string() } }, async ({ channel_id, timestamp, reaction }) => {
    const response = await slackClient.addReaction(channel_id, timestamp, reaction);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_get_channel_history", { title: "Get Channel History", description: "Get history", inputSchema: { channel_id: z.string(), limit: z.number().optional().default(10) } }, async ({ channel_id, limit }) => {
    const response = await slackClient.getChannelHistory(channel_id, limit);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_get_thread_replies", { title: "Get Thread Replies", description: "Get replies", inputSchema: { channel_id: z.string(), thread_ts: z.string() } }, async ({ channel_id, thread_ts }) => {
    const response = await slackClient.getThreadReplies(channel_id, thread_ts);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_get_users", { title: "Get Slack Users", description: "Get users", inputSchema: { cursor: z.string().optional(), limit: z.number().optional().default(100) } }, async ({ cursor, limit }) => {
    const response = await slackClient.getUsers(limit, cursor);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("slack_get_user_profile", { title: "Get User Profile", description: "Get user profile", inputSchema: { user_id: z.string() } }, async ({ user_id }) => {
    const response = await slackClient.getUserProfile(user_id);
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  return server;
}

const app = express();
app.use(express.json());

const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const activeAuthToken = process.env.AUTH_TOKEN;
  if (!activeAuthToken) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized: Missing Authorization header" }, id: null });
  }
  if (authHeader.substring(7) !== activeAuthToken) {
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized: Invalid token" }, id: null });
  }
  next();
};

const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post("/mcp", authMiddleware, async (req, res) => {
  try {
    const botToken = process.env.SLACK_BOT_TOKEN || "";
    const slackClient = new SlackClient(botToken);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && req.body?.method === "initialize") {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => { transports[sessionId] = transport; },
      });
      transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
      const server = createSlackServer(slackClient);
      await server.connect(transport);
    } else {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: Invalid session or non-initialize request" }, id: null });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: error?.message || "Internal server error" }, id: null });
    }
  }
});

const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

app.get("/mcp", authMiddleware, handleSessionRequest);
app.delete("/mcp", authMiddleware, handleSessionRequest);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString(), service: "Spark Assistant Slack MCP Server", version: "1.0.0" });
});

app.get("*", (req, res) => {
  res.status(200).json({ status: "healthy", message: "Spark Assistant Slack MCP Server is live on Vercel!", endpoints: ["/mcp", "/health"] });
});

export default function handler(req: any, res: any) {
  try {
    return app(req, res);
  } catch (err: any) {
    console.error("Vercel Serverless Function Error:", err);
    res.status(500).json({ error: err?.message || "Function error" });
  }
}
