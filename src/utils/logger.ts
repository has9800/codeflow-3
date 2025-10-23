type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export interface LoggerOptions {
  scope?: string;
  level?: LogLevel;
}

export class Logger {
  private readonly scope?: string;
  private level: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope;
    this.level =
      options.level ?? (process.env.CODEFLOW_LOG_LEVEL as LogLevel) ?? 'info';
  }

  child(scope: string): Logger {
    const fullScope = this.scope ? `${this.scope}:${scope}` : scope;
    return new Logger({ scope: fullScope, level: this.level });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  error(message: string, error?: unknown): void {
    this.log('error', message, error);
  }

  warn(message: string, error?: unknown): void {
    this.log('warn', message, error);
  }

  info(message: string, context?: unknown): void {
    this.log('info', message, context);
  }

  debug(message: string, context?: unknown): void {
    this.log('debug', message, context);
  }

  trace(message: string, context?: unknown): void {
    this.log('trace', message, context);
  }

  private log(level: LogLevel, message: string, context?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const scopePrefix = this.scope ? `[${this.scope}] ` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase()}: ${scopePrefix}${message}`;

    if (level === 'error') {
      console.error(line, this.serializeContext(context));
    } else if (level === 'warn') {
      console.warn(line, this.serializeContext(context));
    } else {
      console.log(line, this.serializeContext(context));
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] <= LEVELS[this.level];
  }

  private serializeContext(context: unknown): unknown {
    if (!context) return '';
    if (context instanceof Error) {
      return `${context.name}: ${context.message}\n${context.stack ?? ''}`;
    }
    return context;
  }
}

export const logger = new Logger({ scope: 'codeflow' });
