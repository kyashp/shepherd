export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "RunCancelledError";
  }
}

export type RuntimeExecutionFailureKind = "timeout" | "execution";

/** Typed Agent Runtime failure with a bounded, operator-safe public message. */
export class RuntimeExecutionError extends Error {
  public readonly kind!: RuntimeExecutionFailureKind;
  public readonly timeoutMs: number | undefined;

  constructor(
    kind: RuntimeExecutionFailureKind,
    timeoutMs?: number,
  ) {
    const safeKind: RuntimeExecutionFailureKind =
      kind === "timeout" ? "timeout" : "execution";
    const safeTimeoutMs =
      safeKind === "timeout" &&
      Number.isSafeInteger(timeoutMs) &&
      (timeoutMs ?? 0) > 0
        ? timeoutMs
        : undefined;
    super(
      safeKind === "timeout"
        ? safeTimeoutMs === undefined
          ? "Agent Runtime execution timed out"
          : `Agent Runtime exceeded the ${safeTimeoutMs} ms execution deadline`
        : "Agent Runtime execution failed",
    );
    this.name = "RuntimeExecutionError";
    Object.defineProperties(this, {
      kind: { value: safeKind, enumerable: true },
      timeoutMs: { value: safeTimeoutMs, enumerable: true },
    });
  }
}
