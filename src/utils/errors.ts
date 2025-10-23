export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigurationError';
  }
}

export class ExternalServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExternalServiceError';
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}

export function wrapWithUserMessage(error: unknown, fallback: string): UserFacingError {
  if (error instanceof UserFacingError) {
    return error;
  }

  const message =
    error instanceof Error
      ? `${fallback}: ${error.message}`
      : fallback;

  return new UserFacingError(message, {
    cause: error instanceof Error ? error : undefined,
  });
}
