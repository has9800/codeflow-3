import { SimpleGit, simpleGit, StatusResult } from 'simple-git';

export interface CommitOptions {
  message: string;
  stageAll?: boolean;
}

export class GitIntegration {
  private readonly git: SimpleGit;

  constructor(private readonly repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async isRepository(): Promise<boolean> {
    try {
      await this.git.revparse(['--show-toplevel']);
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<StatusResult> {
    return this.git.status();
  }

  async stage(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.git.add(files);
  }

  async getDiffForFile(filePath: string): Promise<string> {
    return this.git.diff(['--', filePath]);
  }

  async commit(options: CommitOptions): Promise<void> {
    if (options.stageAll) {
      await this.git.add(['-A']);
    }
    await this.git.commit(options.message);
  }

  async currentBranch(): Promise<string | null> {
    try {
      const branchSummary = await this.git.branch();
      return branchSummary.current ?? null;
    } catch {
      return null;
    }
  }
}
