# Git-to-Text

A command-line tool that analyzes Git repositories and generates human-readable feature lists by processing commit histories using Ollama's AI capabilities. This tool helps developers and project managers understand the evolution of features in their codebase.

## Prerequisites

- Node.js (v14 or higher)
- Git installed on your system
- Ollama running locally with the `llama3.2` model

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd git-to-text
```

2. Install dependencies:
```bash
npm install
```

3. Make sure Ollama is running locally with the required model:
```bash
ollama run llama3.2
```

## Usage

Run the tool by executing:

```bash
node index.js [repository-path]
```

If no repository path is provided, you will be prompted to enter one.

### Available Commands

- `/help` - Show help message with available commands
- `/repo [path]` - Switch to a different repository
- `/features` - Show summarized features extracted from commits
- `/commit [n]` - Create and analyze diffs for every n commits
- `/tag [from]` - Analyze changes between git tags, optionally starting from a specific tag
- `/retry` - Re-run last consolidation (from /commit or /tag)
- `/speak [lang]` - Set language for responses (defaults to English)
- `/export` - Export features to a timestamped log file with repo name
- `/exit` - Exit the program

### Example Session

```bash
> node index.js /path/to/repo
> /commit 5  # Analyze commits in groups of 5
> /retry     # Re-run the commit analysis with same parameters
> /speak Spanish  # Switch output to Spanish
> /tag   # Analyze all tags
> /tag v1.0.0  # Analyze tags starting from v1.0.0
> /retry     # Re-run the tag analysis with same parameters
> /features  # Display extracted features
> /export    # Save features to a timestamped file
```

## Features

- Automatic project type detection
- Git repository analysis
- Commit history processing
- Feature extraction using AI
- Progress visualization
- Repository statistics
- Intelligent feature consolidation
- Error handling and retry mechanisms
- Tag-based analysis for version comparisons
- Multi-language support for responses
- Feature export functionality
  - Saves both individual and consolidated features
  - Includes repository metadata
  - Timestamped files with repo name

## Configuration

The Ollama client can be configured in `services/ollama.js`:

```javascript
export const CONFIG = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'qwen2.5-coder',
  temperature: 0.3,
  retryAttempts: 3,
  retryDelay: 1000,
  maxTokens: 8192,
  language: 'English'  // Default language for responses
};
```

## Project Structure

```
.
├── index.js                 # Main CLI application
├── services/
│   ├── ollama.js           # Ollama API client
│   ├── git-service.js      # Git operations
│   └── project-analyzer.js # Project type detection
└── config/                 # Configuration files
```

## Error Handling

The tool includes robust error handling:
- Automatic retries for Ollama API calls
- Git repository validation
- Input sanitization
- Graceful shutdown handling

## Output

The tool provides:
- Color-coded terminal output
- Progress bars for long-running operations
- Repository statistics
- Consolidated feature lists
- Real-time processing feedback
- Tag-based feature analysis
- Multi-language feature descriptions
- Feature export files with repository context

## License

MIT
