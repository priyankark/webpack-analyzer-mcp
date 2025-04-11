#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import webpack from 'webpack';
import tmp from 'tmp-promise';

const execAsync = promisify(exec);

// Utility function to resolve file/directory paths
async function resolvePath(inputPath: string, type: 'file' | 'directory' = 'file'): Promise<string> {
  // If path is absolute, use it directly
  if (path.isAbsolute(inputPath)) {
    try {
      await fs.access(inputPath);
      const stats = await fs.stat(inputPath);
      if ((type === 'file' && stats.isFile()) || (type === 'directory' && stats.isDirectory())) {
        return inputPath;
      }
      throw new Error(`Path ${inputPath} exists but is not a ${type}`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Cannot access ${type} at absolute path: ${inputPath}`);
      }
      throw error;
    }
  }

  // Try workspace root first
  const workspacePath = path.resolve(process.cwd(), inputPath);
  try {
    await fs.access(workspacePath);
    const stats = await fs.stat(workspacePath);
    if ((type === 'file' && stats.isFile()) || (type === 'directory' && stats.isDirectory())) {
      return workspacePath;
    }
  } catch (error) {
    // Fall through to project directory
  }

  // Try project directory
  const projectPath = path.resolve(os.homedir(), 'Desktop/webpack-analyzer-mcp', inputPath);
  try {
    await fs.access(projectPath);
    const stats = await fs.stat(projectPath);
    if ((type === 'file' && stats.isFile()) || (type === 'directory' && stats.isDirectory())) {
      return projectPath;
    }
  } catch (error) {
    throw new Error(
      `Cannot find ${type} at either:\n` +
      `1. Workspace: ${workspacePath}\n` +
      `2. Project: ${projectPath}\n` +
      `Please provide a valid path relative to one of these locations or an absolute path.`
    );
  }

  throw new Error(`Path ${inputPath} exists but is not a ${type}`);
}

// Add helper method to validate paths
async function validatePath(path: string, type: 'file' | 'directory'): Promise<{
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}> {
  try {
    const resolvedPath = await resolvePath(path, type);
    return {
      valid: true,
      resolvedPath
    };
  } catch (error) {
    return {
      valid: false,
      error: (error as Error).message
    };
  }
}

interface AnalyzeWebpackBuildArgs {
  statsFile: string;
  outputDir?: string;
  port?: number;
  openBrowser?: boolean;
  generateReport?: boolean;
  includeRawStats?: boolean;
}

interface AnalyzeWebpackConfigArgs {
  configPath: string;
  outputDir?: string;
  port?: number;
  openBrowser?: boolean;
  generateReport?: boolean;
  includeRawStats?: boolean;
}

interface AnalyzeNextjsBuildArgs {
  projectDir: string;
  outputDir?: string;
  port?: number;
  openBrowser?: boolean;
  generateReport?: boolean;
  includeRawStats?: boolean;
}

const isValidAnalyzeWebpackBuildArgs = (args: any): args is AnalyzeWebpackBuildArgs => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.statsFile === 'string' &&
    (args.outputDir === undefined || typeof args.outputDir === 'string') &&
    (args.port === undefined || typeof args.port === 'number') &&
    (args.openBrowser === undefined || typeof args.openBrowser === 'boolean') &&
    (args.generateReport === undefined || typeof args.generateReport === 'boolean') &&
    (args.includeRawStats === undefined || typeof args.includeRawStats === 'boolean')
  );
};

const isValidAnalyzeWebpackConfigArgs = (args: any): args is AnalyzeWebpackConfigArgs => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.configPath === 'string' &&
    (args.outputDir === undefined || typeof args.outputDir === 'string') &&
    (args.port === undefined || typeof args.port === 'number') &&
    (args.openBrowser === undefined || typeof args.openBrowser === 'boolean') &&
    (args.generateReport === undefined || typeof args.generateReport === 'boolean') &&
    (args.includeRawStats === undefined || typeof args.includeRawStats === 'boolean')
  );
};

const isValidAnalyzeNextjsBuildArgs = (args: any): args is AnalyzeNextjsBuildArgs => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.projectDir === 'string' &&
    (args.outputDir === undefined || typeof args.outputDir === 'string') &&
    (args.port === undefined || typeof args.port === 'number') &&
    (args.openBrowser === undefined || typeof args.openBrowser === 'boolean') &&
    (args.generateReport === undefined || typeof args.generateReport === 'boolean') &&
    (args.includeRawStats === undefined || typeof args.includeRawStats === 'boolean')
  );
};

class WebpackAnalyzerServer {
  private server: Server;
  private runningProcesses: Set<any> = new Set();

  constructor() {
    this.server = new Server(
      {
        name: 'webpack-analyzer-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    
    // Graceful cleanup of processes and resources
    const cleanup = async () => {
      console.error('Shutting down...');
      // Kill any running processes
      for (const process of this.runningProcesses) {
        try {
          if (process && typeof process.kill === 'function') {
            process.kill();
          }
        } catch (error) {
          console.error('Error killing process:', error);
        }
      }
      
      // Close the server
      try {
        await this.server.close();
      } catch (error) {
        console.error('Error closing server:', error);
      }
      
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'analyze_webpack_stats',
          description: 'Analyze a webpack stats JSON file and generate a report',
          inputSchema: {
            type: 'object',
            properties: {
              statsFile: {
                type: 'string',
                description: 'Path to the webpack stats JSON file. Can be:\n' +
                  '1. Absolute path (e.g. /Users/name/project/stats.json)\n' +
                  '2. Path relative to workspace (e.g. build/stats.json)\n' +
                  '3. Path relative to project (e.g. ./stats.json)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to output the report. Can be absolute or relative path. Defaults to stats file directory.',
              },
              port: {
                type: 'number',
                description: 'Port to run the analyzer server on (defaults to 8888)',
              },
              openBrowser: {
                type: 'boolean',
                description: 'Whether to open the browser automatically (defaults to true)',
              },
              generateReport: {
                type: 'boolean',
                description: 'Whether to generate a static HTML report (defaults to true)',
              },
              includeRawStats: {
                type: 'boolean',
                description: 'Whether to include the raw stats in the response',
              },
            },
            required: ['statsFile'],
          },
        },
        {
          name: 'analyze_webpack_config',
          description: 'Analyze a webpack configuration by building the project and generating a report',
          inputSchema: {
            type: 'object',
            properties: {
              configPath: {
                type: 'string',
                description: 'Path to the webpack configuration file. Can be:\n' +
                  '1. Absolute path (e.g. /Users/name/project/webpack.config.js)\n' +
                  '2. Path relative to workspace (e.g. config/webpack.config.js)\n' +
                  '3. Path relative to project (e.g. ./webpack.config.js)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to output the report. Can be absolute or relative path. Defaults to project directory.',
              },
              port: {
                type: 'number',
                description: 'Port to run the analyzer server on (defaults to 8888)',
              },
              openBrowser: {
                type: 'boolean',
                description: 'Whether to open the browser automatically (defaults to true)',
              },
              generateReport: {
                type: 'boolean',
                description: 'Whether to generate a static HTML report (defaults to true)',
              },
              includeRawStats: {
                type: 'boolean',
                description: 'Whether to include the raw stats in the response',
              },
            },
            required: ['configPath'],
          },
        },
        {
          name: 'analyze_nextjs_build',
          description: 'Analyze a Next.js project by building it and generating a report',
          inputSchema: {
            type: 'object',
            properties: {
              projectDir: {
                type: 'string',
                description: 'Path to the Next.js project directory. Can be:\n' +
                  '1. Absolute path (e.g. /Users/name/project)\n' +
                  '2. Path relative to workspace (e.g. my-nextjs-app)\n' +
                  '3. Path relative to project (e.g. ./my-nextjs-app)',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to output the report. Can be absolute or relative path. Defaults to project directory.',
              },
              port: {
                type: 'number',
                description: 'Port to run the analyzer server on (defaults to 8888)',
              },
              openBrowser: {
                type: 'boolean',
                description: 'Whether to open the browser automatically (defaults to true)',
              },
              generateReport: {
                type: 'boolean',
                description: 'Whether to generate a static HTML report (defaults to true)',
              },
              includeRawStats: {
                type: 'boolean',
                description: 'Whether to include the raw stats in the response',
              },
            },
            required: ['projectDir'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'analyze_webpack_stats':
          if (!isValidAnalyzeWebpackBuildArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_webpack_stats'
            );
          }
          return this.analyzeWebpackStats(request.params.arguments);

        case 'analyze_webpack_config':
          if (!isValidAnalyzeWebpackConfigArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_webpack_config'
            );
          }
          return this.analyzeWebpackConfig(request.params.arguments);
          
        case 'analyze_nextjs_build':
          if (!isValidAnalyzeNextjsBuildArgs(request.params.arguments)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid arguments for analyze_nextjs_build'
            );
          }
          return this.analyzeNextjsBuild(request.params.arguments);

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async analyzeWebpackStats(args: AnalyzeWebpackBuildArgs) {
    try {
      // Validate file extension
      if (!args.statsFile.endsWith('.json')) {
        throw new Error('Stats file must have .json extension');
      }

      // Validate stats file path
      const statsFileValidation = await validatePath(args.statsFile, 'file');
      if (!statsFileValidation.valid) {
        throw new Error(
          `Invalid stats file path: ${args.statsFile}\n` +
          'Please provide either:\n' +
          '1. Absolute path (e.g. /Users/name/project/stats.json)\n' +
          '2. Path relative to workspace (e.g. build/stats.json)\n' +
          '3. Path relative to project (e.g. ./stats.json)\n\n' +
          `Error: ${statsFileValidation.error}`
        );
      }
      const statsFilePath = statsFileValidation.resolvedPath!;
      console.error(`Using stats file at: ${statsFilePath}`);

      // Validate output directory if provided
      let outputDir = path.dirname(statsFilePath);
      if (args.outputDir) {
        const outputDirValidation = await validatePath(args.outputDir, 'directory');
        if (!outputDirValidation.valid) {
          throw new Error(
            `Invalid output directory path: ${args.outputDir}\n` +
            'Please provide either:\n' +
            '1. Absolute path (e.g. /Users/name/project/reports)\n' +
            '2. Path relative to workspace (e.g. reports)\n' +
            '3. Path relative to project (e.g. ./reports)\n\n' +
            `Error: ${outputDirValidation.error}`
          );
        }
        outputDir = outputDirValidation.resolvedPath!;
      }
      
      // Read stats file
      const statsContent = await fs.readFile(statsFilePath, 'utf-8');
      let stats;
      
      try {
        stats = JSON.parse(statsContent);
      } catch (error) {
        throw new Error(`Failed to parse stats file: ${(error as Error).message}. Make sure it's a valid JSON file.`);
      }
      
      const port = args.port || 8888;
      const openBrowser = args.openBrowser !== false;
      const generateReport = args.generateReport !== false;
      
      // Use the BundleAnalyzerPlugin in a simplified way
      const reportPath = path.join(outputDir, 'report.html');
      
      if (generateReport) {
        // For static report generation, we'll use the BundleAnalyzerPlugin's ability to process stats
        // without a full webpack build
        const tempDir = path.join(outputDir, 'temp-analyzer');
        await fs.mkdir(tempDir, { recursive: true });
        
        // Write stats to file for the plugin to use
        const tempStatsPath = path.join(tempDir, 'stats.json');
        await fs.writeFile(tempStatsPath, JSON.stringify(stats), 'utf-8');
        
        // Run webpack-bundle-analyzer CLI to generate static report
        const analyzerPath = require.resolve('webpack-bundle-analyzer/lib/bin/analyzer.js');
        await execAsync(`node "${analyzerPath}" "${tempStatsPath}" -m static -r "${reportPath}" -O`);
        
        // Clean up temp dir
        await fs.rm(tempDir, { recursive: true, force: true });
      } else {
        // For server mode, launch the analyzer directly via CLI
        const analyzerPath = require.resolve('webpack-bundle-analyzer/lib/bin/analyzer.js');
        
        // Write stats to a temporary file
        const tempDir = path.join(outputDir, 'temp-analyzer');
        await fs.mkdir(tempDir, { recursive: true });
        const tempStatsPath = path.join(tempDir, 'stats.json');
        await fs.writeFile(tempStatsPath, JSON.stringify(stats), 'utf-8');
        
        // Start analyzer server
        const process = exec(`node "${analyzerPath}" "${tempStatsPath}" -m server -p ${port} ${openBrowser ? '-O' : ''}`);
        
        // Add to running processes set for cleanup
        this.runningProcesses.add(process);
      }
      
      // Extract metrics from the stats
      const metrics = this.extractMetrics(stats);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Webpack stats analyzed successfully.${
                generateReport ? ` Report generated at ${path.join(outputDir, 'report.html')}` : ''
              }${
                !generateReport ? ` Analyzer server running at http://localhost:${port}` : ''
              }`,
              reportPath: generateReport ? path.join(outputDir, 'report.html') : null,
              serverUrl: !generateReport ? `http://localhost:${port}` : null,
              metrics: metrics,
              rawStats: args.includeRawStats ? stats : undefined, 
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Error analyzing webpack stats: ${(error as Error).message}`,
              error: (error as Error).stack,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async analyzeWebpackConfig(args: AnalyzeWebpackConfigArgs) {
    try {
      // Validate config file path
      const configValidation = await validatePath(args.configPath, 'file');
      if (!configValidation.valid) {
        throw new Error(
          `Invalid webpack config path: ${args.configPath}\n` +
          'Please provide either:\n' +
          '1. Absolute path (e.g. /Users/name/project/webpack.config.js)\n' +
          '2. Path relative to workspace (e.g. config/webpack.config.js)\n' +
          '3. Path relative to project (e.g. ./webpack.config.js)\n\n' +
          `Error: ${configValidation.error}`
        );
      }
      const configPath = configValidation.resolvedPath!;
      console.error(`Using config file at: ${configPath}`);

      // Validate output directory if provided
      let outputDir = path.dirname(configPath);
      if (args.outputDir) {
        const outputDirValidation = await validatePath(args.outputDir, 'directory');
        if (!outputDirValidation.valid) {
          throw new Error(
            `Invalid output directory path: ${args.outputDir}\n` +
            'Please provide either:\n' +
            '1. Absolute path (e.g. /Users/name/project/reports)\n' +
            '2. Path relative to workspace (e.g. reports)\n' +
            '3. Path relative to project (e.g. ./reports)\n\n' +
            `Error: ${outputDirValidation.error}`
          );
        }
        outputDir = outputDirValidation.resolvedPath!;
      }
      
      // Set default values
      const port = args.port || 8888;
      const openBrowser = args.openBrowser !== false;
      const generateReport = args.generateReport !== false;
      
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });
      
      // Determine if the config file is using ES modules or CommonJS
      const configContent = await fs.readFile(configPath, 'utf-8');
      const isESM = configContent.includes('export default') || 
                    configContent.includes('export =') ||
                    configContent.includes('export const') ||
                    configContent.includes('export function');
      
      // Create a temporary webpack config that includes the analyzer plugin
      const tempConfigPath = path.join(outputDir, 'webpack.analyzer.config.js');
      
      let analyzerConfig;
      
      if (isESM) {
        // ES Modules version
        analyzerConfig = `
import path from 'path';
import { fileURLToPath } from 'url';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import baseConfig from '${configPath}';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Handle both object and function configurations
let resolvedConfig = typeof baseConfig === 'function' 
  ? baseConfig({}, { mode: 'production' })
  : baseConfig;

// Ensure plugins array exists
if (!resolvedConfig.plugins) {
  resolvedConfig.plugins = [];
}

// Add the analyzer plugin
resolvedConfig.plugins.push(
  new BundleAnalyzerPlugin({
    analyzerMode: ${generateReport ? "'static'" : "'server'"},
    analyzerPort: ${port},
    reportFilename: path.join(__dirname, 'report.html'),
    openAnalyzer: ${openBrowser},
    generateStatsFile: true,
    statsFilename: path.join(__dirname, 'stats.json'),
    logLevel: 'info',
  })
);

export default resolvedConfig;
        `;
      } else {
        // CommonJS version
        analyzerConfig = `
const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const baseConfig = require('${configPath}');

// Handle both object and function configurations
let resolvedConfig = typeof baseConfig === 'function'
  ? baseConfig({}, { mode: 'production' })
  : baseConfig;

// Ensure plugins array exists
if (!resolvedConfig.plugins) {
  resolvedConfig.plugins = [];
}

// Add the analyzer plugin
resolvedConfig.plugins.push(
  new BundleAnalyzerPlugin({
    analyzerMode: ${generateReport ? "'static'" : "'server'"},
    analyzerPort: ${port},
    reportFilename: path.join(__dirname, 'report.html'),
    openAnalyzer: ${openBrowser},
    generateStatsFile: true,
    statsFilename: path.join(__dirname, 'stats.json'),
    logLevel: 'info',
  })
);

module.exports = resolvedConfig;
        `;
      }
      
      await fs.writeFile(tempConfigPath, analyzerConfig, 'utf-8');
      
      // Run webpack with the temporary config
      const { stdout, stderr } = await execAsync(`npx webpack --config ${tempConfigPath}`);
      
      // Try to read the generated stats file
      let metrics = null;
      let rawStats = null;
      const statsFilePath = path.join(outputDir, 'stats.json');
      if (existsSync(statsFilePath)) {
        try {
          const statsContent = await fs.readFile(statsFilePath, 'utf-8');
          const stats = JSON.parse(statsContent);
          metrics = this.extractMetrics(stats);
          rawStats = args.includeRawStats ? stats : undefined;
        } catch (error) {
          console.error('Error reading stats file:', error);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Webpack build analyzed successfully.${
                generateReport ? ` Report generated at ${path.join(outputDir, 'report.html')}` : ''
              }${
                !generateReport ? ` Analyzer server running at http://localhost:${port}` : ''
              }`,
              reportPath: generateReport ? path.join(outputDir, 'report.html') : null,
              serverUrl: !generateReport ? `http://localhost:${port}` : null,
              metrics: metrics,
              rawStats: rawStats,
              stdout,
              stderr,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Error analyzing webpack config: ${(error as Error).message}`,
              error: (error as Error).stack,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async analyzeNextjsBuild(args: AnalyzeNextjsBuildArgs) {
    try {
      // Validate project directory path
      const projectDirValidation = await validatePath(args.projectDir, 'directory');
      if (!projectDirValidation.valid) {
        throw new Error(
          `Invalid Next.js project directory path: ${args.projectDir}\n` +
          'Please provide either:\n' +
          '1. Absolute path (e.g. /Users/name/project)\n' +
          '2. Path relative to workspace (e.g. my-nextjs-app)\n' +
          '3. Path relative to project (e.g. ./my-nextjs-app)\n\n' +
          `Error: ${projectDirValidation.error}`
        );
      }
      const projectDir = projectDirValidation.resolvedPath!;
      console.error(`Using project directory at: ${projectDir}`);
      
      // Check if it's a Next.js project
      const packageJsonPath = path.join(projectDir, 'package.json');
      const nextConfigPath = path.join(projectDir, 'next.config.js');
      const nextConfigMjsPath = path.join(projectDir, 'next.config.mjs');
      
      let isNextProject = false;
      let hasNextConfig = false;
      let isESM = false;
      
      // Check if package.json exists and contains Next.js dependency
      if (existsSync(packageJsonPath)) {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        isNextProject = !!(packageJson.dependencies?.next || packageJson.devDependencies?.next);
        
        // Check if the project uses ESM
        isESM = packageJson.type === 'module';
      }
      
      // Check if next.config.js exists
      if (existsSync(nextConfigPath)) {
        hasNextConfig = true;
      } else if (existsSync(nextConfigMjsPath)) {
        hasNextConfig = true;
        isESM = true;
      }
      
      if (!isNextProject) {
        throw new Error('The specified directory does not appear to be a Next.js project. Make sure it has Next.js as a dependency in package.json.');
      }
      
      // Validate output directory if provided
      let outputDir = projectDir;
      if (args.outputDir) {
        const outputDirValidation = await validatePath(args.outputDir, 'directory');
        if (!outputDirValidation.valid) {
          throw new Error(
            `Invalid output directory path: ${args.outputDir}\n` +
            'Please provide either:\n' +
            '1. Absolute path (e.g. /Users/name/project/reports)\n' +
            '2. Path relative to workspace (e.g. reports)\n' +
            '3. Path relative to project (e.g. ./reports)\n\n' +
            `Error: ${outputDirValidation.error}`
          );
        }
        outputDir = outputDirValidation.resolvedPath!;
      }
      
      const port = args.port || 8888;
      const openBrowser = args.openBrowser !== false;
      const generateReport = args.generateReport !== false;
      
      // Create a temporary Next.js config file
      const tempConfigName = isESM ? 'next.analyzer.config.mjs' : 'next.analyzer.config.js';
      const tempConfigPath = path.join(outputDir, tempConfigName);
      
      let analyzerConfig;
      const configImportPath = hasNextConfig ? (isESM ? nextConfigMjsPath : nextConfigPath) : null;
      
      if (isESM) {
        // ES Modules version
        analyzerConfig = `
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
${configImportPath ? `import baseConfig from '${configImportPath}';` : ''}

/** @type {import('next').NextConfig} */
const nextConfig = ${configImportPath ? 'baseConfig' : '{}'};

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
          analyzerMode: ${generateReport ? "'static'" : "'server'"},
          analyzerPort: ${port},
          reportFilename: '${path.join(outputDir, 'report.html').replace(/\\/g, '\\\\')}',
          openAnalyzer: ${openBrowser},
          generateStatsFile: true,
          statsFilename: '${path.join(outputDir, 'stats.json').replace(/\\/g, '\\\\')}',
          logLevel: 'info',
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
${configImportPath ? `const baseConfig = require('${configImportPath}');` : ''}

/** @type {import('next').NextConfig} */
const nextConfig = ${configImportPath ? 'baseConfig' : '{}'};

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
          analyzerMode: ${generateReport ? "'static'" : "'server'"},
          analyzerPort: ${port},
          reportFilename: '${path.join(outputDir, 'report.html').replace(/\\/g, '\\\\')}',
          openAnalyzer: ${openBrowser},
          generateStatsFile: true,
          statsFilename: '${path.join(outputDir, 'stats.json').replace(/\\/g, '\\\\')}',
          logLevel: 'info',
        })
      );
    }
    
    return updatedConfig;
  },
};
        `;
      }
      
      await fs.writeFile(tempConfigPath, analyzerConfig, 'utf-8');
      
      // Create a custom script to run Next.js build with our custom config
      const buildScriptPath = path.join(outputDir, 'run-next-build.js');
      const buildScript = `
#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

// Run Next.js build with our custom config
const nextBuild = spawn('npx', ['next', 'build'], {
  cwd: '${projectDir.replace(/\\/g, '\\\\')}',
  env: {
    ...process.env,
    NEXT_CONFIG_FILE: '${tempConfigPath.replace(/\\/g, '\\\\')}'
  },
  stdio: 'inherit'
});

nextBuild.on('error', (err) => {
  console.error('Failed to start Next.js build:', err);
  process.exit(1);
});

nextBuild.on('close', (code) => {
  if (code !== 0) {
    console.error('Next.js build failed with code:', code);
    process.exit(code);
  }
  console.log('Next.js build completed successfully');
});
      `;
      
      await fs.writeFile(buildScriptPath, buildScript, 'utf-8');
      await fs.chmod(buildScriptPath, 0o755);
      
      // Run the Next.js build with our custom configuration
      const { stdout, stderr } = await execAsync(`node ${buildScriptPath}`);
      
      // Try to read the generated stats file
      let metrics = null;
      let rawStats = null;
      const statsFilePath = path.join(outputDir, 'stats.json');
      if (existsSync(statsFilePath)) {
        try {
          const statsContent = await fs.readFile(statsFilePath, 'utf-8');
          const stats = JSON.parse(statsContent);
          metrics = this.extractMetrics(stats);
          rawStats = args.includeRawStats ? stats : undefined;
        } catch (error) {
          console.error('Error reading stats file:', error);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Next.js build analyzed successfully.${
                generateReport ? ` Report generated at ${path.join(outputDir, 'report.html')}` : ''
              }${
                !generateReport ? ` Analyzer server running at http://localhost:${port}` : ''
              }`,
              reportPath: generateReport ? path.join(outputDir, 'report.html') : null,
              serverUrl: !generateReport ? `http://localhost:${port}` : null,
              metrics: metrics,
              rawStats: rawStats,
              stdout,
              stderr,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Error analyzing Next.js build: ${(error as Error).message}`,
              error: (error as Error).stack,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  // Extract useful metrics from webpack stats
  private extractMetrics(stats: any) {
    try {
      // Initialize metrics object
      const metrics = {
        totalSize: 0,
        totalSizeByType: {} as Record<string, number>,
        entrypoints: {} as Record<string, { size: number, chunks: string[] }>,
        largestModules: [] as Array<{ name: string, size: number, type: string }>,
        largestChunks: [] as Array<{ id: string, name: string, size: number, modules: number }>,
        moduleCount: 0,
        chunkCount: 0,
        assetCount: 0,
        buildTime: stats.time || 0,
        performance: {
          initialLoad: 0, // Estimated initial load time
          cacheEfficiency: 0, // Estimated cache efficiency percentage
          chunkFragmentation: 0, // Measure of chunk fragmentation
        },
      };

      // Process assets
      if (stats.assets && Array.isArray(stats.assets)) {
        metrics.assetCount = stats.assets.length;
        
        // Calculate total size and size by file type
        stats.assets.forEach((asset: any) => {
          if (!asset) return;
          
          const size = asset.size || 0;
          metrics.totalSize += size;
          
          // Group by file extension
          const ext = path.extname(asset.name || '').replace('.', '') || 'unknown';
          metrics.totalSizeByType[ext] = (metrics.totalSizeByType[ext] || 0) + size;
        });
      }

      // Process entrypoints
      if (stats.entrypoints) {
        Object.entries(stats.entrypoints).forEach(([name, entrypoint]: [string, any]) => {
          if (!entrypoint) return;
          
          let entrypointSize = 0;
          const entrypointChunks = entrypoint.chunks || [];
          
          // Sum up sizes of all assets in this entrypoint
          if (entrypoint.assets && Array.isArray(entrypoint.assets)) {
            entrypoint.assets.forEach((asset: any) => {
              if (typeof asset === 'object' && asset !== null) {
                entrypointSize += asset.size || 0;
              }
            });
          }
          
          metrics.entrypoints[name] = {
            size: entrypointSize,
            chunks: entrypointChunks,
          };
          
          // Calculate estimated initial load performance
          if (name === 'main' || name === 'index') {
            metrics.performance.initialLoad = entrypointSize / 1024; // KB
          }
        });
      }

      // Process modules
      if (stats.modules && Array.isArray(stats.modules)) {
        // Count valid modules
        metrics.moduleCount = stats.modules.filter((module: any) => module && module.size > 0).length;
        
        // Find largest modules
        const sortedModules = [...stats.modules]
          .filter((module: any) => module && module.size > 0)
          .sort((a: any, b: any) => (b.size || 0) - (a.size || 0))
          .slice(0, 20); // Get top 20 largest modules
        
        metrics.largestModules = sortedModules.map((module: any) => ({
          name: module.name || 'unknown',
          size: module.size || 0,
          type: this.getModuleType(module.name || ''),
        }));
      }

      // Process chunks
      if (stats.chunks && Array.isArray(stats.chunks)) {
        // Count valid chunks
        metrics.chunkCount = stats.chunks.filter((chunk: any) => chunk).length;
        
        // Find largest chunks and calculate chunk fragmentation
        const sortedChunks = [...stats.chunks]
          .filter((chunk: any) => chunk)
          .sort((a: any, b: any) => {
            const aSize = this.calculateChunkSize(a, stats);
            const bSize = this.calculateChunkSize(b, stats);
            return bSize - aSize;
          })
          .slice(0, 10); // Get top 10 largest chunks
        
        metrics.largestChunks = sortedChunks.map((chunk: any) => ({
          id: chunk.id?.toString() || 'unknown',
          name: chunk.names?.[0] || chunk.name || 'unnamed chunk',
          size: this.calculateChunkSize(chunk, stats),
          modules: Array.isArray(chunk.modules) ? chunk.modules.length : 0,
        }));
        
        // Calculate chunk fragmentation (higher is worse)
        if (metrics.chunkCount > 0) {
          metrics.performance.chunkFragmentation = Math.min(
            metrics.chunkCount / Math.max(metrics.entrypoints ? Object.keys(metrics.entrypoints).length : 1, 1),
            100
          );
        }
      }
      
      // Calculate cache efficiency estimation (higher is better)
      // This is an estimate based on how well the bundle is split
      if (metrics.totalSize > 0 && metrics.chunkCount > 1) {
        const avgChunkSize = metrics.totalSize / metrics.chunkCount;
        const mainBundleSize = metrics.entrypoints?.main?.size || metrics.entrypoints?.index?.size || 0;
        
        // A rough estimate of cache efficiency
        metrics.performance.cacheEfficiency = Math.min(
          ((metrics.totalSize - mainBundleSize) / metrics.totalSize) * 100,
          100
        );
      }

      return metrics;
    } catch (error) {
      console.error('Error extracting metrics:', error);
      return { error: 'Failed to extract metrics' };
    }
  }
  
  // Helper to calculate chunk size properly
  private calculateChunkSize(chunk: any, stats: any): number {
    if (!chunk) return 0;
    
    // If chunk has a size property, use it
    if (typeof chunk.size === 'number') {
      return chunk.size;
    }
    
    // If chunk has modules, sum up module sizes
    if (Array.isArray(chunk.modules)) {
      return chunk.modules.reduce((total: number, module: any) => {
        return total + (module?.size || 0);
      }, 0);
    }
    
    // Try to find assets associated with this chunk
    if (Array.isArray(stats.assets) && (chunk.id !== undefined || chunk.name !== undefined)) {
      const chunkId = chunk.id?.toString();
      const chunkName = chunk.names?.[0] || chunk.name;
      
      // Sum up sizes of all assets associated with this chunk
      return stats.assets.reduce((total: number, asset: any) => {
        if (!asset) return total;
        
        const isChunkAsset = 
          (chunkId && asset.chunks && asset.chunks.includes(chunkId)) ||
          (chunkName && asset.name && asset.name.includes(chunkName));
        
        return total + (isChunkAsset ? (asset.size || 0) : 0);
      }, 0);
    }
    
    return 0;
  }

  // Helper to determine module type based on file path
  private getModuleType(modulePath: string): string {
    if (!modulePath) return 'unknown';
    
    if (modulePath.includes('node_modules')) {
      // Extract package name
      const nodeModulesIndex = modulePath.indexOf('node_modules');
      if (nodeModulesIndex !== -1) {
        const packagePath = modulePath.slice(nodeModulesIndex + 'node_modules/'.length);
        const packageName = packagePath.split('/')[0];
        return `npm:${packageName}`;
      }
      return 'npm';
    }
    
    const ext = path.extname(modulePath).toLowerCase();
    switch (ext) {
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.css':
      case '.scss':
      case '.less':
        return 'styles';
      case '.svg':
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif':
        return 'image';
      case '.json':
        return 'json';
      default:
        return 'other';
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Webpack Analyzer MCP server running on stdio');
  }
}

// Main function to run the server
const main = async () => {
  try {
    const server = new WebpackAnalyzerServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Run the server
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});