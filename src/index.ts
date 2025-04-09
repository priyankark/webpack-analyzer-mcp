#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

interface AnalyzeWebpackBuildArgs {
  statsFile: string;
  outputDir?: string;
  port?: number;
  openBrowser?: boolean;
  generateReport?: boolean;
}

interface AnalyzeWebpackConfigArgs {
  configPath: string;
  outputDir?: string;
  port?: number;
  openBrowser?: boolean;
  generateReport?: boolean;
}

const isValidAnalyzeWebpackBuildArgs = (args: any): args is AnalyzeWebpackBuildArgs => {
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.statsFile === 'string' &&
    (args.outputDir === undefined || typeof args.outputDir === 'string') &&
    (args.port === undefined || typeof args.port === 'number') &&
    (args.openBrowser === undefined || typeof args.openBrowser === 'boolean') &&
    (args.generateReport === undefined || typeof args.generateReport === 'boolean')
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
    (args.generateReport === undefined || typeof args.generateReport === 'boolean')
  );
};

class WebpackAnalyzerServer {
  private server: Server;

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
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
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
                description: 'Path to the webpack stats JSON file',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to output the report (defaults to stats file directory)',
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
                description: 'Path to the webpack configuration file',
              },
              outputDir: {
                type: 'string',
                description: 'Directory to output the report (defaults to project directory)',
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
            },
            required: ['configPath'],
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
      // Check if stats file exists
      const statsFilePath = path.resolve(args.statsFile);
      await fs.access(statsFilePath);
      
      // Read stats file
      const statsContent = await fs.readFile(statsFilePath, 'utf-8');
      const stats = JSON.parse(statsContent);
      
      // Set default values
      const outputDir = args.outputDir || path.dirname(statsFilePath);
      const port = args.port || 8888;
      const openBrowser = args.openBrowser !== false;
      const generateReport = args.generateReport !== false;
      
      // Create analyzer instance
      const analyzer = new BundleAnalyzerPlugin({
        analyzerMode: generateReport ? 'static' : 'server',
        analyzerPort: port,
        reportFilename: path.join(outputDir, 'report.html'),
        openAnalyzer: openBrowser,
        generateStatsFile: false,
        statsFilename: 'stats.json',
        statsOptions: null,
        excludeAssets: null,
        logLevel: 'info',
      });
      
      // Generate report
      await analyzer.apply({
        hooks: {
          compilation: {
            tap: (_name: string, callback: (compilation: any) => void) => {
              callback({ stats });
            },
          },
        },
      } as any);
      
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
      // Check if config file exists
      const configPath = path.resolve(args.configPath);
      await fs.access(configPath);
      
      // Set default values
      const outputDir = args.outputDir || path.dirname(configPath);
      const port = args.port || 8888;
      const openBrowser = args.openBrowser !== false;
      const generateReport = args.generateReport !== false;
      
      // Create a temporary webpack config that includes the analyzer plugin
      const tempConfigPath = path.join(outputDir, 'webpack.analyzer.config.js');
      
      const analyzerConfig = `
import path from 'path';
import { fileURLToPath } from 'url';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import baseConfig from '${configPath}';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Merge the base config with the analyzer plugin
export default {
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins || []),
    new BundleAnalyzerPlugin({
      analyzerMode: ${generateReport ? "'static'" : "'server'"},
      analyzerPort: ${port},
      reportFilename: path.join(__dirname, 'report.html'),
      openAnalyzer: ${openBrowser},
      generateStatsFile: true,
      statsFilename: path.join(__dirname, 'stats.json'),
      statsOptions: null,
      excludeAssets: null,
      logLevel: 'info',
    }),
  ],
};
      `;
      
      await fs.writeFile(tempConfigPath, analyzerConfig, 'utf-8');
      
      // Run webpack with the temporary config
      const { stdout, stderr } = await execAsync(`npx webpack --config ${tempConfigPath}`);
      
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Webpack Analyzer MCP server running on stdio');
  }
}

const server = new WebpackAnalyzerServer();
server.run().catch(console.error);
