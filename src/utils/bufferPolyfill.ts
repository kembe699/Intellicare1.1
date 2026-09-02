// Polyfill for Node.js Buffer in the browser environment
import { Buffer as BufferPolyfill } from 'buffer';

// Add Buffer to the global scope
(window as any).Buffer = BufferPolyfill;

export default BufferPolyfill;
