import fs from 'fs';
import path from 'path';

import { createAuditLog } from '#audit';
import { createPasswordAuthProvider } from '#auth/provider';
import { createAuthStore } from '#auth/store';
import { createLoginThrottle } from '#auth/throttle';
import { createBackups } from '#backups';
import { createBudgetSession } from '#budget';
import { loadConfig } from '#config';
import { createHttpApp } from '#http';
import { startDailyJob } from '#jobs';
import { createResendMailer } from '#report/resend';
import { createSmtpMailer } from '#report/smtp';
import { createMcpServer } from '#server';

function log(message: string) {
  console.log(`[mcp-server] ${message}`);
}

function readVersion() {
  const manifest = new URL('../package.json', import.meta.url);
  const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
    version: string;
  };
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 9);
  return commit ? `${version}+${commit}` : version;
}

const config = loadConfig();
const version = readVersion();

const backups = createBackups(
  path.join(config.dataDir, 'backups'),
  config.backupRetention,
);
const session = createBudgetSession({
  serverUrl: config.actual.serverUrl,
  password: config.actual.password,
  syncId: config.actual.syncId,
  dataDir: path.join(config.dataDir, 'budget'),
  syncTtlMs: config.syncTtlMs,
  beforeWrite: () => backups.ensureDaily(),
});
const audit = createAuditLog(path.join(config.dataDir, 'audit.jsonl'));
const provider = createPasswordAuthProvider({
  store: createAuthStore(path.join(config.dataDir, 'auth.json')),
  password: config.auth.password,
  allowedRedirectUris: config.auth.allowedRedirectUris,
  throttle: createLoginThrottle({ maxFailures: 5, windowMs: 15 * 60 * 1000 }),
});
const dailyJob = config.dailyJob.enabled
  ? startDailyJob({
      session,
      backups,
      reportFile: path.join(config.dataDir, 'daily-job.json'),
      hour: config.dailyJob.hour,
      bankSync: config.dailyJob.bankSync,
      log,
    })
  : null;

function createReportMailer() {
  const { email } = config.report;
  if (!email) return null;
  return email.kind === 'smtp'
    ? createSmtpMailer(email)
    : createResendMailer(email);
}

const report = {
  mailer: createReportMailer(),
  ignoredCategories: config.report.ignoredCategories,
};

const app = createHttpApp({
  publicUrl: config.publicUrl,
  provider,
  createServer: () =>
    createMcpServer(
      { session, audit, lastDailyJob: () => dailyJob?.last() ?? null, report },
      version,
    ),
  log,
});

const httpServer = app.listen(config.port, () => {
  log(
    `v${version} listening on :${config.port}, public URL ${config.publicUrl.href}`,
  );
});

// Open the budget at boot so the first request is fast and a broken
// connection to the sync server shows up in the logs right away.
session
  .read(async () => undefined)
  .then(() => log('budget loaded'))
  .catch(error => log(`could not load the budget yet: ${String(error)}`));

async function shutdown() {
  dailyJob?.stop();
  httpServer.close();
  await session.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
