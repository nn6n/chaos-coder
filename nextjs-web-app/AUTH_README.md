# Supabase Auth SSR Implementation

This project uses Supabase Auth with SSR (Server-Side Rendering) capabilities, following the official guidelines for Next.js applications.

## Structure

The authentication system is structured as follows:

1. `src/lib/auth/client.ts` - Browser client implementation
2. `src/lib/auth/server.ts` - Server client implementation (with Pages & App Router compatibility)
3. `src/lib/auth/service.ts` - AuthService compatibility layer for existing components
4. `src/lib/auth/index.ts` - Export file that consolidates auth utilities
5. `middleware.ts` - Middleware for session refresh and route protection

## Implementation Details

The implementation follows the latest Supabase Auth best practices:

1. Uses `@supabase/ssr` package instead of the deprecated `@supabase/auth-helpers-nextjs`
2. Implements the correct cookie handling pattern with `getAll()` and `setAll()` methods
3. Avoids using individual cookie methods (`get`, `set`, `remove`) which can cause issues
4. Properly refreshes auth tokens in middleware
5. Compatible with both Pages Router and App Router
6. Includes a backwards-compatible AuthService class for existing components

## Usage

### Modern Approach (New Components)

For new components, use the direct client functions:

#### Browser Client (Client Components)

```tsx
'use client'

import { createBrowserClient } from '@/lib/auth'
import { useState } from 'react'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  async function handleSubmit(e) {
    e.preventDefault()
    
    const supabase = createBrowserClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) {
      console.error('Error signing in:', error)
    } else {
      // Redirect or update UI
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  )
}
```

#### Server Component Client (App Router Server Components)

For use in Server Components (App Router):

```tsx
import { createServerComponentClient } from '@/lib/auth'

export default async function ProfilePage() {
  const supabase = await createServerComponentClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    // Handle unauthenticated state
    return <div>Please log in</div>
  }
  
  // Fetch user data
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
    
  return (
    <div>
      <h1>Welcome, {profile?.first_name || 'User'}</h1>
      {/* Display user data */}
    </div>
  )
}
```

#### Server Client (Pages Router)

For use in getServerSideProps or API routes (Pages Router):

```tsx
import { createServerClient } from '@/lib/auth'

export async function getServerSideProps(context) {
  // Create a cookie store wrapper for the pages router
  const cookieStore = {
    getAll: () => {
      const cookies = []
      for (const [name, value] of Object.entries(context.req.cookies)) {
        cookies.push({ name, value })
      }
      return cookies
    },
    set: (name, value, options) => {
      context.res.setHeader('Set-Cookie', `${name}=${value}; Path=/`)
    }
  }
  
  const supabase = await createServerClient(cookieStore)
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return {
      redirect: {
        destination: '/login',
        permanent: false,
      }
    }
  }
  
  return {
    props: {
      user
    }
  }
}
```

### Legacy Approach (Existing Components)

For existing components that expect the `AuthService` class:

```tsx
import { AuthService } from '@/lib/auth'

// Sign in
const { data, error } = await AuthService.signIn(email, password)

// Sign up
const { data, error } = await AuthService.signUp(email, password, firstName)

// OAuth sign in
const { error } = await AuthService.signInWithOAuth('google')

// Sign out
await AuthService.signOut()

// Get current user
const supabase = AuthService.createClient()
const { user, error } = await AuthService.getCurrentUser(supabase)
```

## Testing

To test the authentication implementation, run:

```bash
npm run test:auth
```

This will verify that all the required files are present and correctly structured.

## Important Notes

- Never use individual cookie methods (`get`, `set`, `remove`).
- Never import from `@supabase/auth-helpers-nextjs` (deprecated).
- Always use the cookie handling pattern shown in this implementation.
- The middleware implementation is critical for maintaining session state.
- Use `createServerComponentClient()` only in App Router Server Components.
- Use `createServerClient()` with a cookie store in Pages Router.
- For new components, prefer the direct client functions over AuthService.

## Changes Made

1. Created separate files for browser and server clients
2. Updated middleware to use the correct cookie handling pattern
3. Removed deprecated auth-helpers-nextjs usage
4. Added compatibility layer for existing components
5. Added test script to verify implementation
6. Created this documentation
7. Implemented compatibility with both Pages Router and App Router 