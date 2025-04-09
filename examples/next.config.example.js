// Example Next.js configuration file
// This is a simple example that can be used to test the webpack-analyzer-mcp with Next.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Example webpack configuration
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // You can customize the webpack configuration here
    // The webpack-analyzer-mcp will automatically add the analyzer plugin
    
    // Example: Add a custom rule
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    });
    
    // Example: Add a custom plugin
    if (!isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.BUILD_ID': JSON.stringify(buildId),
        })
      );
    }
    
    return config;
  },
  
  // Example experimental features
  experimental: {
    appDir: true,
    serverComponentsExternalPackages: ['sharp'],
  },
  
  // Example image configuration
  images: {
    domains: ['example.com'],
    formats: ['image/avif', 'image/webp'],
  },
  
  // Example environment variables
  env: {
    NEXT_PUBLIC_API_URL: 'https://api.example.com',
  },
};

module.exports = nextConfig;
