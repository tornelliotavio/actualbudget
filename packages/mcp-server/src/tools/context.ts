import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuditLog } from '#audit';
import type { BudgetSession } from '#budget';
import type { JobReport } from '#jobs';
import type { Mailer } from '#report/mailer';

export type ToolContext = {
  session: BudgetSession;
  audit: AuditLog;
  lastDailyJob: () => JobReport | null;
  report: {
    /** Null when email isn't configured. */
    mailer: Mailer | null;
    ignoredCategories: readonly string[];
  };
};

/** Each tool module contributes its tools through one of these. */
export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;
