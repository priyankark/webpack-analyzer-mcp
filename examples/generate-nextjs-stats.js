#!/usr/bin/env node

/**
 * This script demonstrates how to generate a webpack stats file
 * from a Next.js project that can be used with the webpack-analyzer-mcp server.
 * 
 * Usage:
 * node generate-nextjs-stats.js [nextjs-project-dir] [output-path]
 * 
 * Example:
 * node generate-nextjs-stats.js ./my-nextjs-app ./stats.json
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get command line arguments
const args = process.argv.slice(2);
const projectDir = args[0] || '.';
const outputPath = args[1] || './stats.json';

console.log(`Generating webpack stats file from Next.js project...`);
console.log(`Project directory: ${projectDir}`);
console.log(`Output path: ${outputPath}`);

try {
  // Check if Next.js project exists
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.error(`Error: package.json not found in ${projectDir}`);
    process.exit(1);
  }

  // Check if it's a Next.js project
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  if (!packageJson.dependencies?.next && !packageJson.devDependencies?.next) {
    console.error(`Error: The specified directory does not appear to be a Next.js project.`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create a temporary Next.js config that includes the analyzer plugin
  const tempConfigPath = path.join(outputDir, 'next.analyzer.config.js');
  const isESM = packageJson.type === 'module';
  
  // Check if next.config.js exists
  const nextConfigPath = path.join(projectDir, 'next.config.js');
  const nextConfigMjsPath = path.join(projectDir, 'next.config.mjs');
  
  let hasNextConfig = false;
  let configPath = null;
  
  if (fs.existsSync(nextConfigPath)) {
    hasNextConfig = true;
    configPath = nextConfigPath;
  } else if (fs.existsSync(nextConfigMjsPath)) {
    hasNextConfig = true;
    configPath = nextConfigMjsPath;
    isESM = true;
  }

  let analyzerConfig;
  
  if (isESM) {
    // ES Modules version
    analyzerConfig = `
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
${hasNextConfig ? `import baseConfig from '${configPath}';` : ''}

/** @type {import('next').NextConfig} */
const nextConfig = ${hasNextConfig ? 'baseConfig' : '{}'};

export default {
  ...nextConfig,
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Use the existing webpack config function if it exists
    let updatedConfig = config;
    if (typeof nextConfig.webpack === 'function') {
      updatedConfig = nextConfig.webpack(config, { buildId, dev, isServer, defaultLoaders, webpack });
    }
    
    // Only add analyzer plugin to the client-side bundle
    if (!isServer) {
      updatedConfig.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'disabled',
          generateStatsFile: true,
          statsFilename: '${outputPath.replace(/\\/g, '\\\\')}',
          statsOptions: {
            all: true,
            modules: true,
            maxModules: Infinity,
            chunks: true,
            reasons: true,
            cached: true,
            cachedAssets: true,
            source: true,
            errorDetails: true,
            chunkOrigins: true,
            performance: true,
            timings: true,
          },
        })
      );
    }
    
    return updatedConfig;
  },
};
    `;
  } else {
    // CommonJS version
    analyzerConfig = `
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
${hasNextConfig ? `const baseConfig = require('${configPath}');` : ''}

/** @type {import('next').NextConfig} */
const nextConfig = ${hasNextConfig ? 'baseConfig' : '{}'};

module.exports = {
  ...nextConfig,
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Use the existing webpack config function if it exists
    let updatedConfig = config;
    if (typeof nextConfig.webpack === 'function') {
      updatedConfig = nextConfig.webpack(config, { buildId, dev, isServer, defaultLoaders, webpack });
    }
    
    // Only add analyzer plugin to the client-side bundle
    if (!isServer) {
      updatedConfig.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'disabled',
          generateStatsFile: true,
          statsFilename: '${outputPath.replace(/\\/g, '\\\\')}',
          statsOptions: {
            all: true,
            modules: true,
            maxModules: Infinity,
            chunks: true,
            reasons: true,
            cached: true,
            cachedAssets: true,
            source: true,
            errorDetails: true,
            chunkOrigins: true,
            performance: true,
            timings: true,
          },
        })
      );
    }
    
    return updatedConfig;
  },
};
    `;
  }
  
  fs.writeFileSync(tempConfigPath, analyzerConfig, 'utf-8');
  
  // Install webpack-bundle-analyzer if not already installed
  console.log(`Ensuring webpack-bundle-analyzer is installed...`);
  execSync(`cd ${projectDir} && npm install --save-dev webpack-bundle-analyzer`, {
    stdio: 'inherit',
  });
  
  // Run Next.js build with the temporary config
  console.log(`Building Next.js project with stats generation...`);
  execSync(`cd ${projectDir} && NEXT_CONFIG_FILE=${tempConfigPath} npx next build`, {
    stdio: 'inherit',
  });
  
  // Check if stats file was generated
  if (fs.existsSync(outputPath)) {
    console.log(`Stats file generated successfully at ${outputPath}`);
    console.log(`\nYou can now analyze this file with webpack-analyzer-mcp:`);
    console.log(`npx webpack-analyzer-mcp`);
    console.log(`\nThen use the analyze_webpack_stats tool with the following parameters:`);
    console.log(JSON.stringify({ statsFile: outputPath }, null, 2));
  } else {
    console.error(`Error: Stats file was not generated at ${outputPath}`);
    process.exit(1);
  }
  
  // Clean up temporary config file
  fs.unlinkSync(tempConfigPath);
  
} catch (error) {
  console.error(`Error generating stats file:`, error.message);
  process.exit(1);
}
