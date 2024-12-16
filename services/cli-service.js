/**
 * CLI interface and command handling service
 * 
 * Implementation:
 * - Handles user input and command parsing
 * - Manages command validation and execution
 * - Provides consistent output formatting
 * - Implements interactive prompts
 * 
 * Commands:
 * - /help: Show help message
 * - /repo: Switch repositories
 * - /commit: Analyze commit diffs
 * - /tag: Analyze tag diffs
 * - /speak: Set language
 * - /stream: Toggle streaming
 * - /export: Export features
 * - /doc: Generate documentation
 */

import readline from 'readline';

// ANSI escape codes
export const COLORS = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m'
};

export const HELP_MESSAGE = `
${COLORS.BOLD}Available Commands:${COLORS.RESET}
  ${COLORS.WHITE}/help${COLORS.RESET}              - Show this help message
  ${COLORS.WHITE}/repo${COLORS.RESET} [path]       - Switch repositories
  ${COLORS.WHITE}/commit${COLORS.RESET} [n]        - Create and analyze diffs for every n commits
  ${COLORS.WHITE}/tag${COLORS.RESET} [from]        - Analyze changes between git tags, optionally starting from a specific tag
  ${COLORS.WHITE}/speak${COLORS.RESET} [lang]      - Set language for responses (default: English)
  ${COLORS.WHITE}/stream${COLORS.RESET} [on|off]   - Toggle response streaming (default: on)
  ${COLORS.WHITE}/export${COLORS.RESET}            - Export features to a timestamped log file
  ${COLORS.WHITE}/doc${COLORS.RESET} [file]        - Summarize features to a file (optional)
  ${COLORS.WHITE}/exit${COLORS.RESET}              - Exit the program
`;

export async function promptForInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function formatOutput(type, message) {
  const colors = {
    error: COLORS.RED,
    success: COLORS.GREEN,
    warning: COLORS.YELLOW,
    info: COLORS.WHITE,
    dim: COLORS.DIM
  };

  return `${colors[type] || ''}${message}${COLORS.RESET}`;
}

export function displayError(message) {
  console.error(formatOutput('error', `Error: ${message}`));
}

export function displaySuccess(message) {
  console.log(formatOutput('success', message));
}

export function displayWarning(message) {
  console.log(formatOutput('warning', message));
}

export function displayInfo(message) {
  console.log(formatOutput('info', message));
}
