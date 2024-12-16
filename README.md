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
- `/commit [n]` - Create and analyze diffs for every n commits
- `/tag [from]` - Analyze changes between git tags, optionally starting from a specific tag
- `/speak [lang]` - Set language for responses (defaults to English)
- `/export` - Export features to a timestamped log file with repo name
- `/stream [on|off]` - Toggle response streaming (default: on)
- `/doc [file]` - Summarize features to a file (optional)
- `/exit` - Exit the program

### Example Session

```bash
> node index.js /path/to/repo
> /commit 5  # Analyze commits in groups of 5
> /speak Spanish  # Switch output to Spanish
> /tag   # Analyze all tags
> /tag v1.0.0  # Analyze tags starting from v1.0.0
> /doc features.md  # Save features to a file
> /export    # Save features to a timestamped file
```

## Features

- Modular Architecture
  - Service-based design for better maintainability
  - Clear separation of concerns
  - Extensible command handling
  - Reusable components

- Repository Analysis
  - Automatic project type detection
  - Comprehensive repository statistics
  - Git operations abstraction
  - Efficient diff processing

- Feature Processing
  - AI-powered feature extraction
  - Intelligent consolidation
  - Multi-language support
  - Documentation generation

- Progress Tracking
  - Real-time progress bars
  - ETA calculations
  - Operation timing
  - Visual feedback

- Error Handling
  - Consistent error management
  - Automatic retries
  - Graceful failure recovery
  - User-friendly messages

## Project Structure

```
.
├── index.js                    # Main CLI application
├── services/
│   ├── cli-service.js         # Command handling and user interaction
│   ├── repo-service.js        # Repository analysis and state management
│   ├── feature-service.js     # Feature processing and consolidation
│   ├── progress-service.js    # Progress tracking and display
│   ├── git-analyzer.js        # LLM-based diff analysis
│   ├── git-service.js         # Git operations wrapper
│   ├── project-analyzer.js    # Project type detection
│   └── ollama.js             # Ollama API client
└── config/                    # Configuration files
```

## Configuration

The Ollama client can be configured in `services/ollama.js`:

```javascript
export const CONFIG = {
  endpoint: 'http://localhost:11434/',
  model: 'llama3.2:3b',
  temperature: 0.3,
  retryAttempts: 3,
  retryDelay: 1000,
  maxTokens: 4096,
  language: 'English',  // Default language for responses
  streaming: true      // Enable/disable streaming output
};
```

## Services

### CLI Service
- Command parsing and validation
- User input handling
- Output formatting
- Interactive prompts

### Repository Service
- Repository state management
- Git operations handling
- Project analysis
- Statistics tracking

### Feature Service
- Feature extraction
- Consolidation logic
- Documentation generation
- Export functionality

### Progress Service
- Progress bar generation
- ETA calculations
- Operation timing
- Visual feedback

## Output

The tool provides:
- Color-coded terminal output
- Dynamic progress tracking
- Repository statistics
- Consolidated feature lists
- Real-time processing feedback
- Tag-based feature analysis
- Multi-language feature descriptions
- Feature export files with repository context

## Error Handling

The tool includes robust error handling:
- Service-level error management
- Automatic retries for API calls
- Input validation
- State consistency checks
- Graceful shutdown handling
- User-friendly error messages

## License

MIT
