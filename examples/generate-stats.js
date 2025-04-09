#!/usr/bin/env node

/**
 * This script demonstrates how to generate a webpack stats file
 * that can be used with the webpack-analyzer-mcp server.
 * 
 * Usage:
 * node generate-stats.js [webpack-config-path] [output-path]
 * 
 * Example:
 * node generate-stats.js ./webpack.config.js ./stats.json
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get command line arguments
const args = process.argv.slice(2);
const configPath = args[0] || './webpack.config.js';
const outputPath = args[1] || './stats.json';

console.log(`Generating webpack stats file...`);
console.log(`Config path: ${configPath}`);
console.log(`Output path: ${outputPath}`);

try {
  // Check if webpack config exists
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Webpack config not found at ${configPath}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Run webpack with stats option
  console.log(`Running webpack with --json flag...`);
  const stats = execSync(`npx webpack --config ${configPath} --json`, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large projects
  });

  // Write stats to file
  fs.writeFileSync(outputPath, stats);
  console.log(`Stats file generated successfully at ${outputPath}`);
  console.log(`\nYou can now analyze this file with webpack-analyzer-mcp:`);
  console.log(`npx webpack-analyzer-mcp`);
  console.log(`\nThen use the analyze_webpack_stats tool with the following parameters:`);
  console.log(JSON.stringify({ statsFile: outputPath }, null, 2));

} catch (error) {
  console.error(`Error generating stats file:`, error.message);
  process.exit(1);
}
