type OptionValueParser = (value: string, previous: unknown) => unknown;
type Action = (
  argument: unknown,
  options: Record<string, unknown>
) => unknown | Promise<unknown>;

interface ArgumentDefinition {
  syntax: string;
  name: string;
  description: string;
}

interface OptionDefinition {
  flags: string;
  short?: string;
  long?: string;
  name: string;
  description: string;
  valueName?: string;
  negated: boolean;
  parser?: OptionValueParser;
  defaultValue?: unknown;
}

export class CliUsageError extends Error {}

export class Command {
  private commandName = "";
  private commandDescription = "";
  private commandVersion?: string;
  private readonly parent?: Command;
  private readonly commands: Command[] = [];
  private readonly options: OptionDefinition[] = [];
  private argumentDefinition?: ArgumentDefinition;
  private actionHandler?: Action;

  constructor(parent?: Command) {
    this.parent = parent;
  }

  name(name: string): this {
    this.commandName = name;
    return this;
  }

  description(description: string): this {
    this.commandDescription = description;
    return this;
  }

  version(version: string): this {
    this.commandVersion = version;
    return this;
  }

  command(name: string): Command {
    const command = new Command(this).name(name);
    this.commands.push(command);
    return command;
  }

  argument(syntax: string, description: string): this {
    const name = syntax.replace(/^[<[ ]|[>\] ]$/g, "");
    this.argumentDefinition = { syntax, name, description };
    return this;
  }

  option<T>(
    flags: string,
    description: string,
    parser?: (value: string, previous: T | undefined) => T,
    defaultValue?: T
  ): this {
    const valueMatch = flags.match(/<([^>]+)>/);
    const flagNames = flags
      .replace(/<[^>]+>/g, "")
      .split(/[\s,|]+/)
      .filter((flag) => flag.startsWith("-"));
    const short = flagNames.find(
      (flag) => flag.startsWith("-") && !flag.startsWith("--")
    );
    const long = flagNames.find((flag) => flag.startsWith("--"));
    const canonical = long ?? short;

    if (!canonical) throw new Error(`Invalid option flags: ${flags}`);

    const rawName = canonical.replace(/^--?/, "");
    const negated = rawName.startsWith("no-");
    const name = camelCase(negated ? rawName.slice(3) : rawName);

    this.options.push({
      flags,
      short,
      long,
      name,
      description,
      valueName: valueMatch?.[1],
      negated,
      parser: parser
        ? (value, previous) => parser(value, previous as T | undefined)
        : undefined,
      defaultValue,
    });
    return this;
  }

  action<TArgument, TOptions>(
    handler: (
      argument: TArgument,
      options: TOptions
    ) => unknown | Promise<unknown>
  ): this {
    this.actionHandler = (argument, options) =>
      handler(argument as TArgument, options as TOptions);
    return this;
  }

  async parseAsync(argv: string[]): Promise<void> {
    await this.run(argv.slice(2));
  }

  private async run(args: string[]): Promise<void> {
    if (this.commands.length > 0) {
      await this.runParent(args);
      return;
    }

    await this.runLeaf(args);
  }

  private async runParent(args: string[]): Promise<void> {
    const first = args[0];

    if (first === "-h" || first === "--help") {
      this.writeHelp(process.stdout);
      return;
    }
    const version = this.findVersion();
    if (version && (first === "-V" || first === "--version")) {
      process.stdout.write(`${version}\n`);
      return;
    }
    if (!first) {
      this.writeHelp(process.stderr);
      throw new CliUsageError();
    }
    if (first === "help") {
      this.writeHelpCommand(args.slice(1));
      return;
    }
    if (first.startsWith("-")) {
      throw new CliUsageError(`unknown option '${first}'`);
    }

    const command = this.commands.find(
      (candidate) => candidate.commandName === first
    );
    if (!command) throw new CliUsageError(`unknown command '${first}'`);

    await command.run(args.slice(1));
  }

  private async runLeaf(args: string[]): Promise<void> {
    const values = Object.fromEntries(
      this.options
        .filter((option) => option.defaultValue !== undefined)
        .map((option) => [
          option.name,
          Array.isArray(option.defaultValue)
            ? [...option.defaultValue]
            : option.defaultValue,
        ])
    );
    const positionals: string[] = [];
    let optionsEnded = false;

    for (let index = 0; index < args.length; index++) {
      const token = args[index]!;

      if (!optionsEnded && (token === "-h" || token === "--help")) {
        this.writeHelp(process.stdout);
        return;
      }
      const version = this.findVersion();
      if (
        !optionsEnded &&
        version &&
        (token === "-V" || token === "--version")
      ) {
        process.stdout.write(`${version}\n`);
        return;
      }
      if (!optionsEnded && token === "--") {
        optionsEnded = true;
        continue;
      }
      if (
        !optionsEnded &&
        token.startsWith("-") &&
        token !== "-" &&
        !isNegativeNumber(token)
      ) {
        const matches = this.findOptions(token);

        for (const { option, inlineValue } of matches) {
          if (!option.valueName) {
            if (inlineValue !== undefined) {
              throw new CliUsageError(
                `option '${option.long}' does not take a value`
              );
            }
            values[option.name] = option.negated ? false : true;
            continue;
          }

          let value = inlineValue;
          if (value === undefined) {
            value = args[++index];
            if (value === undefined) {
              throw new CliUsageError(
                `option '${option.flags}' argument missing`
              );
            }
          }

          values[option.name] = option.parser
            ? option.parser(value, values[option.name])
            : value;
        }
        continue;
      }

      positionals.push(token);
    }

    if (positionals.length > (this.argumentDefinition ? 1 : 0)) {
      const expected = this.argumentDefinition ? 1 : 0;
      throw new CliUsageError(
        `too many arguments for '${this.commandName}'. Expected ${expected} argument${expected === 1 ? "" : "s"} but got ${positionals.length}.`
      );
    }
    if (!this.actionHandler) return;

    await this.actionHandler(positionals[0], values);
  }

  private findOptions(token: string): {
    option: OptionDefinition;
    inlineValue?: string;
  }[] {
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      const flag = equals === -1 ? token : token.slice(0, equals);
      const option = this.options.find((candidate) => candidate.long === flag);
      if (!option) throw new CliUsageError(`unknown option '${token}'`);
      return [
        {
          option,
          inlineValue: equals === -1 ? undefined : token.slice(equals + 1),
        },
      ];
    }

    const exact = this.options.find((candidate) => candidate.short === token);
    if (exact) return [{ option: exact }];

    const matches: { option: OptionDefinition; inlineValue?: string }[] = [];
    let index = 1;

    while (index < token.length) {
      const flag = `-${token[index]}`;
      const option = this.options.find((candidate) => candidate.short === flag);
      if (!option) {
        throw new CliUsageError(`unknown option '-${token.slice(index)}'`);
      }

      if (option.valueName) {
        const inlineValue = token.slice(index + 1) || undefined;
        matches.push({ option, inlineValue });
        return matches;
      }

      matches.push({ option });
      index++;
    }

    return matches;
  }

  private writeHelp(stream: NodeJS.WritableStream): void {
    const hasCommands = this.commands.length > 0;
    const path = this.commandPath();
    const argument = this.argumentDefinition
      ? ` ${this.argumentDefinition.syntax}`
      : "";
    const command = hasCommands ? " [command]" : "";
    stream.write(`Usage: ${path} [options]${command}${argument}\n`);
    if (this.commandDescription) {
      stream.write(`\n${this.commandDescription}\n`);
    }

    if (this.argumentDefinition) {
      stream.write("\nArguments:\n");
      stream.write(
        formatRows([
          [this.argumentDefinition.name, this.argumentDefinition.description],
        ])
      );
    }

    const optionRows: [string, string][] = this.options.map((option) => [
      option.flags,
      option.description,
    ]);
    if (this.commandVersion) {
      optionRows.unshift(["-V, --version", "output the version number"]);
    }
    optionRows.push(["-h, --help", "display help for command"]);
    stream.write("\nOptions:\n");
    stream.write(formatRows(optionRows));

    if (hasCommands) {
      const commandRows: [string, string][] = this.commands.map((child) => [
        child.helpSignature(),
        child.commandDescription,
      ]);
      commandRows.push(["help [command]", "display help for command"]);
      stream.write("\nCommands:\n");
      stream.write(formatRows(commandRows));
    }
  }

  private writeHelpCommand(path: string[]): void {
    const [name, ...remaining] = path;
    if (!name) {
      this.writeHelp(process.stdout);
      return;
    }

    const command = this.commands.find(
      (candidate) => candidate.commandName === name
    );
    if (!command) throw new CliUsageError(`unknown command '${name}'`);
    command.writeHelpCommand(remaining);
  }

  private findVersion(): string | undefined {
    return this.commandVersion ?? this.parent?.findVersion();
  }

  private commandPath(): string {
    const parentPath = this.parent?.commandPath();
    return parentPath ? `${parentPath} ${this.commandName}` : this.commandName;
  }

  private helpSignature(): string {
    if (this.commands.length > 0) {
      return `${this.commandName} [options] [command]`;
    }
    const argument = this.argumentDefinition
      ? ` ${this.argumentDefinition.syntax}`
      : "";
    return `${this.commandName} [options]${argument}`;
  }
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}

function isNegativeNumber(value: string): boolean {
  return /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(value);
}

function formatRows(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, description]) => `  ${label.padEnd(width)}  ${description}\n`)
    .join("");
}
