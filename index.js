#!/usr/bin/env node

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import { analyzeGitDiff, consolidateFeaturesList } from './services/ollama.js';
import { detectProjectType } from './services/project-analyzer.js';
import { filterSourceFiles } from './services/git-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI escape codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const WHITE = '\x1b[37m';
const GRAY = '\x1b[90m';

// Global features variable to track accumulated features
let globalFeatures = '';
let projectType = 'unknown';

const HELP_MESSAGE = `
${BOLD}Available Commands:${RESET}
  ${WHITE}/help${RESET}              - Show this help message
  ${WHITE}/repo${RESET} [path]       - Switch repositories
  ${WHITE}/features${RESET}          - Show summarized features
  ${WHITE}/run${RESET} [n]           - Create and analyze diffs for every n commits
  ${WHITE}/exit${RESET}              - Exit the program
`;

async function promptForRepoPath() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter repository path: ', (answer) => {
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
    const bar = `${GREEN}${'█'.repeat(filled)}${RESET}${GRAY}${'░'.repeat(empty)}${RESET}`;
    return `${bar} ${percentage}% (${current}/${total})`;
  };
}

async function getCommitDiffs(repoPath) {
  const git = simpleGit(repoPath);
  const spinner = ora('Fetching commit history...').start();
  
  try {
    const log = await git.log();
    // Sort commits by date ascending (oldest first)
    const commits = log.all.sort((a, b) => new Date(a.date) - new Date(b.date));
    const total = commits.length - 1;
    const diffs = [];
    const getProgress = createProgressBar(total);

    spinner.text = 'Reading repository commits...';
    
    for (let i = 0; i < total; i++) {
      const currentCommit = commits[i];
      const nextCommit = commits[i + 1];
      
      spinner.text = `Reading commits... ${getProgress(i + 1)}\n`;
      
      const diff = await git.diff([currentCommit.hash, nextCommit.hash]);
      // Filter diff to only include source files based on project type
      const sourceDiff = filterSourceFiles(diff, projectType);
      
      if (sourceDiff) {
        diffs.push({
          commitHash: currentCommit.hash,
          message: currentCommit.message,
          date: currentCommit.date,
          diff: sourceDiff
        });
      }
    }

    spinner.succeed(`${GREEN}Repository analysis complete${RESET}`);
    return diffs;
  } catch (error) {
    spinner.fail(`${RED}Failed to analyze repository${RESET}`);
    throw error;
  }
}

async function getRepoStats(git) {
  const stats = {
    branches: await git.branchLocal(),
    commits: (await git.log()).total,
    status: await git.status()
  };
  
  console.log(`${BOLD}\n📊 Repository Statistics${RESET}`);
  console.log('━'.repeat(50));
  console.log(`${WHITE}Branch:${RESET}           ${GREEN}${stats.branches.current}${RESET}`);
  console.log(`${WHITE}Commits:${RESET}          ${YELLOW}${stats.commits}${RESET}`);
  console.log(`${WHITE}Total Branches:${RESET}   ${YELLOW}${stats.branches.all.length}${RESET}`);
  console.log(`${WHITE}Modified Files:${RESET}   ${YELLOW}${stats.status.modified.length}${RESET}`);
  console.log(`${WHITE}Staged Files:${RESET}     ${YELLOW}${stats.status.staged.length}${RESET}`);
  console.log(`${WHITE}Project Type:${RESET}     ${GREEN}${projectType}${RESET}`);
  console.log('━'.repeat(50));
  
  return stats;
}

async function detectRepoType(repoPath) {
  const git = simpleGit(repoPath);
  const files = await git.raw(['ls-files']);
  const fileList = files.split('\n').filter(Boolean);
  return detectProjectType(fileList);
}

async function loadRepository(path) {
  const git = simpleGit(path);
  const validPath = await validateRepoPath(path);
  
  // Detect project type
  projectType = await detectRepoType(validPath);
  console.log(`${BOLD}\n🔍 Project Analysis${RESET}`);
  console.log('━'.repeat(50));
  console.log(`${WHITE}Detected Type:${RESET}    ${GREEN}${projectType}${RESET}`);
  
  const diffs = await getCommitDiffs(validPath);
  const stats = await getRepoStats(git);
  
  // Reset global features when loading a new repository
  globalFeatures = '';
  
  return {
    repoPath: validPath,
    diffs,
    stats,
    features: null,
    lastProcessedIndex: -1 // Track the last processed commit index
  };
}

async function printHelp() {
  console.log(HELP_MESSAGE);
}

async function processCommitGroups(git, groupSize, state) {
  const spinner = ora('Fetching commit history...').start();
  
  try {
    const { diffs } = state;
    const total = diffs.length;
    const totalGroups = Math.ceil(total / groupSize);
    
    if (total === 0) {
      spinner.info(`${YELLOW}No commits to process.${RESET}`);
      return [];
    }

    spinner.text = 'Processing commit groups...';
    spinner.succeed();
    
    const getProgress = createProgressBar(totalGroups);
    
    for (let i = 0; i < total; i += groupSize) {
      const groupEnd = Math.min(i + groupSize, total);
      
      // Combine diffs in the group
      let combinedDiff = '';
      let combinedMessage = '';
      
      for (let j = i; j < groupEnd; j++) {
        const diff = diffs[j];
        if (diff.diff) {
          combinedDiff += diff.diff + '\n';
          combinedMessage += diff.message + '\n';
        }
      }
      
      if (combinedDiff) {
        // Analyze this group's features
        // console.log(`\nAnalyzing group ${WHITE}${Math.floor(i/groupSize) + 1}${RESET}/${WHITE}${totalGroups}${RESET}`);
        const groupFeatures = await analyzeGitDiff(combinedMessage + '\n' + combinedDiff);
        
        // Consolidate with existing features immediately
        console.log(`${BOLD}\nConsolidating features for group ${Math.floor(i/groupSize) + 1}...${RESET}`);
        globalFeatures = await consolidateFeaturesList(globalFeatures ? [globalFeatures, groupFeatures] : [groupFeatures]);
      }
      
      // Update progress and show on same line
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      const progress = getProgress(Math.floor(i/groupSize) + 1);
      
      // If this is the last group, show completion message instead
      if (i + groupSize >= total) {
        process.stdout.write(`${GREEN}✓ Group processing complete (${totalGroups} groups)${RESET}`);
      } else {
        process.stdout.write(`${BOLD}\n📦 Processing Group ${WHITE}${Math.floor(i/groupSize) + 1}${RESET}/${WHITE}${totalGroups}${RESET} ${progress}`);
      }
    }

    // Move to next line after completion
    console.log();
    return [];
  } catch (error) {
    spinner.fail(`${RED}Failed to process commit groups${RESET}`);
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
          console.error(`${RED}❌ Error: ${error.message}${RESET}`);
          return state;
        }
      }
      return state;

    case '/features':
      if (globalFeatures) {
        console.log(`${BOLD}\n🎯 Features Analysis${RESET}`);
        console.log('━'.repeat(50));
        console.log(DIM + globalFeatures + RESET);
      } else {
        console.log(`${YELLOW}No features analyzed yet. Use /run to analyze commits.${RESET}`);
      }
      return state;

    case '/run':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }
      
      const groupSize = parseInt(args[0]);
      if (isNaN(groupSize) || groupSize <= 0) {
        console.log(`${YELLOW}Please provide a valid positive number for group size.${RESET}`);
        return state;
      }

      try {
        const git = simpleGit(state.repoPath);
        await processCommitGroups(git, groupSize, state);
      } catch (error) {
        console.error(`${RED}❌ Error processing commit groups: ${error.message}${RESET}`);
      }
      return state;

    case '/exit':
      console.log(`${GREEN}\n👋 Goodbye!${RESET}`);
      process.exit(0);
    default:
      console.log(`${YELLOW}Unknown command. Type /help for available commands.${RESET}`);
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
      rl.question('> ', answer => resolve(answer.trim()));
    });
    
    if (cmd) {
      state = await handleCommand(cmd, state);
    }
  }
}

async function main() {
  const spinner = ora();
  try {
    let state = { 
      repoPath: null, 
      diffs: null, 
      stats: null, 
      lastProcessedIndex: -1 // Initialize the commit pointer
    };
    let initialPath = process.argv[2];

    if (!initialPath) {
      initialPath = await promptForRepoPath();
    }

    if (initialPath) {
      state = await loadRepository(initialPath);
    }

    await printHelp();
    await commandLoop(state);

  } catch (error) {
    spinner.fail(`${RED}❌ Error: ${error.message}${RESET}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log(`${GREEN}\nGracefully shutting down...${RESET}`);
  process.exit(0);
});

main();
