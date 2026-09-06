#!/usr/bin/env node
// Local installation only; the published CLI never assumes Patrick's filesystem.
// Read only Cloudflare assignments from the canonical auth file. Do not source
// shell code or load local Google/OpenRouter/Fal/OpenAI/Replicate credentials.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export function cloudflareAuthDefaults(contents, inherited) {
  const assignments = contents.split(/\r?\n/).filter(line =>
    /^\s*(?:export\s+)?CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN|AI_GATEWAY_TOKEN|AI_GATEWAY_ID)\s*=/.test(line)
  );
  const parsed = parseEnv(assignments.join('\n'));
  // Existing environment values win, including deliberate empty overrides.
  return { ...parsed, ...inherited };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const authPath = join(homedir(), 'Code/specialagent/.env.local');
  try {
    const merged = cloudflareAuthDefaults(readFileSync(authPath, 'utf8'), process.env);
    for (const [key, value] of Object.entries(merged))
      if (process.env[key] === undefined) process.env[key] = value;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      process.stderr.write('Cannot load local Cloudflare auth setup. Check ~/Code/specialagent/.env.local.\n');
      process.exit(1);
    }
    // Keep help/version usable; generation/doctor explain missing credentials.
  }
  await import('../packages/ai-cli/dist/index.js');
}
