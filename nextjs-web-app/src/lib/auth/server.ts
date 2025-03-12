import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

// Define cookie store interface for compatibility
interface CookieStore {
  getAll: () => Array<{ name: string; value: string }>;
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
        setAll() {
          try {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
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
    const { cookies } = await import('next/headers');
    
    // Get cookie store
    const cookieStore = cookies();

    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    );
  } catch {
    // Using fallback error handler
    throw new Error('This method should only be used in Server Components');
  }
} 