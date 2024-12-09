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
  ${WHITE}/read${RESET} [n]          - Process the next n commits
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

async function processCommits(git, count, state) {
  const spinner = ora('Fetching commit history...').start();
  
  try {
    const { diffs } = state;
    const startIndex = state.lastProcessedIndex + 1;
    const endIndex = Math.min(startIndex + count, diffs.length);
    const total = endIndex - startIndex;

    if (startIndex >= diffs.length) {
      spinner.info(`${YELLOW}All commits have been processed. Use /repo to analyze a different repository.${RESET}`);
      return [];
    }

    spinner.text = 'Reading commits...';
    spinner.succeed();
    
    const processingDiffs = [];
    const getProgress = createProgressBar(total);
    
    for (let i = startIndex; i < endIndex; i++) {
      const diff = diffs[i];
      console.log(`${BOLD}\n📝 Processing Commit ${WHITE}${i + 1}${RESET}/${WHITE}${diffs.length}${RESET}`);
      console.log(`${DIM}Date: ${new Date(diff.date).toLocaleString()}`);
      console.log(diff.message + RESET);
      
      if (diff.diff) {
        processingDiffs.push(diff);
      } else {
        console.log(`${YELLOW}No source file changes in this commit${RESET}`);
      }
      
      // Update progress
      spinner.text = `Processing commits... ${getProgress(i - startIndex + 1)}\n`;
    }

    // Update the last processed index
    state.lastProcessedIndex = endIndex - 1;

    console.log(`${GREEN}\n✓ Commit processing complete${RESET}`);
    return processingDiffs;
  } catch (error) {
    spinner.fail(`${RED}Failed to process commits${RESET}`);
    throw error;
  }
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
    
    const groups = [];
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
        groups.push({
          message: combinedMessage,
          diff: combinedDiff
        });
      }
      
      // Update progress and show on same line
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      const progress = getProgress(Math.floor(i/groupSize) + 1);
      
      // If this is the last group, show completion message instead
      if (i + groupSize >= total) {
        process.stdout.write(`${GREEN}✓ Group processing complete (${totalGroups} groups)${RESET}`);
      } else {
        process.stdout.write(`${BOLD}📦 Processing Group ${WHITE}${Math.floor(i/groupSize) + 1}${RESET}/${WHITE}${totalGroups}${RESET} ${progress}`);
      }
    }

    // Move to next line after completion
    console.log();
    return groups;
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
        console.log(`${YELLOW}No features analyzed yet. Use /read or /run to analyze commits.${RESET}`);
      }
      return state;

    case '/read':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }
      
      const count = parseInt(args[0]);
      if (isNaN(count) || count <= 0) {
        console.log(`${YELLOW}Please provide a valid positive number of commits to process.${RESET}`);
        return state;
      }

      try {
        const git = simpleGit(state.repoPath);
        const diffs = await processCommits(git, count, state);
        console.log(`${BOLD}\n🤖 Running Analysis${RESET}`);
        
        // Process features sequentially
        const newFeatures = [];
        for (let i = 0; i < diffs.length; i++) {
          console.log(`\nAnalyzing commit ${WHITE}${i + 1}${RESET}/${WHITE}${diffs.length}${RESET}`);
          const features = await analyzeGitDiff(diffs[i].message + '\n' + diffs[i].diff);
          newFeatures.push(features);
        }

        // Combine new features with global features
        const allFeatures = globalFeatures ? [globalFeatures, ...newFeatures] : newFeatures;
        
        console.log(`${BOLD}\nConsolidating features...${RESET}`);
        globalFeatures = await consolidateFeaturesList(allFeatures);
        
      } catch (error) {
        console.error(`${RED}❌ Error processing commits: ${error.message}${RESET}`);
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
        const groups = await processCommitGroups(git, groupSize, state);
        console.log(`${BOLD}\n🤖 Running Analysis${RESET}`);
        
        // Process features for each group
        const newFeatures = [];
        for (let i = 0; i < groups.length; i++) {
          console.log(`\nAnalyzing group ${WHITE}${i + 1}${RESET}/${WHITE}${groups.length}${RESET}`);
          const features = await analyzeGitDiff(groups[i].message + '\n' + groups[i].diff);
          newFeatures.push(features);
        }

        // Combine new features with global features
        const allFeatures = globalFeatures ? [globalFeatures, ...newFeatures] : newFeatures;
        
        console.log(`${BOLD}\nConsolidating features...${RESET}`);
        globalFeatures = await consolidateFeaturesList(allFeatures);
        
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
