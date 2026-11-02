import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerPrompts } from './prompts';
import { registerBudgetTools } from './tools/budget';
import { registerCardBillTools } from './tools/card-bills';
import { registerCategoryTools } from './tools/categories';
import type { ToolContext, ToolRegistrar } from './tools/context';
import { registerHistoryTools } from './tools/history';
import { registerNotebookTools } from './tools/notebook';
import { registerOverviewTools } from './tools/overview';
import { registerPayeeTools } from './tools/payees';
import { registerReportDeliveryTools } from './tools/report';
import { registerReportTools } from './tools/reports';
import { registerRuleTools } from './tools/rules';
import { registerScheduleTools } from './tools/schedules';
import { registerSyncTools } from './tools/sync';
import { registerTransactionTools } from './tools/transactions';

const INSTRUCTIONS = [
  "This server manages a personal budget in Actual Budget on the owner's behalf.",
  'Begin every session by calling read_notebook, then get_overview; the notebook holds the conventions and decisions to follow.',
  'Amounts are decimals in the budget currency; expenses are negative. Dates are YYYY-MM-DD.',
  'Prefer fixing the cause over the symptom: when a merchant keeps arriving uncategorized, extend a rule rather than only editing transactions.',
  'Changes are logged and a backup is taken before the first change each day, but still confirm with the owner before bulk or destructive changes they did not ask for.',
  'When you learn a new convention or the owner decides something, record it in the notebook.',
].join(' ');

const REGISTRARS: ToolRegistrar[] = [
  registerOverviewTools,
  registerNotebookTools,
  registerTransactionTools,
  registerScheduleTools,
  registerRuleTools,
  registerCategoryTools,
  registerBudgetTools,
  registerPayeeTools,
  registerReportTools,
  registerReportDeliveryTools,
  registerSyncTools,
  registerCardBillTools,
  registerHistoryTools,
];

export function createMcpServer(ctx: ToolContext, version: string) {
  const server = new McpServer(
    { name: 'actual-budget', version },
    { instructions: INSTRUCTIONS },
  );
  for (const register of REGISTRARS) register(server, ctx);
  registerPrompts(server);
  return server;
}
