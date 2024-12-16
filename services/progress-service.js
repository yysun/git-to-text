/**
 * Progress tracking and display service
 * 
 * Implementation:
 * - Creates and updates progress bars
 * - Handles terminal output formatting
 * - Manages progress calculations
 * - Supports different progress styles
 * 
 * Features:
 * - Customizable progress bar width
 * - Multiple progress bar styles
 * - Progress percentage calculation
 * - ETA estimation
 */

import { COLORS } from './cli-service.js';

export class ProgressService {
  constructor(options = {}) {
    this.width = options.width || 30;
    this.startTime = null;
  }

  createBar(total) {
    this.startTime = process.hrtime.bigint();
    return (current) => {
      const percentage = Math.round((current / total) * 100);
      const filled = Math.round((this.width * current) / total);
      const empty = this.width - filled;
      const bar = `${COLORS.GREEN}${'█'.repeat(filled)}${COLORS.RESET}${COLORS.GRAY}${'░'.repeat(empty)}${COLORS.RESET}`;
      
      // Calculate elapsed time and ETA
      const elapsed = this.getElapsedTime();
      const eta = this.calculateETA(elapsed, current, total);
      
      return `${bar} ${percentage}% (${current}/${total}) ETA: ${eta}`;
    };
  }

  getElapsedTime() {
    if (!this.startTime) return 0;
    const elapsed = process.hrtime.bigint() - this.startTime;
    return Number(elapsed) / 1e9;
  }

  calculateETA(elapsed, current, total) {
    if (current === 0) return 'calculating...';
    const rate = elapsed / current;
    const remaining = (total - current) * rate;
    return this.formatTime(remaining);
  }

  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${minutes}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  updateProgress(current, total, message) {
    const progressBar = this.createBar(total);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${message}: ${progressBar(current)}`);
  }

  complete(message) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    const elapsed = this.getElapsedTime();
    console.log(`${COLORS.GREEN}${message} (took ${this.formatTime(elapsed)})${COLORS.RESET}`);
    this.startTime = null;
  }
}

export const progressService = new ProgressService();
