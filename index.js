#!/usr/bin/env node

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import { analyzeGitDiff, consolidateFeaturesList } from './services/ollama.js';
import { detectProjectType } from './services/project-analyzer.js';
import { filterSourceFiles, getTagDiffs, getCommitDiffs } from './services/git-service.js';

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

// Features array to track all features
let allFeatures = [];
let projectType = 'unknown';

const HELP_MESSAGE = `
${BOLD}Available Commands:${RESET}
  ${WHITE}/help${RESET}              - Show this help message
  ${WHITE}/repo${RESET} [path]       - Switch repositories
  ${WHITE}/features${RESET}          - Show summarized features
  ${WHITE}/run${RESET} [n]           - Create and analyze diffs for every n commits
  ${WHITE}/tags${RESET}              - Analyze changes between git tags
  ${WHITE}/exit${RESET}              - Exit the program
`;

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

async function loadRepository(path) {
  const git = simpleGit(path);
  const validPath = await validateRepoPath(path);
  const spinner = ora('Loading repository...').start();
  
  try {
    // Detect project type
    projectType = await detectRepoType(validPath);
    spinner.text = 'Detecting project type...';
    console.log(`${BOLD}\nProject Analysis${RESET}`);
    console.log(`${WHITE}Detected Type:${RESET}    ${GREEN}${projectType}${RESET}`);
    
    // Get only the total number of commits
    const totalCommits = (await git.raw(['rev-list', '--count', 'HEAD'])).trim();
    
    spinner.stop();
    
    const stats = await getRepoStats(git, totalCommits);
    
    // Reset features when loading a new repository
    allFeatures = [];
    
    console.log(`${GREEN}Repository loaded successfully${RESET}`);
    
    return {
      repoPath: validPath,
      totalCommits: parseInt(totalCommits),
      stats,
      features: null,
      lastProcessedIndex: -1
    };
  } catch (error) {
    spinner.fail(`${RED}Failed to load repository${RESET}`);
    throw error;
  }
}

async function getRepoStats(git, totalCommits) {
  const stats = {
    branches: await git.branchLocal(),
    commits: parseInt(totalCommits),
    status: await git.status()
  };
  
  console.log(`${BOLD}\nRepository Statistics${RESET}`);
  console.log(`${WHITE}Branch:${RESET}           ${GREEN}${stats.branches.current}${RESET}`);
  console.log(`${WHITE}Commits:${RESET}          ${YELLOW}${stats.commits}${RESET}`);
  console.log(`${WHITE}Total Branches:${RESET}   ${YELLOW}${stats.branches.all.length}${RESET}`);
  console.log(`${WHITE}Modified Files:${RESET}   ${YELLOW}${stats.status.modified.length}${RESET}`);
  console.log(`${WHITE}Staged Files:${RESET}     ${YELLOW}${stats.status.staged.length}${RESET}`);
  console.log(`${WHITE}Project Type:${RESET}     ${GREEN}${projectType}${RESET}`);
  
  return stats;
}

async function detectRepoType(repoPath) {
  const git = simpleGit(repoPath);
  const files = await git.raw(['ls-files']);
  const fileList = files.split('\n').filter(Boolean);
  return detectProjectType(fileList);
}

async function printHelp() {
  console.log(HELP_MESSAGE);
}

async function processCommitGroups(git, groupSize, state) {
  const totalCommits = state.totalCommits;
  const totalGroups = Math.ceil(totalCommits / groupSize);
  
  if (totalCommits === 0) {
    console.log(`${YELLOW}No commits to process.${RESET}`);
    return [];
  }

  // Step 1: Fetch commit history
  console.log(`\n${BOLD}Fetching Commit History${RESET}`);
  
  // Adjust total for progress bar to match actual number of diffs we'll process
  const progressTotal = totalCommits - 1;
  const getProgress = createProgressBar(progressTotal);
  process.stdout.write(`Progress: ${getProgress(0)}`);
  
  const diffs = await getCommitDiffs(git, projectType, (current) => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: ${getProgress(Math.min(current, progressTotal))}`);
  });
  
  // Ensure we show 100% at completion
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(`Progress: ${getProgress(progressTotal)}\n`);
  
  console.log('\n'); // New line after progress bar

  // Step 2: Process commit groups
  console.log(`${BOLD}Processing Commit Groups${RESET}`);
  console.log(`${WHITE}Total Groups:${RESET}      ${YELLOW}${totalGroups}${RESET}`);
  console.log(`${WHITE}Commits per Group:${RESET} ${YELLOW}${groupSize}${RESET}`);
  
  try {
    for (let i = 0; i < diffs.length; i += groupSize) {
      const groupEnd = Math.min(i + groupSize, diffs.length);
      const groupNumber = Math.floor(i/groupSize) + 1;
      
      console.log(`\n${BOLD}Group ${groupNumber}/${totalGroups}${RESET} (commits ${i + 1}-${groupEnd})`);
      
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
        const features = await analyzeGitDiff(combinedMessage + '\n' + combinedDiff);
        allFeatures.push(features);
      }
    }

    console.log(`\n${GREEN}Successfully processed all ${totalGroups} groups${RESET}`);

    // Step 3: Consolidate features
    console.log(`\n${BOLD}Consolidating Features${RESET}`);
    const consolidatedFeatures = await consolidateFeaturesList(allFeatures);
    console.log(consolidatedFeatures);
    
    return [];
  } catch (error) {
    console.error(`\n${RED}Failed to process commit groups: ${error.message}${RESET}`);
    throw error;
  }
}

async function processTagDiffs(git) {
  try {
    // Step 1: Fetch tags
    console.log(`\n${BOLD}Analyzing Tags${RESET}`);
    
    // Get all tags and sort them
    const tags = await git.tags();
    const sortedTags = [];
    
    // Show progress while getting tag details
    console.log(`${BOLD}Fetching Tag Information${RESET}`);
    const getTagProgress = createProgressBar(tags.all.length);
    process.stdout.write(`Progress: ${getTagProgress(0)}`);
    
    // Get creation date for each tag
    for (let i = 0; i < tags.all.length; i++) {
      const tagName = tags.all[i];
      const show = await git.show([tagName]);
      const date = show.match(/Date:\s+(.+)/)?.[1];
      sortedTags.push({ name: tagName, date: new Date(date) });
      
      // Update progress
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Progress: ${getTagProgress(i + 1)}`);
    }
    
    // Ensure we show 100% at completion for tag fetching
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: ${getTagProgress(tags.all.length)}\n\n`);
    
    // Sort tags by date
    sortedTags.sort((a, b) => a.date - b.date);
    
    if (sortedTags.length === 0) {
      console.log(`${YELLOW}No tags found in repository.${RESET}`);
      return;
    }

    // Step 2: Process tag differences with progress bar
    console.log(`${BOLD}Processing Tag Differences${RESET}`);
    
    const totalDiffs = sortedTags.length - 1;
    const getDiffProgress = createProgressBar(totalDiffs);
    process.stdout.write(`Progress: ${getDiffProgress(0)}`);
    
    const diffs = [];
    for (let i = 0; i < totalDiffs; i++) {
      const currentTag = sortedTags[i];
      const nextTag = sortedTags[i + 1];
      
      const diff = await git.diff([currentTag.name, nextTag.name]);
      const sourceDiff = filterSourceFiles(diff, projectType);
      
      if (sourceDiff) {
        diffs.push({
          fromTag: currentTag.name,
          toTag: nextTag.name,
          date: nextTag.date,
          diff: sourceDiff
        });
      }
      
      // Update progress
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Progress: ${getDiffProgress(i + 1)}`);
    }
    
    // Ensure we show 100% at completion for diff processing
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Progress: ${getDiffProgress(totalDiffs)}\n\n`);
    
    // Step 3: Analyze diffs
    console.log(`${WHITE}Total Tags to Process:${RESET} ${YELLOW}${diffs.length}${RESET}`);
    
    for (let i = 0; i < diffs.length; i++) {
      const { fromTag, toTag, diff } = diffs[i];
      
      console.log(`\n${BOLD}Processing Tags ${i + 1}/${diffs.length}${RESET}`);
      console.log(`${WHITE}From:${RESET} ${fromTag} ${WHITE}→${RESET} ${toTag}`);
      
      if (diff) {
        const features = await analyzeGitDiff(diff);
        allFeatures.push(features);
      }
    }

    console.log(`\n${GREEN}Successfully processed all tags${RESET}`);

    // Step 4: Consolidate features
    console.log(`\n${BOLD}Consolidating Features${RESET}`);
    const consolidatedFeatures = await consolidateFeaturesList(allFeatures);
    console.log(consolidatedFeatures);

  } catch (error) {
    console.error(`\n${RED}Failed to process tags: ${error.message}${RESET}`);
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
          console.error(`${RED}Error: ${error.message}${RESET}`);
          return state;
        }
      }
      return state;

    case '/features':
      if (allFeatures.length > 0) {
        console.log(`${BOLD}\nFeatures Analysis${RESET}`);
        console.log(DIM + allFeatures[allFeatures.length - 1] + RESET);
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
        console.error(`${RED}Error processing commit groups: ${error.message}${RESET}`);
      }
      return state;

    case '/tags':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }

      try {
        const git = simpleGit(state.repoPath);
        await processTagDiffs(git);
      } catch (error) {
        console.error(`${RED}Error processing tags: ${error.message}${RESET}`);
      }
      return state;

    case '/exit':
      console.log(`${GREEN}\nGoodbye!${RESET}`);
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
      totalCommits: 0,
      stats: null,
      lastProcessedIndex: -1
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
    spinner.fail(`${RED}Error: ${error.message}${RESET}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log(`${GREEN}\nGracefully shutting down...${RESET}`);
  process.exit(0);
});

main();
