#!/usr/bin/env node

/**
 * Git Repository Feature Analyzer CLI
 * 
 * A command-line tool that analyzes git repositories to extract and summarize feature implementations
 * across commits or tags. Uses Ollama for AI-powered analysis of git diffs.
 * 
 * Implementation:
 * - Modular architecture with dedicated services
 * - Event-driven command processing
 * - Consistent error handling and progress tracking
 * - Stateful repository and feature management
 * 
 * Services:
 * - cli-service: Command handling and user interaction
 * - repo-service: Repository analysis and state management
 * - feature-service: Feature processing and consolidation
 * - progress-service: Progress tracking and display
 * - git-analyzer: LLM-based diff analysis
 * - git-service: Git operations wrapper
 * - project-analyzer: Project type detection
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { setLanguage, toggleStreaming } from './services/ollama.js';
import { getTagDiffs, getCommitDiffs } from './services/git-service.js';
import { 
  HELP_MESSAGE, 
  promptForInput, 
  displayError,
  displaySuccess,
  displayWarning
} from './services/cli-service.js';
import { repoService } from './services/repo-service.js';
import { featureService } from './services/feature-service.js';
import { progressService } from './services/progress-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function handleCommitCommand(args) {
  const state = repoService.getState();
  if (!state.repoPath) {
    displayWarning('No repository selected. Use /repo to select a repository.');
    return;
  }

  const groupSize = args.length > 0 ? parseInt(args[0]) : Number.MAX_SAFE_INTEGER;
  if (isNaN(groupSize) || groupSize <= 0) {
    displayWarning('Please provide a valid positive number for group size.');
    return;
  }

  try {
    const git = repoService.getGit();
    const diffs = await getCommitDiffs(git, state.projectType, groupSize, 
      (progress) => progressService.updateProgress(progress, state.totalCommits, 'Analyzing commits'));
    
    await featureService.processDiffs(diffs, 'commit');
    repoService.updateLastRun('commit', groupSize);
    
    if (diffs.length === 0) {
      displayWarning('No differences found');
    }
  } catch (error) {
    displayError(`Error processing commit groups: ${error.message}`);
  }
}

async function handleTagCommand(args) {
  const state = repoService.getState();
  if (!state.repoPath) {
    displayWarning('No repository selected. Use /repo to select a repository.');
    return;
  }

  try {
    const git = repoService.getGit();
    const fromTag = args[0] || null;
    const diffs = await getTagDiffs(git, state.projectType, fromTag);
    
    await featureService.processDiffs(diffs, 'tag');
    repoService.updateLastRun('tag', fromTag);
    
    if (diffs.length === 0) {
      displayWarning('No differences found');
    }
  } catch (error) {
    displayError(`Error processing tags: ${error.message}`);
  }
}

async function handleDocCommand(args) {
  const state = repoService.getState();
  if (!state.repoPath) {
    displayWarning('No repository selected. Use /repo to select a repository.');
    return;
  }
  
  if (!featureService.hasFeatures()) {
    displayWarning('No features to document. Use /commit or /tag first.');
    return;
  }

  try {
    const filePath = args.join(' ').trim();
    const result = await featureService.generateDocumentation(state.repoPath, filePath);
    
    if (result.path) {
      displaySuccess(`Features ${result.updated ? 'updated' : 'documented'} to: ${result.path}`);
    } else {
      console.log('\nFeatures:');
      console.log(result.features);
    }
  } catch (error) {
    displayError(`Error documenting features: ${error.message}`);
  }
}

async function handleExportCommand() {
  const state = repoService.getState();
  if (!state.repoPath) {
    displayWarning('No repository selected. Use /repo to select a repository.');
    return;
  }

  if (!featureService.hasFeatures()) {
    displayWarning('No features to export. Use /commit or /tag first to analyze features.');
    return;
  }

  try {
    const exportFile = await featureService.exportFeatures(state.repoPath, state.projectType);
    displaySuccess(`Features exported to: ${exportFile}`);
  } catch (error) {
    displayError(`Error exporting features: ${error.message}`);
  }
}

async function handleCommand(cmd) {
  const [command, ...args] = cmd.toLowerCase().split(' ');

  switch (command) {
    case '/help':
      console.log(HELP_MESSAGE);
      break;

    case '/repo':
      let newPath = args.join(' ').trim();
      if (!newPath) {
        newPath = await promptForInput('Enter repository path: ');
      }

      if (newPath) {
        try {
          await repoService.analyzeRepository(newPath);
          repoService.displayRepositoryInfo();
          featureService.reset();
        } catch (error) {
          displayError(error.message);
        }
      }
      break;

    case '/speak':
      const newLang = args.join(' ').trim() || 'English';
      setLanguage(newLang);
      displaySuccess(`Language set to: ${newLang}`);
      break;

    case '/commit':
      await handleCommitCommand(args);
      break;

    case '/tag':
      await handleTagCommand(args);
      break;

    case '/doc':
      await handleDocCommand(args);
      break;

    case '/export':
      await handleExportCommand();
      break;

    case '/stream':
      const enabled = args[0]?.toLowerCase() !== 'off';
      toggleStreaming(enabled);
      displaySuccess(`Streaming ${enabled ? 'enabled' : 'disabled'}`);
      break;

    case '/exit':
      displaySuccess('\nGoodbye!');
      process.exit(0);

    default:
      displayWarning('Unknown command. Type /help for available commands.');
  }
}

async function main() {
  try {
    let initialPath = process.argv[2];

    if (!initialPath) {
      initialPath = await promptForInput('Enter repository path: ');
    }

    if (initialPath) {
      await repoService.analyzeRepository(initialPath);
      repoService.displayRepositoryInfo();
    }

    console.log(HELP_MESSAGE);

    // Command loop
    while (true) {
      const cmd = await promptForInput('> ');
      if (cmd) {
        await handleCommand(cmd);
      }
    }
  } catch (error) {
    displayError(error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  displaySuccess('\nGracefully shutting down...');
  process.exit(0);
});

main();
