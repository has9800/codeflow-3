declare module 'conf' {
  interface ConfOptions<T> {
    projectName: string;
    defaults?: T;
  }

  export default class Conf<T = Record<string, unknown>> {
    constructor(options?: ConfOptions<T>);
    get<K extends keyof T>(key: K): T[K];
    set<K extends keyof T>(key: K, value: T[K]): void;
  }
}
