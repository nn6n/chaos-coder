import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import type { CookieOptions } from '@supabase/ssr'
import { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

// Define cookie store interface for compatibility
interface CookieStore {
  getAll: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: CookieOptions) => void;
}

/**
 * Creates a Supabase client for server-side usage
 * This function should be used in API routes, getServerSideProps, or in middleware
 * For Server Components, use createServerComponentClient instead
 */
export async function createClient(cookieStore?: CookieStore) {
  // Use provided cookie store or create empty fallback
  const cookies = cookieStore || {
    getAll: () => [],
  };

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookies.getAll();
        },
        setAll(cookiesToSet) {
          try {
            if (cookies.set) {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookies.set!(name, value, options);
              });
            }
          } catch (e) {
            // Can be safely ignored if using middleware to refresh sessions
            console.warn('Error setting cookies in server client:', e);
          }
        },
      },
    }
  );
}

/**
 * Creates a Supabase client specifically for Server Components in the App Router
 * This should be used in React Server Components
 */
export async function createServerComponentClient() {
  try {
    // Use dynamic import to avoid breaking in non-Server Component contexts
    const nextHeaders = await import('next/headers');
    
    // Create a wrapper for the cookies
    const cookieWrapper = {
      getAll: () => {
        try {
          // Only call cookies() when this code actually executes
          return nextHeaders.cookies().getAll();
        } catch {
          return [];
        }
      },
      set: (name: string, value: string, options?: CookieOptions) => {
        try {
          // Only call cookies() when this code actually executes
          nextHeaders.cookies().set(name, value, options);
        } catch {
          // This is expected in Server Components and can be ignored
        }
      }
    };

    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieWrapper.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieWrapper.set(name, value, options);
              });
            } catch {
              // This is expected in Server Components and can be ignored
              // when middleware is handling session refresh
            }
          },
        },
      }
    );
  } catch (error) {
    // Using fallback error handler
    throw new Error('This method should only be used in Server Components');
  }
} 