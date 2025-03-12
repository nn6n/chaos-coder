// Direct exports from client/server modules
export { createClient as createBrowserClient } from './client';
export { 
  createClient as createServerClient,
  createServerComponentClient
} from './server';

// Export type definitions
export type { Database } from '@/types/supabase';

// Export AuthService for backwards compatibility
export { AuthService } from './service'; 