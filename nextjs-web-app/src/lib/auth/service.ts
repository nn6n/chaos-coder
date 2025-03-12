import { createClient as createBrowserClient } from './client';
import { createClient as createServerClient, createServerComponentClient as createServerComponentClientFn } from './server';
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
      const supabase = await createServerClient();
      
      // Set the session with both access token and refresh token (even if refresh token is empty)
      await supabase.auth.setSession({ 
        access_token: accessToken, 
        refresh_token: '' 
      });
      
      // Immediately verify the session worked by getting the user
      const { data, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('Error verifying token in createServerClientWithToken:', error);
        throw error;
      }
      
      if (!data.user) {
        console.error('No user found after setting token');
        throw new Error('Authentication failed: Invalid token');
      }
      
      return supabase;
    } catch (error) {
      console.error('Error in createServerClientWithToken:', error);
      throw error;
    }
  }
} 