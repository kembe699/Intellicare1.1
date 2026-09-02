import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import nodeSafePlugin from "./vite.plugin.nodesafe";

// Configuration for browser-only MySQL version that blocks all Node.js specific modules
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
    // Use our custom plugin to block Node.js modules - MUST be first
    nodeSafePlugin(),
    // Custom resolve plugin to redirect AuthContext imports
    {
      name: 'resolve-auth-context',
      enforce: 'pre' as const,
      resolveId(id: string, importer?: string) {
        // Redirect AuthContext imports to MySQL browser version
        // Handle various import patterns - check both alias and direct paths
        const authContextPatterns = [
          '@/contexts/AuthContext',
          '@/contexts/AuthContext.tsx',
          '@/contexts/AuthContext.ts',
        ];
        
        // Also check if it resolves to the actual file path
        if (importer) {
          try {
            const possiblePath = path.resolve(path.dirname(importer.replace(/\\/g, '/').replace(/^\/@fs\//, '')), id.replace('@/', 'src/'));
            if (possiblePath.includes('contexts/AuthContext') && 
                !possiblePath.includes('.browser') && 
                !possiblePath.includes('.pure') &&
                possiblePath.endsWith('.tsx')) {
              const resolved = path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx");
              console.log(`🔄 Redirecting AuthContext path: ${possiblePath} → AuthContext.mysql.pure.tsx`);
              return resolved;
            }
          } catch (e) {
            // Ignore path resolution errors
          }
        }
        
        // Check direct import patterns
        if (authContextPatterns.some(pattern => id === pattern) ||
            (id.includes('contexts/AuthContext') && !id.includes('.browser') && !id.includes('.pure'))) {
          const resolved = path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx");
          console.log(`🔄 Redirecting AuthContext import: ${id} → AuthContext.mysql.pure.tsx`);
          return resolved;
        }
        
        return null;
      },
    },
    // HTML transform plugin to use browser-mysql entry point
    {
      name: 'html-transform',
      transformIndexHtml(html: string) {
        // Replace the script src to use browser-mysql entry point
        const transformed = html.replace(
          'src="/src/main.tsx"',
          'src="/src/main.browser-mysql.tsx"'
        );
        console.log('📄 HTML transformed - using main.browser-mysql.tsx');
        return transformed;
      },
    },
    react(), 
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Redirect database imports to browser-safe version
      "@/lib/database": path.resolve(__dirname, "./src/lib/database.browser.ts"),
      // Redirect auth context to pure MySQL version (no Firebase)
      "@/contexts/AuthContext.mysql": path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx"),
      // Also redirect the default AuthContext to pure MySQL version for all pages
      "@/contexts/AuthContext": path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx"),
      // Additional aliases to catch different import patterns
      "@/contexts/AuthContext.tsx": path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx"),
      "@/contexts/AuthContext.ts": path.resolve(__dirname, "./src/contexts/AuthContext.mysql.pure.tsx"),
    },
  },
  // Define environment variables for browser
  define: {
    "import.meta.env.VITE_USE_MYSQL": JSON.stringify("true"),
    "import.meta.env.MODE": JSON.stringify(mode),
    "import.meta.env.DEV": JSON.stringify(mode === "development"),
    "import.meta.env.PROD": JSON.stringify(mode === "production"),
  },
  // Force exclude all Node.js modules
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
  // Custom build options
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      // Don't mark as external - let the plugin provide mocks instead
      // External dependencies would try to load at runtime, which won't work in browser
    },
  },
}));
