/** Fork-only terminal layout. Respect narrow terminals; keep JSON untouched. */
export function wrapped(text: string, indent = "  "): string {
  const width = Math.max(20, Math.min(process.stdout.columns || 80, 100));
  const available = width - indent.length;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > available) {
      lines.push(indent + line);
      line = "";
    }
    // Preserve URLs and model IDs verbatim for terminal links and copy/paste.
    // The terminal can soft-wrap long tokens; inserted newlines would corrupt them.
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n") + "\n";
}

// Apply styling after wrapping: ANSI bytes must not count toward line width.
// Native ANSI keeps the fork small and works on light and dark terminal themes.
function styled(text: string, code: number): string {
  return process.stdout.isTTY &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb"
    ? `\x1b[${code}m${text}\x1b[0m`
    : text;
}
export const heading = (text: string): string => styled(text, 1);
export const accent = (text: string): string => styled(text, 36);
export const statusColor = (text: string, status: string): string =>
  styled(text, status === "ok" ? 32 : status === "error" ? 31 : 33);

/** Aligned, copyable command examples; stack labels on small terminals. */
export function action(label: string, command: string): string {
  if ((process.stdout.columns || 80) < 60)
    return wrapped(label) + accent(wrapped(command, "    "));
  return `  ${label.padEnd(15)}${accent(command)}\n`;
}
