import path from 'path';

import type { ReportShare } from '#report/types';

export type ReportEmailConfig =
  | {
      kind: 'smtp';
      host: string;
      port: number;
      user: string;
      password: string;
      from: string;
      to: string[];
    }
  | { kind: 'resend'; apiKey: string; from: string; to: string[] };

export type ServerConfig = {
  port: number;
  publicUrl: URL;
  dataDir: string;
  actual: {
    serverUrl: string;
    password: string;
    syncId?: string;
  };
  auth: {
    password: string;
    allowedRedirectUris: string[];
  };
  syncTtlMs: number;
  backupRetention: number;
  dailyJob: {
    enabled: boolean;
    hour: number;
    bankSync: boolean;
  };
  report: {
    ignoredCategories: string[];
    setAsideAccounts: string[];
    shares: ReportShare[];
    email: ReportEmailConfig | null;
  };
};

const DEFAULT_RESEND_FROM = 'Actual <onboarding@resend.dev>';
const DEFAULT_IGNORED_CATEGORIES = [
  'Movimentações internas',
  'Starting Balances',
];

const DEFAULT_SET_ASIDE_ACCOUNTS = [
  'Cofrinho Casamento',
  'Cofrinho Guardado',
  'Cofrinho 3DZone Caixa',
];

const DEFAULT_SHARES: ReportShare[] = [
  { match: 'Aluguel', share: 0.5 },
  { match: 'Financiamento Onix', share: 0.5 },
  { match: 'Cartão Riachuelo', share: 0.5 },
];

const DEFAULT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  // ChatGPT uses a per-connection callback when the server lacks RFC 9207.
  'https://chatgpt.com/connector/oauth/*',
];

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function list(env: NodeJS.ProcessEnv, name: string): string[] | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** `Aluguel=50%,Cartão Riachuelo=50%`: the owner's part of each split bill. */
function shares(env: NodeJS.ProcessEnv): ReportShare[] | undefined {
  return list(env, 'REPORT_SHARES')?.map(entry => {
    const separator = entry.lastIndexOf('=');
    const match = entry.slice(0, separator).trim();
    const percent = Number(
      entry
        .slice(separator + 1)
        .trim()
        .replace(/%$/, ''),
    );
    if (!match || !(percent > 0 && percent <= 100)) {
      throw new Error(
        `REPORT_SHARES entries look like "Aluguel=50%", got "${entry}"`,
      );
    }
    return { match, share: percent / 100 };
  });
}

function reportEmail(env: NodeJS.ProcessEnv): ReportEmailConfig | null {
  const to = list(env, 'REPORT_EMAIL_TO');
  if (!to) return null;

  const from = env.REPORT_EMAIL_FROM?.trim();
  const host = env.SMTP_HOST?.trim();
  if (host) {
    const user = required(env, 'SMTP_USER');
    return {
      kind: 'smtp',
      host,
      port: integer(env, 'SMTP_PORT', 465, { min: 1, max: 65535 }),
      user,
      password: required(env, 'SMTP_PASSWORD'),
      from: from || `Actual <${user}>`,
      to,
    };
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return { kind: 'resend', apiKey, from: from || DEFAULT_RESEND_FROM, to };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = integer(env, 'PORT', 5007, { min: 1, max: 65535 });
  const actualPassword = required(env, 'ACTUAL_PASSWORD');

  return {
    port,
    publicUrl: new URL(
      env.MCP_PUBLIC_URL?.trim() || `http://localhost:${port}`,
    ),
    dataDir: path.resolve(env.MCP_DATA_DIR?.trim() || './data'),
    actual: {
      serverUrl: required(env, 'ACTUAL_SERVER_URL').replace(/\/+$/, ''),
      password: actualPassword,
      syncId: env.ACTUAL_SYNC_ID?.trim() || undefined,
    },
    auth: {
      password: env.MCP_AUTH_PASSWORD?.trim() || actualPassword,
      allowedRedirectUris:
        list(env, 'MCP_ALLOWED_REDIRECT_URIS') ?? DEFAULT_REDIRECT_URIS,
    },
    syncTtlMs:
      integer(env, 'MCP_SYNC_TTL_SECONDS', 30, { min: 0, max: 3600 }) * 1000,
    backupRetention: integer(env, 'MCP_BACKUP_RETENTION', 14, {
      min: 1,
      max: 365,
    }),
    dailyJob: {
      enabled: boolean(env, 'MCP_DAILY_JOB', true),
      hour: integer(env, 'MCP_DAILY_JOB_HOUR', 6, { min: 0, max: 23 }),
      bankSync: boolean(env, 'MCP_DAILY_BANK_SYNC', true),
    },
    report: {
      ignoredCategories:
        list(env, 'REPORT_IGNORED_CATEGORIES') ?? DEFAULT_IGNORED_CATEGORIES,
      setAsideAccounts:
        list(env, 'REPORT_SET_ASIDE_ACCOUNTS') ?? DEFAULT_SET_ASIDE_ACCOUNTS,
      shares: shares(env) ?? DEFAULT_SHARES,
      email: reportEmail(env),
    },
  };
}
