/**
 * Feature processing and consolidation service
 * 
 * Implementation:
 * - Manages feature extraction and processing
 * - Handles feature consolidation and summarization
 * - Provides export and documentation capabilities
 * - Tracks feature processing state
 * 
 * Features:
 * - Feature extraction from git diffs
 * - Feature consolidation and grouping
 * - Documentation generation
 * - Export functionality
 */

import fs from 'fs/promises';
import { resolve } from 'path';
import { formatOutput, COLORS } from './cli-service.js';
import { analyzeGitDiff, summarizeFeatures, updateDoc } from './git-analyzer.js';
import { progressService } from './progress-service.js';
import { CONFIG } from './ollama.js';

export class FeatureService {
  constructor() {
    this.features = '';
    this.allFeatures = [];
  }

  async processDiffs(diffs, type) {
    const startTime = process.hrtime.bigint();
    this.allFeatures = [];

    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i];
      const diffMessage = type === 'commit'
        ? `${diff.fromCommit.hash === '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
          ? 'empty tree'
          : diff.fromCommit.hash.substring(0, 7)} → ${diff.toCommit.hash.substring(0, 7)}`
        : `${diff.fromTag} → ${diff.toTag}`;

      if (!diff.diff) {
        console.log(formatOutput('warning', `No changes found for ${type} ${i + 1}/${diffs.length}`));
        continue;
      }

      if (CONFIG.streaming) {
        console.log(`\n${COLORS.BOLD}Processing ${type} ${i + 1}/${diffs.length}: ${diffMessage}${COLORS.RESET}`);
        const diffFeatures = await analyzeGitDiff(diff.diff);
        this.allFeatures.push(...diffFeatures);
      } else {
        progressService.updateProgress(i + 1, diffs.length, `Processing ${type}`);
        const diffFeatures = await analyzeGitDiff(diff.diff);
        this.allFeatures.push(...diffFeatures);
      }
    }

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    console.log(formatOutput('success', `\nDiff processing took ${duration.toFixed(2)} seconds`));
  }

  async consolidateFeatures() {
    if (this.allFeatures.length === 0) {
      throw new Error('No features to consolidate');
    }

    const startTime = process.hrtime.bigint();

    if (CONFIG.streaming) {
      console.log(`\n${COLORS.BOLD}Consolidating features...${COLORS.RESET}`);
      this.features = await summarizeFeatures(this.allFeatures);
    } else {
      progressService.updateProgress(0, 1, 'Consolidating features');
      this.features = await summarizeFeatures(this.allFeatures);
      progressService.complete('Features consolidated');
    }

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    console.log(formatOutput('success', `Consolidation took ${duration.toFixed(2)} seconds`));

    return this.features;
  }

  async exportFeatures(repoPath, projectType) {
    if (this.features.length === 0 && this.allFeatures.length === 0) {
      throw new Error('No features to export');
    }

    const repoName = repoPath.split('/').pop();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportFile = `${repoName}-features-${timestamp}.log`;

    let exportContent = `Repository: ${repoPath}\n`;
    exportContent += `Project Type: ${projectType}\n`;
    exportContent += `Export Time: ${new Date().toISOString()}\n\n`;

    if (this.allFeatures.length > 0) {
      exportContent += `Individual Feature Summaries:\n`;
      exportContent += `------------------------\n`;
      this.allFeatures.forEach((feature, index) => {
        exportContent += `\nFeature Set ${index + 1}:\n${feature}\n`;
      });
    }

    if (this.features.length > 0) {
      exportContent += `\nConsolidated Features:\n`;
      exportContent += `--------------------\n`;
      exportContent += this.features;
    }

    await fs.writeFile(exportFile, exportContent);
    return exportFile;
  }

  async generateDocumentation(repoPath, filePath) {
    if (this.allFeatures.length === 0) {
      throw new Error('No features to document');
    }

    let content = '';
    if (filePath) {
      try {
        content = await fs.readFile(resolve(repoPath, filePath), 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      this.features = content
        ? await updateDoc(content, this.allFeatures)
        : await summarizeFeatures(this.allFeatures);

      await fs.writeFile(resolve(repoPath, filePath), this.features);
      return { updated: !!content, path: filePath };
    }

    this.features = await summarizeFeatures(this.allFeatures);
    return { features: this.features };
  }

  hasFeatures() {
    return this.features.length > 0 || this.allFeatures.length > 0;
  }

  reset() {
    this.features = '';
    this.allFeatures = [];
  }
}

export const featureService = new FeatureService();
