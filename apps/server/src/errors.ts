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

/** Typed boundary failure from an Agent Runtime; public/persisted consumers must redact its message. */
export class RuntimeExecutionError extends Error {
  constructor(
    public readonly kind: RuntimeExecutionFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeExecutionError";
  }
}
