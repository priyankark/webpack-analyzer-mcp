# Webpack Analyzer MCP

An MCP (Model Context Protocol) server for analyzing webpack builds. This tool allows AI assistants to analyze webpack stats files and configurations to provide insights about bundle sizes, dependencies, and optimization opportunities.

## Installation

You can install and use this package globally:

```bash
npm install -g webpack-analyzer-mcp
```

Or run it directly with npx:

```bash
npx webpack-analyzer-mcp
```

## Usage with AI Assistants

Use the following json config:
```json
{
  "mcpServers": {
    "webpack-analyzer": {
      "command": "npx",
      "args": ["webpack-analyzer-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 1. analyze_webpack_stats

Analyzes a webpack stats JSON file and generates a report.

**Parameters:**

- `statsFile` (required): Path to the webpack stats JSON file
- `outputDir` (optional): Directory to output the report (defaults to stats file directory)
- `port` (optional): Port to run the analyzer server on (defaults to 8888)
- `openBrowser` (optional): Whether to open the browser automatically (defaults to true)
- `generateReport` (optional): Whether to generate a static HTML report (defaults to true)

**Example:**

```json
{
  "statsFile": "./dist/stats.json",
  "outputDir": "./reports",
  "port": 9000,
  "openBrowser": true,
  "generateReport": true
}
```

### 2. analyze_webpack_config

Analyzes a webpack configuration by building the project and generating a report.

**Parameters:**

- `configPath` (required): Path to the webpack configuration file
- `outputDir` (optional): Directory to output the report (defaults to project directory)
- `port` (optional): Port to run the analyzer server on (defaults to 8888)
- `openBrowser` (optional): Whether to open the browser automatically (defaults to true)
- `generateReport` (optional): Whether to generate a static HTML report (defaults to true)

**Example:**

```json
{
  "configPath": "./webpack.config.js",
  "outputDir": "./reports",
  "port": 9000,
  "openBrowser": true,
  "generateReport": true
}
```

## Generating Stats Files

To generate a webpack stats file that can be analyzed:

1. Add the following to your webpack configuration:

```javascript
module.exports = {
  // ... your webpack config
  profile: true,
  stats: {
    // These options make the stats file more detailed
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
};
```

2. Run webpack with the stats option:

```bash
npx webpack --profile --json > stats.json
```

## Integration with MCP Settings

To add this server to your MCP settings for AI assistants:

```json
{
  "mcpServers": {
    "webpack-analyzer": {
      "command": "npx",
      "args": ["webpack-analyzer-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Development

To build the project:

```bash
npm run build
```

To start the server in development mode:

```bash
npm start
```

## License

ISC
