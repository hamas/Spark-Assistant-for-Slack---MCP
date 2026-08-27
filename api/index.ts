import { SlackClient, createApp, loadEnv } from '../index.js';

loadEnv();

const botToken = process.env.SLACK_BOT_TOKEN || '';
const slackClient = new SlackClient(botToken);
const app = createApp(slackClient);

export default app;
