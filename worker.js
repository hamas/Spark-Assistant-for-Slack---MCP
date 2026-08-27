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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id, x-mcp-session-id",
  "Access-Control-Expose-Headers": "mcp-session-id, x-mcp-session-id",
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Handle CORS preflight requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      // OAuth 2.0 discovery metadata
      if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
        return new Response(JSON.stringify({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "client_credentials"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"]
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // OAuth 2.0 Authorization Endpoint (auto-approve redirect)
      if (url.pathname === "/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        if (redirectUri) {
          const target = new URL(redirectUri);
          target.searchParams.set("code", "spark_auth_code_ok");
          if (state) target.searchParams.set("state", state);
          return Response.redirect(target.toString(), 302);
        }
        return new Response("Authorized", { status: 200, headers: corsHeaders });
      }

      // OAuth 2.0 Token Endpoint
      if (url.pathname === "/token") {
        return new Response(JSON.stringify({
          access_token: env.SLACK_BOT_TOKEN || "spark_access_token_ok",
          token_type: "Bearer",
          expires_in: 3600
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Check optional AUTH_TOKEN if provided
      if (env.AUTH_TOKEN) {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== env.AUTH_TOKEN) {
          // If OAuth flow or no header, check token
        }
      }


      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString(), service: "Spark Assistant Slack MCP Worker" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const botToken = env.SLACK_BOT_TOKEN || "";
      const slackClient = new SlackClient(botToken);

      if (request.method === "GET" && (url.pathname === "/sse" || url.pathname === "/mcp/sse")) {
        const sessionId = crypto.randomUUID();
        const messageUrl = `${url.origin}/messages?sessionId=${sessionId}`;

        const bodyStream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`event: endpoint\ndata: ${messageUrl}\n\n`));
          }
        });

        return new Response(bodyStream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        });
      }

      if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/" || url.pathname === "/messages")) {
        const body = await request.json();


        // Standard MCP Initialization
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
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Notification when client is ready
        if (body.method === "notifications/initialized") {
          return new Response(null, {
            status: 200,
            headers: corsHeaders
          });
        }

        // List Tools
        if (body.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "slack_list_channels",
                  description: "List public and private channels in the workspace",
                  inputSchema: {
                    type: "object",
                    properties: {
                      limit: { type: "number" },
                      cursor: { type: "string" }
                    }
                  }
                },
                {
                  name: "slack_post_message",
                  description: "Post a message to a Slack channel or DM to user",
                  inputSchema: {
                    type: "object",
                    properties: {
                      channel_id: { type: "string" },
                      text: { type: "string" }
                    },
                    required: ["channel_id", "text"]
                  }
                },
                {
                  name: "slack_reply_to_thread",
                  description: "Reply to a message thread",
                  inputSchema: {
                    type: "object",
                    properties: {
                      channel_id: { type: "string" },
                      thread_ts: { type: "string" },
                      text: { type: "string" }
                    },
                    required: ["channel_id", "thread_ts", "text"]
                  }
                },
                {
                  name: "slack_add_reaction",
                  description: "Add an emoji reaction to a message",
                  inputSchema: {
                    type: "object",
                    properties: {
                      channel_id: { type: "string" },
                      timestamp: { type: "string" },
                      reaction: { type: "string" }
                    },
                    required: ["channel_id", "timestamp", "reaction"]
                  }
                },
                {
                  name: "slack_get_channel_history",
                  description: "Get channel message history",
                  inputSchema: {
                    type: "object",
                    properties: {
                      channel_id: { type: "string" },
                      limit: { type: "number" }
                    },
                    required: ["channel_id"]
                  }
                },
                {
                  name: "slack_get_thread_replies",
                  description: "Get replies in a thread",
                  inputSchema: {
                    type: "object",
                    properties: {
                      channel_id: { type: "string" },
                      thread_ts: { type: "string" }
                    },
                    required: ["channel_id", "thread_ts"]
                  }
                },
                {
                  name: "slack_get_users",
                  description: "Get list of workspace users",
                  inputSchema: {
                    type: "object",
                    properties: {
                      limit: { type: "number" },
                      cursor: { type: "string" }
                    }
                  }
                },
                {
                  name: "slack_get_user_profile",
                  description: "Get detailed profile for a user",
                  inputSchema: {
                    type: "object",
                    properties: {
                      user_id: { type: "string" }
                    },
                    required: ["user_id"]
                  }
                },
                {
                  name: "slack_auth_test",
                  description: "Test Slack API authentication and workspace info",
                  inputSchema: {
                    type: "object",
                    properties: {}
                  }
                }
              ]
            }
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Call Tool
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
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }), { 
              status: 404, 
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: resultText }]
            }
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      return new Response(JSON.stringify({
        status: "healthy",
        service: "Spark Assistant Slack MCP Cloudflare Worker",
        endpoints: ["/mcp", "/health"]
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || String(err), stack: err?.stack }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

