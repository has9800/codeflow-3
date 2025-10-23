import * as fs from 'fs/promises';
import * as path from 'path';

export class BackupManager {
  private backupDir: string;

  constructor(private rootDir: string) {
    this.backupDir = path.join(rootDir, '.codeflow', 'backups');
  }

  async backup(filePath: string): Promise<void> {
    const fullPath = path.join(this.rootDir, filePath);
    const backupPath = path.join(this.backupDir, filePath + `.${Date.now()}.bak`);

    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(fullPath, backupPath);
  }

  async restore(filePath: string): Promise<void> {
    const backupPattern = path.join(this.backupDir, filePath);
    const backupDir = path.dirname(backupPattern);

    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter(f => f.startsWith(path.basename(filePath)))
        .sort()
        .reverse();

      if (backups.length === 0) {
        throw new Error('No backup found');
      }

      const latestBackup = path.join(backupDir, backups[0]);
      const targetPath = path.join(this.rootDir, filePath);

      await fs.copyFile(latestBackup, targetPath);
    } catch (error) {
      throw new Error(`Failed to restore backup: ${error}`);
    }
  }

  async cleanOldBackups(daysToKeep: number = 7): Promise<void> {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.name.endsWith('.bak')) {
          const match = entry.name.match(/\.(\d+)\.bak$/);
          if (match) {
            const timestamp = parseInt(match[1], 10);
            if (timestamp < cutoff) {
              await fs.unlink(fullPath);
            }
          }
        }
      }
    };

    try {
      await walk(this.backupDir);
    } catch (error) {
      // Backup dir might not exist yet
    }
  }
}
