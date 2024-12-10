#!/usr/bin/env node

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import { analyzeGitDiff, consolidateFeaturesList } from './services/ollama.js';
import { detectProjectType } from './services/project-analyzer.js';
import { getTagDiffs, getCommitDiffs } from './services/git-service.js';

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
let features = '';
let allFeatures = [];
let projectType = 'unknown';

const HELP_MESSAGE = `
${BOLD}Available Commands:${RESET}
  ${WHITE}/help${RESET}              - Show this help message
  ${WHITE}/repo${RESET} [path]       - Switch repositories
  ${WHITE}/features${RESET}          - Show summarized features
  ${WHITE}/commit${RESET} [n]        - Create and analyze diffs for every n commits
  ${WHITE}/tag${RESET} [from]        - Analyze changes between git tags, optionally starting from a specific tag
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
    features = '';
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

  if (totalCommits < groupSize) {
    console.log(`${YELLOW}Not enough commits to process with group size ${groupSize}.${RESET}`);
    return [];
  }

  console.log(`\n${BOLD}Processing Commits${RESET}`);
  console.log(`${WHITE}Total Commits:${RESET}    ${YELLOW}${totalCommits}${RESET}`);
  console.log(`${WHITE}Group Size:${RESET}       ${YELLOW}${groupSize}${RESET}`);

  // Display the comparison pattern based on group size
  let pattern;
  if (groupSize === 1) {
    pattern = "Each commit compared with its previous (1 with 0, 2 with 1, etc.)";
  } else if (groupSize === 2) {
    pattern = "First comparing commit 2 with empty tree, then 4 with 2, 6 with 4, etc.";
  } else {
    pattern = `First comparing commit ${groupSize} with empty tree, then ${groupSize * 2} with ${groupSize}, ${groupSize * 3} with ${groupSize * 2}, etc.`;
  }
  console.log();

  try {
    // Calculate total operations for progress bar
    let totalOperations;
    if (groupSize === 1) {
      totalOperations = totalCommits;
    } else {
      // For n>1, calculate how many complete groups we'll process
      const numGroups = Math.floor((totalCommits - 1) / groupSize);
      totalOperations = numGroups + 1; // +1 for the first comparison with empty tree
    }

    // Get diffs using the updated getCommitDiffs function
    const diffs = await getCommitDiffs(git, projectType, groupSize, (progress) => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      const progressBar = createProgressBar(totalOperations);
      process.stdout.write(`Progress: ${progressBar(Math.min(progress, totalOperations))}`);
    });

    // Ensure we show 100% at completion
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    const progressBar = createProgressBar(totalOperations);
    process.stdout.write(`Progress: ${progressBar(totalOperations)}\n`);

    console.log(`\n${GREEN}Successfully processed all commits${RESET}`);

    // Process each diff
    for (let i = 0; i < diffs.length; i++) {
      const { fromCommit, toCommit, diff, message } = diffs[i];

      console.log(`\n${BOLD}Processing Diff ${i + 1}/${diffs.length}${RESET}`);
      if (fromCommit.hash === '4b825dc642cb6eb9a060e54bf8d69288fbee4904') {
        console.log(`${WHITE}From:${RESET} empty tree ${WHITE}→${RESET} ${toCommit.hash}`);
      } else {
        console.log(`${WHITE}From:${RESET} ${fromCommit.hash} ${WHITE}→${RESET} ${toCommit.hash}`);
      }

      if (diff) {
        const features = await analyzeGitDiff(message + '\n' + diff);
        allFeatures.push(features);
      }
    }

    // Consolidate features
    console.log(`\n${BOLD}Consolidating Features${RESET}`);
    features = await consolidateFeaturesList(allFeatures);

    console.log(`\n${GREEN}Features consolidated successfully${RESET}`);

    return diffs;
  } catch (error) {
    console.error(`\n${RED}Failed to process commits: ${error.message}${RESET}`);
    throw error;
  }
}

async function processTagDiffs(git, fromTag = null) {
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

    // If fromTag is provided, verify it exists
    if (fromTag && !sortedTags.some(tag => tag.name === fromTag)) {
      console.log(`${RED}Tag '${fromTag}' not found.${RESET}`);
      console.log(`\n${BOLD}Available tags:${RESET}`);
      sortedTags.forEach(tag => {
        console.log(`${WHITE}${tag.name}${RESET} (${tag.date.toISOString()})`);
      });
      console.log(`\nPlease try again with one of the available tags.`);
      return;
    }

    // Step 2: Process tag differences with progress bar
    console.log(`${BOLD}Processing Tag Differences${RESET}`);

    const diffs = await getTagDiffs(git, projectType, fromTag);

    if (diffs.length === 0) {
      console.log(`${YELLOW}No differences found between tags.${RESET}`);
      return;
    }

    console.log(`${WHITE}Total Tags to Process:${RESET} ${YELLOW}${diffs.length}${RESET}`);

    for (let i = 0; i < diffs.length; i++) {
      const { fromTag: from, toTag: to, diff } = diffs[i];

      console.log(`\n${BOLD}Processing Tags ${i + 1}/${diffs.length}${RESET}`);
      console.log(`${WHITE}From:${RESET} ${from} ${WHITE}→${RESET} ${to}`);

      if (diff) {
        const features = await analyzeGitDiff(diff);
        allFeatures.push(features);
      }
    }

    console.log(`\n${GREEN}Successfully processed all tags${RESET}`);

    // Step 3: Consolidate features
    console.log(`\n${BOLD}Consolidating Features${RESET}`);
    features = await consolidateFeaturesList(allFeatures);
    console.log(`\n${GREEN}Features consolidated successfully${RESET}`);

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
      if (features.length > 0) {
        console.log(`${BOLD}\nFeatures: ${RESET}`);
        console.log(features);
      } else {
        console.log(`${YELLOW}No features analyzed yet. Use /run to analyze commits.${RESET}`);
      }
      return state;

    case '/commit':
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

    case '/tag':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }

      try {
        const git = simpleGit(state.repoPath);
        const fromTag = args[0] || null;
        await processTagDiffs(git, fromTag);
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
