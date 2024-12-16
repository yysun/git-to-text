/**
 * Repository analysis and state management service
 * 
 * Implementation:
 * - Manages repository state and analysis
 * - Handles git operations and diff processing
 * - Validates repository structure
 * - Tracks repository statistics
 * 
 * State management:
 * - Repository path and validation
 * - Commit and branch tracking
 * - Feature processing state
 * - Last run information
 */

import simpleGit from 'simple-git';
import { resolve } from 'path';
import { detectProjectType } from './project-analyzer.js';
import { formatOutput, COLORS } from './cli-service.js';

export class RepositoryService {
  constructor() {
    this.state = {
      repoPath: null,
      totalCommits: 0,
      stats: null,
      projectType: 'unknown',
      lastRun: {
        type: null,
        params: null
      }
    };
  }

  async validateRepository(path) {
    const git = simpleGit(path);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error('Invalid git repository');
    }
    return resolve(path);
  }

  async analyzeRepository(path) {
    const git = simpleGit(path);
    const validPath = await this.validateRepository(path);

    // Gather repository information
    const [files, branches, status, totalCommits] = await Promise.all([
      git.raw(['ls-files']).then(files => files.split('\n').filter(Boolean)),
      git.branchLocal(),
      git.status(),
      git.raw(['rev-list', '--count', 'HEAD']).then(count => parseInt(count.trim()))
    ]);

    // Analyze project type
    const projectType = detectProjectType(files);

    // Update state
    this.state = {
      repoPath: validPath,
      totalCommits,
      stats: { branches, commits: totalCommits, status },
      projectType,
      lastRun: { type: null, params: null }
    };

    return this.state;
  }

  displayRepositoryInfo() {
    const { repoPath, projectType, stats } = this.state;
    const { branches, commits, status } = stats;

    console.log(`\n${COLORS.BOLD}Repository Analysis Summary${COLORS.RESET}`);
    console.log(`${COLORS.WHITE}Location:${COLORS.RESET}         ${COLORS.GREEN}${repoPath}${COLORS.RESET}`);
    console.log(`${COLORS.WHITE}Project Type:${COLORS.RESET}     ${COLORS.GREEN}${projectType}${COLORS.RESET}`);
    console.log(`${COLORS.WHITE}Current Branch:${COLORS.RESET}   ${COLORS.GREEN}${branches.current}${COLORS.RESET}`);
    console.log(`${COLORS.WHITE}Total Commits:${COLORS.RESET}    ${COLORS.YELLOW}${commits}${COLORS.RESET}`);
    console.log(`${COLORS.WHITE}Total Branches:${COLORS.RESET}   ${COLORS.YELLOW}${branches.all.length}${COLORS.RESET}`);

    if (status.modified.length > 0 || status.staged.length > 0) {
      console.log(`\n${COLORS.BOLD}Working Directory Status${COLORS.RESET}`);
      console.log(`${COLORS.WHITE}Modified Files:${COLORS.RESET}   ${COLORS.YELLOW}${status.modified.length}${COLORS.RESET}`);
      console.log(`${COLORS.WHITE}Staged Files:${COLORS.RESET}     ${COLORS.YELLOW}${status.staged.length}${COLORS.RESET}`);
    }
  }

  getGit() {
    if (!this.state.repoPath) {
      throw new Error('No repository selected');
    }
    return simpleGit(this.state.repoPath);
  }

  updateLastRun(type, params) {
    this.state.lastRun = { type, params };
  }

  getState() {
    return this.state;
  }
}

export const repoService = new RepositoryService();
