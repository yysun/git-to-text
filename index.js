#!/usr/bin/env node

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import chalk from 'chalk';
import { analyzeGitDiff, consolidateFeaturesList } from './services/analysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Global features variable to track accumulated features
let globalFeatures = '';

const HELP_MESSAGE = `
${chalk.bold('Available Commands:')}
  ${chalk.cyan('/help')}              - Show this help message
  ${chalk.cyan('/repo')} ${chalk.gray('[path]')}       - Switch repositories. Optionally, will prompt for input
  ${chalk.cyan('/features')}          - Show summarized features
  ${chalk.cyan('/read')} ${chalk.gray('[n]')}          - Process the next n commits
  ${chalk.cyan('/exit')}              - Exit the program
`;

async function promptForRepoPath() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow('Please enter the path to your git repository: '), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function validateRepoPath(repoPath) {
  try {
    const git = simpleGit(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error('Invalid git repository');
    }
    return resolve(repoPath);
  } catch (error) {
    throw new Error(`Invalid repository path: ${error.message}`);
  }
}

function createProgressBar(total) {
  const width = 30;
  return (current) => {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((width * current) / total);
    const empty = width - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `${bar} ${chalk.cyan(percentage)}% (${chalk.yellow(current)}/${chalk.yellow(total)})`;
  };
}

async function getCommitDiffs(repoPath) {
  const git = simpleGit(repoPath);
  const spinner = ora('Fetching commit history...').start();
  
  try {
    const log = await git.log();
    const commits = log.all;
    const total = commits.length - 1;
    const diffs = [];
    const getProgress = createProgressBar(total);

    spinner.text = 'Reading repository commits...';
    
    for (let i = 0; i < total; i++) {
      const currentCommit = commits[i];
      const nextCommit = commits[i + 1];
      
      spinner.text = `Reading commits... ${getProgress(i + 1)}\n`;
      
      const diff = await git.diff([nextCommit.hash, currentCommit.hash]);
      diffs.push({
        commitHash: currentCommit.hash,
        message: currentCommit.message,
        diff
      });
    }

    spinner.succeed(chalk.green('Repository analysis complete'));
    return diffs;
  } catch (error) {
    spinner.fail(chalk.red('Failed to analyze repository'));
    throw error;
  }
}

async function getRepoStats(git) {
  const stats = {
    branches: await git.branchLocal(),
    commits: (await git.log()).total,
    status: await git.status()
  };
  
  console.log(chalk.bold('\n📊 Repository Statistics'));
  console.log('━'.repeat(50));
  console.log(`${chalk.blue('Current Branch:')}    ${chalk.green(stats.branches.current)}`);
  console.log(`${chalk.blue('Total Commits:')}     ${chalk.yellow(stats.commits)}`);
  console.log(`${chalk.blue('Total Branches:')}    ${chalk.yellow(stats.branches.all.length)}`);
  console.log(`${chalk.blue('Modified Files:')}    ${chalk.yellow(stats.status.modified.length)}`);
  console.log(`${chalk.blue('Staged Files:')}      ${chalk.yellow(stats.status.staged.length)}`);
  console.log('━'.repeat(50));
  
  return stats;
}

async function loadRepository(path) {
  const git = simpleGit(path);
  const validPath = await validateRepoPath(path);
  const diffs = await getCommitDiffs(validPath);
  const stats = await getRepoStats(git);
  
  // Reset global features when loading a new repository
  globalFeatures = '';
  
  return {
    repoPath: validPath,
    diffs,
    stats,
    features: null
  };
}

async function printHelp() {
  console.log(HELP_MESSAGE);
}

async function processCommits(git, count) {
  const spinner = ora('Fetching commit history...').start();
  
  try {
    const log = await git.log();
    const commits = log.all;
    const total = Math.min(count, commits.length - 1);
    const diffs = [];
    const getProgress = createProgressBar(total);

    spinner.text = 'Reading repository commits...';
    spinner.succeed();
    
    for (let i = 0; i < total; i++) {
      const currentCommit = commits[i];
      const nextCommit = commits[i + 1];
      
      console.log(chalk.bold(`\n📝 Processing Commit ${chalk.yellow(i + 1)}/${chalk.yellow(total)}`));
      console.log('━'.repeat(50));
      console.log(`${chalk.blue('Hash:')}    ${chalk.yellow(currentCommit.hash)}`);
      console.log(`${chalk.blue('Message:')} ${currentCommit.message}`);
      
      const diff = await git.diff([nextCommit.hash, currentCommit.hash]);
      console.log(chalk.bold('\n📄 Diff:'));
      console.log('━'.repeat(50));
      console.log(diff);
      
      diffs.push({
        commitHash: currentCommit.hash,
        message: currentCommit.message,
        diff
      });
    }

    console.log(chalk.green('\n✅ Commit processing complete'));
    return diffs;
  } catch (error) {
    spinner.fail(chalk.red('Failed to process commits'));
    throw error;
  }
}

async function handleCommand(cmd, state) {
  const [command, ...args] = cmd.toLowerCase().split(' ');
  
  switch (command) {
    case '/help':
      console.log(HELP_MESSAGE);
      return state;
      
    case '/repo':
      let newPath = args.join(' ').trim();
      if (!newPath) {
        newPath = await promptForRepoPath();
      }
      
      if (newPath) {
        try {
          return await loadRepository(newPath);
        } catch (error) {
          console.error(chalk.red(`❌ Error: ${error.message}`));
          return state;
        }
      }
      return state;

    case '/features':
      if (globalFeatures) {
        console.log(chalk.bold('\n🎯 Current Features:'));
        console.log('━'.repeat(50));
        console.log(globalFeatures);
      } else {
        console.log(chalk.yellow('⚠️  No features analyzed yet. Use /read to analyze commits.'));
      }
      return state;

    case '/read':
      if (!state.repoPath) {
        console.log(chalk.yellow('⚠️  No repository selected. Use /repo to select a repository.'));
        return state;
      }
      
      const count = parseInt(args[0]);
      if (isNaN(count) || count <= 0) {
        console.log(chalk.yellow('⚠️  Please provide a valid positive number of commits to process.'));
        return state;
      }

      try {
        const git = simpleGit(state.repoPath);
        const diffs = await processCommits(git, count);
        console.log(chalk.bold('\n🔍 Analyzing commits with Ollama...'));
        
        // Analyze each commit's features
        const newFeatures = await Promise.all(
          diffs.map(async (diff, index) => {
            console.log(chalk.blue(`\n📊 Analyzing commit ${chalk.yellow(index + 1)}/${chalk.yellow(diffs.length)}:`));
            return analyzeGitDiff(diff.diff);
          })
        );

        // Combine new features with global features
        const allFeatures = globalFeatures ? [globalFeatures, ...newFeatures] : newFeatures;
        
        console.log(chalk.bold('\n🔄 Consolidating all features...'));
        globalFeatures = await consolidateFeaturesList(allFeatures);
        
        console.log(chalk.bold('\n✨ Updated Features:'));
        console.log('━'.repeat(50));
        console.log(globalFeatures);
      } catch (error) {
        console.error(chalk.red(`❌ Error processing commits: ${error.message}`));
      }
      return state;

    case '/exit':
      console.log(chalk.green('\n👋 Goodbye!'));
      process.exit(0);
    default:
      console.log(chalk.yellow('⚠️  Unknown command. Type /help for available commands.'));
      return state;
  }
}

async function commandLoop(state) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  while (true) {
    const cmd = await new Promise(resolve => {
      rl.question(chalk.green('\n➜ '), answer => resolve(answer.trim()));
    });
    
    if (cmd) {
      state = await handleCommand(cmd, state);
    }
  }
}

async function main() {
  const spinner = ora();
  try {
    let state = { repoPath: null, diffs: null, stats: null };
    let initialPath = process.argv[2];

    if (!initialPath) {
      initialPath = await promptForRepoPath();
    }

    if (initialPath) {
      state = await loadRepository(initialPath);
    }

    console.log(chalk.bold.cyan('\n🔍 Git-to-Text Interactive Mode'));
    console.log('━'.repeat(50));
    await printHelp();
    await commandLoop(state);

  } catch (error) {
    spinner.fail(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Gracefully shutting down...'));
  process.exit(0);
});

main();
