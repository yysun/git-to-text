/**
 * Project type detection and source file validation
 * 
 * Implementation:
 * - Uses file presence checks and extension matching
 * - Hierarchical detection: manifest files -> framework files -> extensions
 * - Caches patterns by project type for performance
 * - Handles unknown project types with fallback patterns
 * 
 * Project types and indicators:
 * - web: package.json + framework files (React, Vue, Angular)
 * - node: package.json without framework indicators
 * - go: .go files or go.mod
 * - dart: .dart files or pubspec.yaml
 * - python: .py, requirements.txt, setup.py
 * - java: .java, pom.xml, build.gradle
 */

export function detectProjectType(files) {
  // Check for package.json for Node/Web projects
  if (files.includes('package.json')) {
    return checkNodeProjectType(files);
  }
  
  // Check for Go projects
  if (files.some(file => file.endsWith('.go')) || files.includes('go.mod')) {
    return 'go';
  }
  
  // Check for Dart/Flutter projects
  if (files.includes('pubspec.yaml') || files.some(file => file.endsWith('.dart'))) {
    return 'dart';
  }
  
  // Check for Python projects
  if (files.includes('requirements.txt') || files.includes('setup.py') || files.some(file => file.endsWith('.py'))) {
    return 'python';
  }
  
  // Check for Java projects
  if (files.includes('pom.xml') || files.includes('build.gradle') || files.some(file => file.endsWith('.java'))) {
    return 'java';
  }
  
  return 'unknown';
}

function checkNodeProjectType(files) {
  // Read package.json to determine if it's a web or node project
  const packageJson = files.includes('package.json');
  if (!packageJson) return 'node';

  // Common web framework/library files
  const webIndicators = [
    'index.html',
    'src/App.js',
    'src/App.vue',
    'src/app.tsx',
    'angular.json',
    'next.config.js',
    'nuxt.config.js',
    'svelte.config.js',
  ];

  if (webIndicators.some(file => files.includes(file))) {
    return 'web';
  }

  return 'node';
}

export function getSourceFilePatterns(projectType) {
  const patterns = {
    web: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.css', '.scss', '.html'],
    node: ['.js', '.jsx', '.ts', '.mjs', '.cjs'],
    go: ['.go'],
    dart: ['.dart'],
    python: ['.py'],
    java: ['.java'],
    unknown: ['.js', '.ts', '.go', '.py', '.java', '.dart', '.cpp', '.c', '.h', '.hpp']
  };

  return patterns[projectType] || patterns.unknown;
}

export function isSourceFile(filePath, projectType) {
  const sourcePatterns = getSourceFilePatterns(projectType);
  return sourcePatterns.some(ext => filePath.toLowerCase().endsWith(ext));
}
