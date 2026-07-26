import { describe, expect, test } from "bun:test";

import { Command } from "./command.js";

describe("Command", () => {
  test("parses positional, long, short, negated, and repeatable options", async () => {
    let received:
      | {
          prompt?: string;
          options: Record<string, unknown>;
        }
      | undefined;

    const program = new Command().name("ai");
    program
      .command("image")
      .argument("[prompt]", "Prompt")
      .option("-m, --model <model>", "Model")
      .option(
        "-i, --image <path>",
        "Image",
        (value, previous: unknown) => [
          ...((previous as string[] | undefined) ?? []),
          value,
        ],
        []
      )
      .option("--aspect-ratio <ratio>", "Aspect ratio")
      .option("--no-preview", "Disable preview")
      .action((prompt, options) => {
        received = {
          prompt: prompt as string | undefined,
          options: options as Record<string, unknown>,
        };
      });

    await program.parseAsync([
      "node",
      "ai",
      "image",
      "a cat",
      "-m",
      "openai/image",
      "-i",
      "one.png",
      "--image=two.png",
      "--aspect-ratio",
      "16:9",
      "--no-preview",
    ]);

    expect(received).toEqual({
      prompt: "a cat",
      options: {
        model: "openai/image",
        image: ["one.png", "two.png"],
        aspectRatio: "16:9",
        preview: false,
      },
    });
  });

  test("accepts options before and after the positional argument", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .option("-q, --quiet", "Quiet")
      .option("-o, --output <path>", "Output")
      .action((prompt, options) => {
        received = { prompt, options };
      });

    await program.parseAsync([
      "node",
      "ai",
      "text",
      "-q",
      "hello",
      "--output=result.md",
    ]);

    expect(received).toEqual({
      prompt: "hello",
      options: { quiet: true, output: "result.md" },
    });
  });

  test("parses combined boolean and value-taking short options", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .option("-q, --quiet", "Quiet")
      .option("-m, --model <model>", "Model")
      .action((prompt, options) => {
        received = { prompt, options };
      });

    await program.parseAsync([
      "node",
      "ai",
      "text",
      "-qmopenai/gpt-5.5",
      "hello",
    ]);

    expect(received).toEqual({
      prompt: "hello",
      options: { quiet: true, model: "openai/gpt-5.5" },
    });
  });

  test("treats negative numbers as positional arguments", async () => {
    let received: unknown;
    const program = new Command().name("ai");
    program
      .command("text")
      .argument("[prompt]", "Prompt")
      .action((prompt) => {
        received = prompt;
      });

    await program.parseAsync(["node", "ai", "text", "-1.5e-2"]);

    expect(received).toBe("-1.5e-2");
  });
});
