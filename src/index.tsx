#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/app.js';
import { program } from 'commander';
import { GraphManager } from './graph/GraphManager.js';
import { createGraphStore } from './graph/store/factory.js';
import { loadConfig, initConfig } from './config/settings.js';
import { AuthManager } from './auth/AuthManager.js';
import { SUPPORTED_MODELS, getModel } from './config/models.js';


async function main() {
  program
    .name('codeflow')
    .description('AI coding assistant with 40-70% token savings')
    .version('1.0.0-beta');

  program
    .command('init')
    .description('Initialize CodeFlow in current directory')
    .action(async () => {
      await initConfig();
      console.log('CodeFlow initialized! Run `codeflow start` to begin.');
    });

  program
    .command('start', { isDefault: true })
    .description('Start interactive coding session')
    .option('-m, --model <model>', 'Model to use')
    .option('--rebuild', 'Force a fresh graph rebuild before starting')
    .option('--offline', 'Run without calling the model (UI preview)')
    .action(async (options) => {
      const config = await loadConfig();
      const offline = Boolean(options.offline);
      const authManager = new AuthManager();
      const existingSession = await authManager.getSession();
      let apiKey = existingSession?.apiKey ?? '';
      let accountLabel = existingSession?.accountLabel ?? '';

      const resolvedModel = await resolveModel(options.model, config.defaultModel);
      if (resolvedModel !== config.defaultModel) {
        await initConfig({ defaultModel: resolvedModel });
      }

      let graphStoreConfig = { kind: 'memory' as const };
      if (!offline) {
        try {
          const session = await authManager.ensureAuthenticated();
          apiKey = session.apiKey;
          accountLabel = session.accountLabel ?? accountLabel;
        } catch (error) {
          console.error(
            'Authentication required:',
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      } else if (!apiKey) {
        console.warn('Running in offline mode with no API key; responses will be simulated.');
      }

      console.log('Preparing code graph...');
      const store = await createGraphStore(graphStoreConfig);
      const manager = new GraphManager({
        rootDir: process.cwd(),
        store,
      });
      const { graph, source } = await manager.initialize(Boolean(options.rebuild));
      const nodeCount = graph.getAllNodes().length;

      if (source === 'store') {
        console.log(`Loaded cached graph with ${nodeCount} code symbols.`);
      } else {
        console.log(`Indexed ${nodeCount} code symbols from source files.`);
      }
      console.log('Starting interactive session...\n');

      render(
        <App
          graph={graph}
          graphManager={manager}
          apiKey={apiKey}
          accountLabel={accountLabel}
          model={resolvedModel}
          workingDir={process.cwd()}
          offline={offline}
        />
      );

    });

  program
    .command('login')
    .description('Authenticate with CodeFlow')
    .action(async () => {
      const config = await loadConfig();
      const authManager = new AuthManager();
      try {
        const session = await authManager.manualLogin();
        const labelSuffix = session.accountLabel ? ` for ${session.accountLabel}` : '';
        console.log(`Authentication saved${labelSuffix}!`);
      } catch (error) {
        console.error(
          'Failed to save authentication:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  program
    .command('logout')
    .description('Clear stored credentials and logout')
    .action(async () => {
      const config = await loadConfig();
      
      const authManager = new AuthManager();
      await authManager.logout();
      console.log('Logged out of CodeFlow and cleaned up resources.');
    });

  program
    .command('stats')
    .description('Show usage statistics')
    .action(async () => {
      const { UsageTracker } = await import('./analytics/UsageTracker.js');
      const tracker = new UsageTracker();

      const stats = await tracker.getStats();

      console.log('\nUsage Statistics');
      console.log('================');
      console.log(`Total requests: ${stats.eventCount}`);
      console.log(`Tokens used: ${stats.totalTokensUsed.toLocaleString()}`);
      console.log(`Tokens saved: ${stats.totalTokensSaved.toLocaleString()}`);
      console.log(`Savings: ${stats.savingsPercent.toFixed(1)}%\n`);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function resolveModel(cliModel: string | undefined, defaultModel: string | undefined): Promise<string> {
  if (cliModel) {
    return cliModel;
  }

  const current = getModel(defaultModel ?? '') ? defaultModel : undefined;
  const { default: inquirer } = await import('inquirer');

  const choices = SUPPORTED_MODELS.map((model) => ({
    name: `${model.name} — ${model.provider}${model.recommended ? ' (recommended)' : ''}`,
    value: model.id,
    short: model.name,
  }));

  const defaultIndex = current ? Math.max(0, SUPPORTED_MODELS.findIndex((model) => model.id === current)) : 0;

  const { model } = await inquirer.prompt<{
    model: string;
  }>([
    {
      type: 'list',
      name: 'model',
      message: 'Select the model for this session:',
      choices,
      default: defaultIndex,
      loop: false,
      pageSize: Math.max(choices.length, 3),
    },
  ]);

  return model;
}

