import { Plugin } from 'vite';

/**
 * Vite plugin to prevent bundling Node.js specific modules in browser code
 * This prevents "process is not defined" and "Buffer is not defined" errors
 */
export default function nodeSafePlugin(): Plugin {
  return {
    name: 'node-safe-plugin',
    enforce: 'pre', // Run this plugin before other plugins to intercept early
    
    // Resolve hook to intercept module resolution
    resolveId(id, importer) {
      // List of modules that should not be imported in browser code
      const nodeOnlyModules = [
        'sequelize',
        'pg-hstore', 
        'wkx',
        'mysql2',
        'pg',
        'sqlite3',
        'tedious',
        'oracledb'
      ];
      
      // Check if the ID matches any node-only module (exact match or starts with module name)
      // This handles both 'sequelize' and 'sequelize/lib/index.js' etc.
      const matchedModule = nodeOnlyModules.find(module => 
        id === module || id.startsWith(`${module}/`)
      );
      
      // If trying to import a Node-only module, return a virtual module
      if (matchedModule) {
        console.warn(`🚨 Blocked Node.js module '${id}' from being bundled in browser code`);
        return {
          id: `virtual:node-safe-${matchedModule}`,
          external: false // Mark as internal so Vite processes it
        };
      }
      
      return null;
    },
    
    // Load hook to provide mock implementations for virtual modules
    load(id) {
      if (id.startsWith('virtual:node-safe-')) {
        const moduleName = id.replace('virtual:node-safe-', '');
        console.warn(`📦 Providing mock implementation for ${moduleName}`);
        
        // Return appropriate mock based on module
        if (moduleName === 'sequelize') {
          return `
            console.warn('Sequelize is not available in browser environment. Use API calls instead.');
            
            // Mock Sequelize class
            class MockSequelize {
              constructor() {
                throw new Error('Sequelize cannot run in browser environment. Use API calls instead.');
              }
              authenticate() { throw new Error('Sequelize not available in browser'); }
              sync() { throw new Error('Sequelize not available in browser'); }
              transaction() { throw new Error('Sequelize not available in browser'); }
              query() { throw new Error('Sequelize not available in browser'); }
              get models() { return {}; }
            }
            
            // Export named exports
            export const Sequelize = MockSequelize;
            export const DataTypes = {
              STRING: 'STRING',
              INTEGER: 'INTEGER',
              DATE: 'DATE',
              BOOLEAN: 'BOOLEAN',
              TEXT: 'TEXT',
              DECIMAL: 'DECIMAL',
              UUID: 'UUID',
            };
            export const Op = {
              eq: Symbol('eq'),
              ne: Symbol('ne'),
              gt: Symbol('gt'),
              gte: Symbol('gte'),
              lt: Symbol('lt'),
              lte: Symbol('lte'),
              like: Symbol('like'),
              ilike: Symbol('ilike'),
              in: Symbol('in'),
              notIn: Symbol('notIn'),
              and: Symbol('and'),
              or: Symbol('or'),
            };
            export const Model = class MockModel {};
            export const Transaction = class MockTransaction {};
            export const QueryTypes = {};
            export const fn = () => {};
            export const col = () => {};
            export const cast = () => {};
            export const literal = () => {};
            export const and = () => {};
            export const or = () => {};
            export const where = () => {};
            export const json = () => {};
            
            // Export default (required for compatibility)
            const defaultExport = {
              Sequelize: MockSequelize,
              DataTypes,
              Op,
              Model,
              Transaction,
              QueryTypes,
              fn,
              col,
              cast,
              literal,
              and,
              or,
              where,
              json,
            };
            export default defaultExport;
          `;
        }
        
        // Generic mock for other modules
        return `
          console.warn('${moduleName} is not available in browser environment');
          export default {};
        `;
      }
      
      return null;
    }
  };
}
