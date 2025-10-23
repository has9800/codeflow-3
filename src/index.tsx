#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/app.js';
import { program } from 'commander';
import { GraphManager } from './graph/GraphManager.js';
import { createGraphStore } from './graph/store/factory.js';
import { loadConfig, initConfig } from './config/settings.js';

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
    .command('start')
    .description('Start interactive coding session')
    .option('-m, --model <model>', 'Model to use')
    .option('--rebuild', 'Force a fresh graph rebuild before starting')
    .option('--offline', 'Run without calling the model (UI preview)')
    .action(async (options) => {
      const config = await loadConfig();
      const offline = Boolean(options.offline);

      if (offline) {
        process.env.CODEFLOW_DISABLE_EMBEDDINGS = '1';
        console.log('Offline preview mode: embeddings and API calls disabled.');
      } else {
        delete process.env.CODEFLOW_DISABLE_EMBEDDINGS;
      }

      if (!offline && !config.apiKey) {
        console.error('Error: No API key configured. Run `codeflow login` first.');
        process.exit(1);
      }

      console.log('Preparing code graph...');
      const store = await createGraphStore(config.graphStore);
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
          apiKey={config.apiKey ?? ''}
          model={options.model || config.defaultModel}
          workingDir={process.cwd()}
          offline={offline}
        />
      );
    });

  program
    .command('login')
    .description('Authenticate with CodeFlow')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'Enter your OpenRouter API key:',
          validate: (input) => input.length > 0 || 'API key required',
        },
      ]);

      await initConfig({ apiKey: answers.apiKey });
      console.log('Authentication saved!');
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
