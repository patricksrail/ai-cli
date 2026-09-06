import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareAuthDefaults } from './mac-ai.mjs';

test('local launcher imports only Cloudflare auth and preserves explicit overrides', () => {
  const result = cloudflareAuthDefaults([
    'export CLOUDFLARE_ACCOUNT_ID="account"',
    "CLOUDFLARE_API_TOKEN='fallback'",
    'CLOUDFLARE_AI_GATEWAY_TOKEN=stored',
    'CLOUDFLARE_AI_GATEWAY_ID=ai-cli',
    'OPENROUTER_API_KEY=private-provider-key',
    'OPENAI_API_KEY=another-private-key',
    'AI_CLI_GATEWAY=vercel',
    'PATH=wrong',
    'echo shell-code-must-not-run',
  ].join('\n'), { CLOUDFLARE_AI_GATEWAY_TOKEN: 'explicit', PATH: '/usr/bin' });
  assert.deepEqual(result, {
    CLOUDFLARE_ACCOUNT_ID: 'account',
    CLOUDFLARE_API_TOKEN: 'fallback',
    CLOUDFLARE_AI_GATEWAY_TOKEN: 'explicit',
    CLOUDFLARE_AI_GATEWAY_ID: 'ai-cli',
    PATH: '/usr/bin',
  });
});
