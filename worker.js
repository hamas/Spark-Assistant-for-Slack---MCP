import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

class SlackClient {
  constructor(botToken) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  async getChannels(limit = 100, cursor, teamId, predefinedChannelIds) {
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: teamId || "",
      });
      if (cursor) params.append("cursor", cursor);
      const response = await fetch(`https://slack.com/api/conversations.list?${params}`, { headers: this.botHeaders });
      return response.json();
    }
    const predefinedChannelIdsArray = predefinedChannelIds.split(",").map((id) => id.trim());
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

  async postMessage(channel_id, text) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, text: text }),
    });
    return response.json();
  }

  async postReply(channel_id, thread_ts, text) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, thread_ts: thread_ts, text: text }),
    });
    return response.json();
  }

  async addReaction(channel_id, timestamp, reaction) {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({ channel: channel_id, timestamp: timestamp, name: reaction }),
    });
    return response.json();
  }

  async getChannelHistory(channel_id, limit = 10) {
    const params = new URLSearchParams({ channel: channel_id, limit: limit.toString() });
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getThreadReplies(channel_id, thread_ts) {
    const params = new URLSearchParams({ channel: channel_id, ts: thread_ts });
    const response = await fetch(`https://slack.com/api/conversations.replies?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getUsers(limit = 100, cursor, teamId) {
    const params = new URLSearchParams({ limit: Math.min(limit, 200).toString(), team_id: teamId || "" });
    if (cursor) params.append("cursor", cursor);
    const response = await fetch(`https://slack.com/api/users.list?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async getUserProfile(user_id) {
    const params = new URLSearchParams({ user: user_id, include_labels: "true" });
    const response = await fetch(`https://slack.com/api/users.profile.get?${params}`, { headers: this.botHeaders });
    return response.json();
  }

  async authTest() {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: this.botHeaders,
    });
    return response.json();
  }
}

function createSlackServer(slackClient, env) {
  const server = new McpServer({
    name: "spark-assistant-slack-mcp",
    version: "1.0.0",
  });

  server.tool(
    "slack_list_channels",
    "List public and private channels in the workspace",
    { limit: z.number().optional(), cursor: z.string().optional() },
    async ({ limit, cursor }) => {
      try {
        const result = await slackClient.getChannels(limit, cursor, env.SLACK_TEAM_ID, env.SLACK_CHANNEL_IDS);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        const channelList = result.channels.map((c) => `- #${c.name} (ID: ${c.id})`).join("\n");
        return { content: [{ type: "text", text: `Channels:\n${channelList}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing channels: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_post_message",
    "Post a message to a Slack channel",
    { channel_id: z.string(), text: z.string() },
    async ({ channel_id, text }) => {
      try {
        const result = await slackClient.postMessage(channel_id, text);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Message posted successfully to channel ${channel_id}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error posting message: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_reply_to_thread",
    "Reply to a message thread",
    { channel_id: z.string(), thread_ts: z.string(), text: z.string() },
    async ({ channel_id, thread_ts, text }) => {
      try {
        const result = await slackClient.postReply(channel_id, thread_ts, text);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Reply posted successfully` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error posting reply: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_add_reaction",
    "Add an emoji reaction to a message",
    { channel_id: z.string(), timestamp: z.string(), reaction: z.string() },
    async ({ channel_id, timestamp, reaction }) => {
      try {
        const result = await slackClient.addReaction(channel_id, timestamp, reaction);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Added :${reaction}: reaction` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error adding reaction: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_get_channel_history",
    "Get channel message history",
    { channel_id: z.string(), limit: z.number().optional() },
    async ({ channel_id, limit }) => {
      try {
        const result = await slackClient.getChannelHistory(channel_id, limit);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.messages, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting channel history: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_get_thread_replies",
    "Get replies in a thread",
    { channel_id: z.string(), thread_ts: z.string() },
    async ({ channel_id, thread_ts }) => {
      try {
        const result = await slackClient.getThreadReplies(channel_id, thread_ts);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.messages, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting thread replies: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_get_users",
    "Get list of workspace users",
    { limit: z.number().optional(), cursor: z.string().optional() },
    async ({ limit, cursor }) => {
      try {
        const result = await slackClient.getUsers(limit, cursor, env.SLACK_TEAM_ID);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.members, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting users: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_get_user_profile",
    "Get detailed profile for a user",
    { user_id: z.string() },
    async ({ user_id }) => {
      try {
        const result = await slackClient.getUserProfile(user_id);
        if (!result.ok) {
          return { content: [{ type: "text", text: `Slack API error: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.profile, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting user profile: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "slack_auth_test",
    "Test Slack API authentication and workspace info",
    {},
    async () => {
      try {
        const result = await slackClient.authTest();
        if (!result.ok) {
          return { content: [{ type: "text", text: `Auth test failed: ${result.error || "Unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Authenticated successfully as ${result.user} (ID: ${result.user_id}) on workspace ${result.team} (ID: ${result.team_id})` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error testing authentication: ${err.message}` }], isError: true };
      }
    }
  );

  return server;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (env.AUTH_TOKEN) {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== env.AUTH_TOKEN) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing token" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString(), service: "Spark Assistant Slack MCP Worker" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const botToken = env.SLACK_BOT_TOKEN || "";
      const slackClient = new SlackClient(botToken);
      const server = createSlackServer(slackClient, env);

      if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
        const body = await request.json();
        
        // Custom lightweight JSON-RPC handler for Cloudflare Workers
        if (body.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: "spark-assistant-slack-mcp",
                version: "1.0.0"
              }
            }
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (body.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "slack_list_channels", description: "List public and private channels in the workspace" },
                { name: "slack_post_message", description: "Post a message to a Slack channel" },
                { name: "slack_reply_to_thread", description: "Reply to a message thread" },
                { name: "slack_add_reaction", description: "Add an emoji reaction to a message" },
                { name: "slack_get_channel_history", description: "Get channel message history" },
                { name: "slack_get_thread_replies", description: "Get replies in a thread" },
                { name: "slack_get_users", description: "Get list of workspace users" },
                { name: "slack_get_user_profile", description: "Get detailed profile for a user" },
                { name: "slack_auth_test", description: "Test Slack API authentication and workspace info" }
              ]
            }
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        if (body.method === "tools/call") {
          const { name, arguments: args } = body.params || {};
          let resultText = "";

          if (name === "slack_auth_test") {
            const res = await slackClient.authTest();
            resultText = res.ok ? `Authenticated successfully as ${res.user} (ID: ${res.user_id}) on workspace ${res.team}` : `Auth failed: ${res.error}`;
          } else if (name === "slack_list_channels") {
            const res = await slackClient.getChannels(args?.limit, args?.cursor, env.SLACK_TEAM_ID, env.SLACK_CHANNEL_IDS);
            resultText = res.ok ? JSON.stringify(res.channels) : `Error: ${res.error}`;
          } else if (name === "slack_post_message") {
            const res = await slackClient.postMessage(args?.channel_id, args?.text);
            resultText = res.ok ? "Message posted successfully" : `Error: ${res.error}`;
          } else if (name === "slack_reply_to_thread") {
            const res = await slackClient.postReply(args?.channel_id, args?.thread_ts, args?.text);
            resultText = res.ok ? "Reply posted successfully" : `Error: ${res.error}`;
          } else if (name === "slack_add_reaction") {
            const res = await slackClient.addReaction(args?.channel_id, args?.timestamp, args?.reaction);
            resultText = res.ok ? "Reaction added" : `Error: ${res.error}`;
          } else if (name === "slack_get_channel_history") {
            const res = await slackClient.getChannelHistory(args?.channel_id, args?.limit);
            resultText = res.ok ? JSON.stringify(res.messages) : `Error: ${res.error}`;
          } else if (name === "slack_get_thread_replies") {
            const res = await slackClient.getThreadReplies(args?.channel_id, args?.thread_ts);
            resultText = res.ok ? JSON.stringify(res.messages) : `Error: ${res.error}`;
          } else if (name === "slack_get_users") {
            const res = await slackClient.getUsers(args?.limit, args?.cursor, env.SLACK_TEAM_ID);
            resultText = res.ok ? JSON.stringify(res.members) : `Error: ${res.error}`;
          } else if (name === "slack_get_user_profile") {
            const res = await slackClient.getUserProfile(args?.user_id);
            resultText = res.ok ? JSON.stringify(res.profile) : `Error: ${res.error}`;
          } else {
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }), { status: 404 });
          }

          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: resultText }]
            }
          }), { headers: { "Content-Type": "application/json" } });
        }
      }

      return new Response(JSON.stringify({
        status: "healthy",
        service: "Spark Assistant Slack MCP Cloudflare Worker",
        endpoints: ["/mcp", "/health"]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
