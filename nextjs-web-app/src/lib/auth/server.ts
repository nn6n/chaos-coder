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
        setAll(cookiesToSet) {
          try {
            // If we have a setCookie method available
            if ('set' in cookies && typeof cookies.set === 'function') {
              cookiesToSet.forEach(({ name, value, options }) => {
                (cookies as any).set(name, value, options);
              });
            } else {
              // Log this for debugging but don't throw an error
              console.log('Cookie setting skipped - no set method available in the cookie store');
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

/**
 * Creates a Supabase client with admin privileges using the service role key
 * This should ONLY be used for server-side admin operations (like webhooks)
 * that need to bypass RLS policies
 */
export async function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    throw new Error('Admin client configuration error: Missing service role key');
  }
  
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      // No cookies needed for admin operations
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Admin client doesn't need to set cookies
          return;
        },
      },
    }
  );
} 