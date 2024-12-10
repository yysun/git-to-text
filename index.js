#!/usr/bin/env node

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import fs from 'fs/promises';
import { analyzeGitDiff, consolidateFeaturesList, setLanguage, toggleStreaming, CONFIG } from './services/ollama.js';
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
let language = 'English';

// Track last run for retry functionality
let lastRun = {
  type: null, // 'commit', 'tag', or 'consolidate'
  params: null // groupSize for commit, fromTag for tag
};

const HELP_MESSAGE = `
${BOLD}Available Commands:${RESET}
  ${WHITE}/help${RESET}              - Show this help message
  ${WHITE}/repo${RESET} [path]       - Switch repositories
  ${WHITE}/features${RESET}          - Show summarized features
  ${WHITE}/commit${RESET} [n]        - Create and analyze diffs for every n commits
  ${WHITE}/tag${RESET} [from]        - Analyze changes between git tags, optionally starting from a specific tag
  ${WHITE}/retry${RESET}             - Re-run consolidation of existing features
  ${WHITE}/speak${RESET} [lang]      - Set language for responses (default: English)
  ${WHITE}/stream${RESET} [on|off]   - Toggle response streaming (default: on)
  ${WHITE}/export${RESET}            - Export features to a timestamped log file
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

async function analyzeRepository(path) {
  const spinner = ora('Analyzing repository...').start();
  const git = simpleGit(path);

  try {
    // Step 1: Validate repository
    spinner.text = 'Validating repository...';
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      spinner.fail('Invalid git repository');
      throw new Error('Invalid git repository');
    }
    const validPath = resolve(path);

    // Step 2: Gather repository information
    spinner.text = 'Gathering repository information...';
    const [files, branches, status, totalCommits] = await Promise.all([
      git.raw(['ls-files']).then(files => files.split('\n').filter(Boolean)),
      git.branchLocal(),
      git.status(),
      git.raw(['rev-list', '--count', 'HEAD']).then(count => parseInt(count.trim()))
    ]);

    // Step 3: Analyze project type
    spinner.text = 'Analyzing project structure...';
    projectType = detectProjectType(files);

    // Reset features for new repository
    features = '';
    allFeatures = [];
    lastRun = { type: null, params: null };

    spinner.succeed('Repository analysis complete');

    // Display consolidated repository information
    console.log(`\n${BOLD}Repository Analysis Summary${RESET}`);
    console.log(`${WHITE}Location:${RESET}         ${GREEN}${validPath}${RESET}`);
    console.log(`${WHITE}Project Type:${RESET}     ${GREEN}${projectType}${RESET}`);
    console.log(`${WHITE}Current Branch:${RESET}   ${GREEN}${branches.current}${RESET}`);
    console.log(`${WHITE}Total Commits:${RESET}    ${YELLOW}${totalCommits}${RESET}`);
    console.log(`${WHITE}Total Branches:${RESET}   ${YELLOW}${branches.all.length}${RESET}`);
    
    // Show working directory status if there are changes
    if (status.modified.length > 0 || status.staged.length > 0) {
      console.log(`\n${BOLD}Working Directory Status${RESET}`);
      console.log(`${WHITE}Modified Files:${RESET}   ${YELLOW}${status.modified.length}${RESET}`);
      console.log(`${WHITE}Staged Files:${RESET}     ${YELLOW}${status.staged.length}${RESET}`);
    }

    return {
      repoPath: validPath,
      totalCommits,
      stats: { branches, commits: totalCommits, status },
      features: null,
      lastProcessedIndex: -1
    };

  } catch (error) {
    spinner.fail(`Repository analysis failed: ${error.message}`);
    throw error;
  }
}

async function processDiffs(git, type, params, state) {
  try {
    // Get diffs based on type (commit or tag)
    let diffs;
    if (type === 'commit') {
      const groupSize = params;
      if (state.totalCommits < groupSize) {
        console.log(`${YELLOW}Not enough commits to process with group size ${groupSize}.${RESET}`);
        return;
      }

      console.log(`\n${BOLD}Processing Commits${RESET}`);
      console.log(`${WHITE}Total Commits:${RESET}    ${YELLOW}${state.totalCommits}${RESET}`);
      console.log(`${WHITE}Group Size:${RESET}       ${YELLOW}${groupSize}${RESET}`);

      // Calculate total operations for progress bar
      const totalOperations = groupSize === 1 
        ? state.totalCommits 
        : Math.floor((state.totalCommits - 1) / groupSize) + 1;

      diffs = await getCommitDiffs(git, projectType, groupSize, (progress) => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`Analyzing commits: ${createProgressBar(totalOperations)(Math.min(progress, totalOperations))}`);
      });

      console.log(`\n${GREEN}Successfully processed ${diffs.length} commit groups${RESET}`);
    } else {
      const fromTag = params;
      diffs = await getTagDiffs(git, projectType, fromTag);
    }

    if (diffs.length === 0) {
      console.log(`${YELLOW}No differences found${RESET}`);
      return;
    }

    // Clear previous features
    allFeatures = [];

    // Process each diff
    const diffSpinner = !CONFIG.streaming ? ora().start() : null;
    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i];
      const diffMessage = type === 'commit' 
        ? `${diff.fromCommit.hash === '4b825dc642cb6eb9a060e54bf8d69288fbee4904' 
            ? 'empty tree' 
            : diff.fromCommit.hash} → ${diff.toCommit.hash}`
        : `${diff.fromTag} → ${diff.toTag}`;

      if (!CONFIG.streaming) {
        diffSpinner.text = `Processing diff ${i + 1}/${diffs.length}: ${diffMessage}`;
      } else {
        console.log(`\n${BOLD}Processing Diff ${i + 1}/${diffs.length}${RESET}`);
        console.log(`${WHITE}From:${RESET} ${diffMessage}`);
      }

      if (diff.diff) {
        const diffFeatures = await analyzeGitDiff(
          type === 'commit' ? diff.message + '\n' + diff.diff : diff.diff
        );
        allFeatures.push(diffFeatures);
      }
    }
    if (diffSpinner) diffSpinner.succeed('Processed all diffs');

    // Consolidate features
    console.log('\nConsolidating features...');
    features = await consolidateFeaturesList(allFeatures);
    console.log(`${GREEN}Features consolidated successfully${RESET}`);

  } catch (error) {
    console.error(`${RED}Failed to process ${type}s: ${error.message}${RESET}`);
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
          return await analyzeRepository(newPath);
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

    case '/speak':
      const newLang = args.join(' ').trim() || 'English';
      language = newLang;
      setLanguage(newLang);
      console.log(`${GREEN}Language set to: ${WHITE}${newLang}${RESET}`);
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
        await processDiffs(git, 'commit', groupSize, state);
        lastRun = { type: 'commit', params: groupSize };
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
        await processDiffs(git, 'tag', fromTag, state);
        lastRun = { type: 'tag', params: fromTag };
      } catch (error) {
        console.error(`${RED}Error processing tags: ${error.message}${RESET}`);
      }
      return state;

    case '/retry':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }
      if (allFeatures.length === 0) {
        console.log(`${YELLOW}No features to consolidate. Use /commit or /tag first.${RESET}`);
        return state;
      }

      try {
        const spinner = ora('Re-running feature consolidation...').start();
        features = await consolidateFeaturesList(allFeatures);
        spinner.succeed('Features consolidated successfully');
      } catch (error) {
        console.error(`${RED}Error consolidating features: ${error.message}${RESET}`);
      }
      return state;

    case '/export':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }
      if (features.length === 0 && allFeatures.length === 0) {
        console.log(`${YELLOW}No features to export. Use /commit or /tag first to analyze features.${RESET}`);
        return state;
      }

      try {
        const spinner = ora('Exporting features...').start();
        const repoName = state.repoPath.split('/').pop();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportFile = `${repoName}-features-${timestamp}.log`;

        let exportContent = `Repository: ${state.repoPath}\n`;
        exportContent += `Project Type: ${projectType}\n`;
        exportContent += `Export Time: ${new Date().toISOString()}\n\n`;

        if (allFeatures.length > 0) {
          exportContent += `Individual Feature Summaries:\n`;
          exportContent += `------------------------\n`;
          allFeatures.forEach((feature, index) => {
            exportContent += `\nFeature Set ${index + 1}:\n${feature}\n`;
          });
        }

        if (features.length > 0) {
          exportContent += `\nConsolidated Features:\n`;
          exportContent += `--------------------\n`;
          exportContent += features;
        }

        await fs.writeFile(exportFile, exportContent);
        spinner.succeed(`Features exported to: ${exportFile}`);
      } catch (error) {
        console.error(`${RED}Error exporting features: ${error.message}${RESET}`);
      }
      return state;

    case '/stream':
      const enabled = args[0]?.toLowerCase() !== 'off';
      toggleStreaming(enabled);
      console.log(`${GREEN}Streaming ${enabled ? 'enabled' : 'disabled'}${RESET}`);
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
      state = await analyzeRepository(initialPath);
    }

    console.log(HELP_MESSAGE);
    await commandLoop(state);

  } catch (error) {
    console.error(`${RED}Error: ${error.message}${RESET}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log(`${GREEN}\nGracefully shutting down...${RESET}`);
  process.exit(0);
});

main();
