* Overall system structure:
	+ The system is a Git-based tool, specifically for analyzing features and exporting information to logs or other formats.
	+ It has improved command-line interface capabilities and enhanced help messages.
	+ There is also support for streaming feature updates and a new API for generating text prompts with Ollama model responses.
	+ The system now includes project type detection, allowing it to identify the programming language and frameworks used in a project.

* Feature list:
  - Command-line interface improvements
    - Enable/Disable streaming of feature updates
    - Help message enhancements
    - Improved command-line interface for logging
      - Supports exporting features to a log file

  - API integration with Ollama model
    - Generate text prompts and receive responses in real-time
    - Introduced streaming functionality that writes response content directly to stdout while maintaining proper formatting (ANSI escape codes) in real-time

  - Logging capabilities
    - Export features to log files
    - New feature: Supports exporting feature summaries and consolidated features to a single log file
      - Includes repository information, project type, export time, and individual feature summaries

  - Shutdown handling
    - Clean shutdown on receipt of SIGINT signal

  - Project type detection and management
    - **Added project type detection**
      - Introduced a new function `detectProjectType` that takes an array of file paths as input.
      - The function checks for specific files associated with different programming languages (e.g., Node, Go, Dart, Python, Java) and returns the corresponding project type.

    - **Improved project type detection for Node projects**
      - Modified the `checkNodeProjectType` function to also check for common web framework/library files.
      - This allows the function to correctly identify Node projects that are not just pure JavaScript projects.

    - **Added file extension patterns for source file selection**
      - Introduced a new function `getSourceFilePatterns` that takes a project type as input and returns an array of file extensions associated with that project type.
      - The function uses a mapping data structure to associate project types with their corresponding file extensions.