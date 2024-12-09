import { isSourceFile } from './project-analyzer.js';

export function filterSourceFiles(diff, projectType) {
  // Split diff into file sections
  const diffSections = diff.split('diff --git');
  
  // Filter out the empty first element
  const sections = diffSections.filter(Boolean);
  
  // Process each section
  const sourceDiffs = sections
    .map(section => section.trim())
    .filter(section => {
      // Extract file path from the diff section
      const filePathMatch = section.match(/a\/(.+?) b\//);
      if (!filePathMatch) return false;
      
      const filePath = filePathMatch[1];
      return isSourceFile(filePath, projectType);
    });
  
  // Reconstruct the filtered diff
  return sourceDiffs.length > 0
    ? 'diff --git ' + sourceDiffs.join('\ndiff --git ')
    : '';
}
