#!/usr/bin/env node

/**
 * Git Repository Feature Analyzer CLI
 * 
 * A command-line tool that analyzes git repositories to extract and summarize feature implementations
 * across commits or tags. Uses Ollama for AI-powered analysis of git diffs.
 * 
 * Key Features:
 * - Interactive CLI with commands for repository analysis, diff processing, and feature extraction
 * - Supports analyzing changes by commit groups or between tags
 * - Real-time progress tracking with customizable streaming output
 * - Feature consolidation and documentation generation
 * - Multi-language support for feature descriptions
 * 
 * Core Data Models:
 * - State: { repoPath, totalCommits, stats, lastProcessedIndex }
 * - Features: Array of extracted feature descriptions
 * - Diffs: { fromCommit/Tag, toCommit/Tag, diff } for git changes
 * 
 * Dependencies:
 * - simple-git: Git operations and diff generation
 * - ora: Terminal spinner for progress indication
 * - readline: CLI input handling
 * 
 * Related Modules:
 * - services/ollama.js: AI model configuration and interaction
 * - services/git-analyzer.js: Diff analysis and feature extraction
 * - services/git-service.js: Git operations wrapper
 * - services/project-analyzer.js: Project type detection
 */

import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import readline from 'readline';
import ora from 'ora';
import fs from 'fs/promises';
import { setLanguage, toggleStreaming, CONFIG } from './services/ollama.js';
import { analyzeGitDiff, summarizeFeatures, updateDoc } from './services/git-analyzer.js';
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

// Track last run for retry functionality
let lastRun = {
  type: null, // 'commit', 'tag', or 'consolidate'
  params: null // groupSize for commit, fromTag for tag
};

const HELP_MESSAGE = `
${BOLD}Available Commands:${RESET}
  ${WHITE}/help${RESET}              - Show this help message
  ${WHITE}/repo${RESET} [path]       - Switch repositories
  ${WHITE}/commit${RESET} [n]        - Create and analyze diffs for every n commits
  ${WHITE}/tag${RESET} [from]        - Analyze changes between git tags, optionally starting from a specific tag
  ${WHITE}/speak${RESET} [lang]      - Set language for responses (default: English)
  ${WHITE}/stream${RESET} [on|off]   - Toggle response streaming (default: on)
  ${WHITE}/export${RESET}            - Export features to a timestamped log file
  ${WHITE}/doc${RESET} [file]        - Summarize features to a file (optional)
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

async function consolidateAndDisplayFeatures(featuresList) {
  try {
    const startTime = process.hrtime.bigint();
    if (CONFIG.streaming) {
      console.log(`\n${BOLD}Consolidating features...${RESET}`);
      features = await summarizeFeatures(featuresList);
      console.log();
    } else {
      const consolidateSpinner = ora('Consolidating features...').start();
      features = await summarizeFeatures(featuresList);
      console.log();
      consolidateSpinner.succeed('Features consolidated successfully');
      console.log(`\n${DIM}${features}${RESET}\n`);
    }
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    console.log(`${GREEN}Consolidation took ${duration.toFixed(2)} seconds${RESET}`);

    console.log(`\n${BOLD}Consolidated Features: ${RESET}\n\n`);
    console.log(`${GRAY}${features}${RESET}\n`);
    return features;
  } catch (error) {
    console.error(`${RED}Error consolidating features: ${error.message}${RESET}`);
    return null;
  }
}

async function processDiffs(git, type, params, state) {
  try {
    const startTime = process.hrtime.bigint();

    // Get diffs based on type (commit or tag)
    let diffs;
    if (type === 'commit') {
      const groupSize = params;

      console.log(`\n${BOLD}Processing Commits${RESET}`);
      console.log(`${WHITE}Total Commits:${RESET}    ${YELLOW}${state.totalCommits}${RESET}`);
      console.log(`${WHITE}Group Size:${RESET}       ${YELLOW}${groupSize}${RESET}`);

      // Calculate total operations for progress bar
      const totalOperations = state.totalCommits < groupSize
        ? 1  // If not enough commits, we'll just do one diff from empty tree to HEAD
        : (groupSize === 1
          ? state.totalCommits
          : Math.floor((state.totalCommits - 1) / groupSize) + 1);

      diffs = await getCommitDiffs(git, projectType, groupSize, (progress) => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`Analyzing commits: ${createProgressBar(totalOperations)(Math.min(progress, totalOperations))}`);
      });

      console.log(`\n${GREEN}Successfully processed ${diffs.length} commit groups${RESET}`);
    } else {
      const fromTag = params;
      try {
        diffs = await getTagDiffs(git, projectType, fromTag);
      } catch (error) {
        if (error.message.includes('not found')) {
          // Get all available tags
          const tags = await git.tags();
          if (tags.all.length === 0) {
            console.log(`${YELLOW}No tags found in the repository.${RESET}`);
            return;
          }

          // Display available tags
          console.log(`${YELLOW}Tag '${fromTag}' not found. Available tags:${RESET}`);
          console.log(`\n${BOLD}Available Tags:${RESET}`);
          tags.all.forEach(tag => {
            console.log(`  ${WHITE}${tag}${RESET}`);
          });
          console.log(`\n${YELLOW}Please use /tag with one of the above tags.${RESET}`);
          return;
        }
        throw error;
      }
    }

    if (diffs.length === 0) {
      console.log(`${YELLOW}No differences found${RESET}`);
      return;
    }

    // Clear previous features
    allFeatures = [];

    // Process each diff
    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i];
      const diffMessage = type === 'commit'
        ? `${diff.fromCommit.hash === '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
          ? 'empty tree'
          : diff.fromCommit.hash.substring(0, 7)} → ${diff.toCommit.hash.substring(0, 7)}`
        : `${diff.fromTag} → ${diff.toTag}`;

      // Skip processing if no diff content
      if (!diff.diff) {
        const message = `No changes found for ${type} ${i + 1}/${diffs.length}`;
        console.log(`${YELLOW}${message}${RESET}`)
        continue;
      }

      // Prepare diff content for analysis
      const diffContent = diff.diff;

      // Process in streaming mode
      if (CONFIG.streaming) {
        console.log(`\n${BOLD}Processing ${type} ${i + 1}/${diffs.length}: ${diffMessage}${RESET}`);
        const diffFeatures = await analyzeGitDiff(diffContent);
        allFeatures.push(...diffFeatures);
      }
      // Process in non-streaming mode
      else {
        const spinner = ora(`Processing ${type} ${i + 1}/${diffs.length}: ${diffMessage}`).start();
        const diffFeatures = await analyzeGitDiff(diffContent);
        spinner.succeed();
        console.log(`\n${DIM}${diffFeatures.join('\n\n')}${RESET}\n`);
        allFeatures.push(...diffFeatures);
      }
    }

    const diffEndTime = process.hrtime.bigint();
    const diffDuration = Number(diffEndTime - startTime) / 1e9;
    console.log(`\n${GREEN}Diff processing took ${diffDuration.toFixed(2)} seconds${RESET}`);

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

    case '/speak':
      const newLang = args.join(' ').trim() || 'English';
      setLanguage(newLang);
      console.log(`${GREEN}Language set to: ${WHITE}${newLang}${RESET}`);
      return state;

    case '/commit':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }

      const groupSize = args.length > 0 ? parseInt(args[0]) : Number.MAX_SAFE_INTEGER;
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

    case '/doc':
      if (!state.repoPath) {
        console.log(`${YELLOW}No repository selected. Use /repo to select a repository.${RESET}`);
        return state;
      }
      if (allFeatures.length === 0) {
        console.log(`${YELLOW}No features to document. Use /commit or /tag first.${RESET}`);
        return state;
      }

      const filePath = args.join(' ').trim();
      let content = '';

      if (filePath) {
        try {
          try {
            content = await fs.readFile(resolve(state.repoPath, filePath), 'utf8');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            // File doesn't exist, will create new
          }

          // If file exists, update it. Otherwise create new.
          features = content 
            ? await updateDoc(content, allFeatures)
            : await summarizeFeatures(allFeatures);

          await fs.writeFile(resolve(state.repoPath, filePath), features);
          console.log(`\n${GREEN}Features ${content ? 'updated' : 'documented'} to: ${filePath}${RESET}`);
        } catch (error) {
          console.error(`\n${RED}Error documenting features: ${error.message}${RESET}`);
        }
      } else {
        features = await summarizeFeatures(allFeatures);
        console.log(`${BOLD}\nFeatures: ${RESET}`);
        console.log(`${DIM}${features}${RESET}`);
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
