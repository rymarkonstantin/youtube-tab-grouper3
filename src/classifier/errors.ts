export type AiCapability = "language-detector" | "translator" | "language-model";

export class ActivationRequiredError extends Error {
  constructor(
    public readonly capability: AiCapability,
    public readonly prepare: (options: {
      signal: AbortSignal;
      onDownloadProgress(loaded: number): void;
    }) => Promise<void>,
    public readonly sourceLanguage?: string,
  ) {
    super(`User activation is required for ${capability}.`);
    this.name = "ActivationRequiredError";
  }
}

export class AiUnavailableError extends Error {
  constructor(public readonly capability: string) {
    super(`${capability} is unavailable on this Chrome installation or device.`);
    this.name = "AiUnavailableError";
  }
}

export class MalformedClassificationResponseError extends Error {
  readonly code = "malformed-response" as const;

  constructor(message = "The classification response is malformed.") {
    super(message);
    this.name = "MalformedClassificationResponseError";
  }
}

export class UnsupportedModelParametersError extends Error {
  readonly code = "unsupported-model-parameters" as const;

  constructor() {
    super("The built-in model cannot honor temperature 0 and top-K 1.");
  }
}

export class ClassifierContextError extends Error {
  readonly code = "classifier-context" as const;

  constructor() {
    super("The enabled categories and one bounded video cannot fit the model context window.");
  }
}
