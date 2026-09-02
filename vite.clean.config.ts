import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Clean Vite configuration that completely avoids Sequelize
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    react(), 
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Alias database imports to browser-safe version
      "@/lib/database": path.resolve(__dirname, "./src/lib/database.browser.ts"),
    },
  },
  define: {
    "process.env.USE_MYSQL": JSON.stringify("true"),
  },
  // Completely exclude Node.js modules from bundling
  optimizeDeps: {
    exclude: [
      'sequelize', 
      'mysql2', 
      'pg-hstore', 
      'wkx', 
      'fs', 
      'path', 
      'util', 
      'crypto',
      'buffer',
      'stream',
      'os',
      'events',
      'zlib'
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.clean.html"),
      },
      external: (id) => {
        // Exclude any Node.js modules from the bundle
        const nodeModules = [
          'sequelize', 
          'mysql2', 
          'pg-hstore', 
          'wkx',
          'fs',
          'path',
          'util',
          'crypto',
          'buffer'
        ];
        return nodeModules.some(mod => id.includes(mod));
      },
    },
  },
}));
