import { AsyncLocalStorage } from "node:async_hooks";

export interface ExecutionPolicy {
  fallback?: boolean;
  fallbacks?: string[];
  free?: boolean;
  provider?: string;
}
// One CLI command may run many jobs concurrently. Keep its constraints together
// without leaking flags into another in-process invocation or SDK consumer.
export const executionPolicy = new AsyncLocalStorage<ExecutionPolicy>();
