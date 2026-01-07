
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter '' allows loading variables without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // This ensures that process.env.API_KEY is replaced with the actual key string during build
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY || ""),
    }
  };
});
