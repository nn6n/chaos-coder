import { createClient as createBrowserClient } from './client';
import { createClient as createServerClient, createServerComponentClient as createServerComponentClientFn, createAdminClient as createAdminClientFn } from './server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { CookieOptions } from '@supabase/ssr';

// Interface for cookie store compatibility
interface CookieStore {
  getAll: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: CookieOptions) => void;
}

/**
 * AuthService - Service for handling authentication 
 * This is a compatibility layer that provides the same interface
 * for existing components that were using the previous AuthService class
 */
export class AuthService {
  /**
   * Creates a client-side Supabase client
   */
  static createClient() {
    return createBrowserClient();
  }

  /**
   * Creates a server-side Supabase client
   */
  static async createServerClient(cookieStore?: CookieStore) {
    return await createServerClient(cookieStore);
  }

  /**
   * Creates a server-side Supabase client specifically for Server Components
   */
  static async createServerComponentClient() {
    return await createServerComponentClientFn();
  }

  /**
   * Creates a Supabase client with admin privileges using the service role key
   * This should ONLY be used for server-side admin operations (like webhooks)
   * that need to bypass RLS policies
   */
  static async createAdminClient() {
    return await createAdminClientFn();
  }

  /**
   * Get the current user from a Supabase client
   * @returns Object containing user (null if not authenticated) and error (null if no error)
   */
  static async getCurrentUser(supabase: SupabaseClient<Database>) {
    try {
      const { data, error } = await supabase.auth.getUser();
      
      if (error) {
        // Handle AuthSessionMissingError gracefully - this is expected when not logged in
        if (error instanceof Error && error.name === 'AuthSessionMissingError') {
          console.log('Auth session not found. User is not logged in.');
          return { user: null, error: null };
        }
        throw error;
      }
      
      return { user: data.user, error: null };
    } catch (error) {
      console.error('Error getting current user:', error);
      return { user: null, error };
    }
  }

  /**
   * Sign in with email and password
   */
  static async signIn(email: string, password: string) {
    try {
      const supabase = createBrowserClient();
      return await supabase.auth.signInWithPassword({ email, password });
    } catch (error) {
      console.error('Error signing in:', error);
      return { data: { user: null, session: null }, error };
    }
  }

  /**
   * Sign up with email, password, and optional metadata
   */
  static async signUp(email: string, password: string, firstName: string) {
    try {
      const supabase = createBrowserClient();
      return await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
          },
        },
      });
    } catch (error) {
      console.error('Error signing up:', error);
      return { data: { user: null, session: null }, error };
    }
  }

  /**
   * Sign in with OAuth provider
   */
  static async signInWithOAuth(provider: 'google' | 'github' | 'twitter') {
    try {
      const supabase = createBrowserClient();
      return await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
    } catch (error) {
      console.error(`Error signing in with ${provider}:`, error);
      return { data: { url: null, provider: null }, error };
    }
  }

  /**
   * Sign out the current user
   */
  static async signOut() {
    try {
      const supabase = createBrowserClient();
      return await supabase.auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      return { error };
    }
  }

  /**
   * Exchange a code for a session (for OAuth callback)
   */
  static async exchangeCodeForSession(code: string, cookieStore?: CookieStore) {
    try {
      const supabase = await createServerClient(cookieStore);
      return await supabase.auth.exchangeCodeForSession(code);
    } catch (error) {
      console.error('Error exchanging code for session:', error);
      return { data: { session: null, user: null }, error };
    }
  }

  /**
   * Create a server client with a token (for API routes)
   */
  static async createServerClientWithToken(accessToken: string) {
    try {
      console.log('Creating server client with token...');
      
      // Create a new supabase client with proper cookie handling
      const supabase = await createServerClient();
      
      // Set the session with both access token and refresh token
      // This is where the issue occurs - we need to ensure cookies are properly handled
      try {
        await supabase.auth.setSession({ 
          access_token: accessToken, 
          refresh_token: '' // Empty refresh token is fine for API calls
        });
        
        console.log('Session set successfully with token');
      } catch (sessionError) {
        console.error('Error setting session:', sessionError);
        throw sessionError;
      }
      
      // Verify the session worked by getting the user
      try {
        const { data, error } = await supabase.auth.getUser();
        
        if (error) {
          console.error('Error verifying token in createServerClientWithToken:', error);
          throw error;
        }
        
        if (!data.user) {
          console.error('No user found after setting token');
          throw new Error('Authentication failed: Invalid token');
        }
        
        console.log('User verified successfully:', data.user.id);
        return supabase;
      } catch (userError) {
        console.error('Error getting user after setting token:', userError);
        throw userError;
      }
    } catch (error) {
      console.error('Error in createServerClientWithToken:', error);
      throw error;
    }
  }
} 