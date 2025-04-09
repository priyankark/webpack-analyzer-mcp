declare module 'webpack-bundle-analyzer' {
  export class BundleAnalyzerPlugin {
    constructor(options?: {
      analyzerMode?: 'server' | 'static' | 'json' | 'disabled';
      analyzerHost?: string;
      analyzerPort?: number | 'auto';
      reportFilename?: string;
      reportTitle?: string;
      defaultSizes?: 'stat' | 'parsed' | 'gzip';
      openAnalyzer?: boolean;
      generateStatsFile?: boolean;
      statsFilename?: string;
      statsOptions?: null | object;
      excludeAssets?: null | RegExp | string | ((asset: string) => boolean) | Array<RegExp | string | ((asset: string) => boolean)>;
      logLevel?: 'info' | 'warn' | 'error' | 'silent';
    });

    apply(compiler: any): void;
  }
}
