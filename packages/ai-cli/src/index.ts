#!/usr/bin/env node

import pkg from "../package.json";
import { registerAudioCommand } from "./commands/audio.js";
import { registerImageCommand } from "./commands/image.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerTextCommand } from "./commands/text.js";
import { registerVideoCommand } from "./commands/video.js";
import { registerDiagnostics } from "./fork/diagnostics.js";
import { CliUsageError, Command } from "./lib/command.js";
import { errorMessage } from "./lib/errors.js";

const program = new Command();

program
  .name("ai")
  .description(
    "Generate text, images, video and audio.\n\nDefault gateway: cloudflare.\nUse --gateway <name> on a command to override; see ai gateways.\nDefault text model: google/gemini-3.8-flash (Google free-tier eligible).\nUse -m <full-id>, --best, --free or --cheapest to choose a model.\nSee ai providers and ai models; check setup with ai doctor."
  )
  .version(pkg.version);

registerTextCommand(program);
registerImageCommand(program);
registerVideoCommand(program);
registerAudioCommand(program);
registerModelsCommand(program);
registerDiagnostics(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CliUsageError) {
    if (err.message) process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`Error: ${errorMessage(err)}\n`);
  process.exit(1);
});
