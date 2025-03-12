import { NextRequest, NextResponse } from 'next/server';
import { PaymentService } from '@/lib/payment';
import { AuthService } from '@/lib/auth';

// Simplified request type
interface CheckoutRequestBody {
  tier: 'pro' | 'ultra';
  accessToken?: string;
  userId: string;
  userEmail: string;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  console.log(`🔄 [${requestId}] Starting checkout process`);
  
  try {
    // 1. Basic request validation
    const body = await req.json() as CheckoutRequestBody;
    const { tier, userId, userEmail } = body;
    
    if (!tier || !['pro', 'ultra'].includes(tier)) {
      return new NextResponse(
        JSON.stringify({ error: 'Invalid tier specified' }), 
        { status: 400 }
      );
    }

    // 2. Get authentication token from Authorization header or request body
    const authHeader = req.headers.get('Authorization');
    const accessToken = authHeader ? authHeader.replace('Bearer ', '') : body.accessToken;

    if (!accessToken) {
      console.error(`❌ [${requestId}] Missing authentication token`);
      return new NextResponse(
        JSON.stringify({ error: 'Missing authentication token' }), 
        { status: 401 }
      );
    }

    // 3. Create Supabase client using cookie store from request
    let supabase;
    try {
      // Get the cookie store from the request
      const cookieStore = {
        getAll() {
          return req.cookies.getAll();
        }
      };

      // Create a server client with cookies AND token
      supabase = await AuthService.createServerClient(cookieStore);
      
      // Set the session with the token
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: ''
      });
      
      console.log(`✅ [${requestId}] Created Supabase client with auth token successfully`);
    } catch (authError) {
      console.error(`❌ [${requestId}] Auth error when creating client:`, authError);
      return new NextResponse(
        JSON.stringify({ 
          error: 'Authentication failed',
          details: authError instanceof Error ? authError.message : 'Invalid session'
        }), 
        { status: 401 }
      );
    }
    
    // 4. Verify user identity
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log(`👤 [${requestId}] Auth check result - User ID:`, user?.id, 'Error:', userError?.message);
    
    if (userError || !user?.id) {
      console.error(`❌ [${requestId}] Auth validation error:`, userError || 'User not found');
      return new NextResponse(
        JSON.stringify({ 
          error: 'User authentication failed',
          details: userError?.message || 'User not found'
        }), 
        { status: 401 }
      );
    }

    // Verify user ID matches the requested user ID
    if (user.id !== userId) {
      console.error(`❌ [${requestId}] User ID mismatch - Token user: ${user.id}, Request user: ${userId}`);
      return new NextResponse(
        JSON.stringify({ error: 'User ID mismatch' }), 
        { status: 403 }
      );
    }

    // 5. Get or create profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      if (profileError.code === 'PGRST116') {
        // Profile doesn't exist, create it
        console.log(`🔄 [${requestId}] Profile not found, creating new profile for user ${user.id}`);
        
        const { error: createError } = await supabase
          .from('profiles')
          .insert({ id: user.id });
        
        if (createError) {
          console.error(`❌ [${requestId}] Profile creation error:`, createError);
          return new NextResponse(
            JSON.stringify({ error: 'Failed to create profile' }), 
            { status: 500 }
          );
        }
        
        console.log(`✅ [${requestId}] Created new profile for user ${user.id}`);
      } else {
        console.error(`❌ [${requestId}] Profile error:`, profileError);
        return new NextResponse(
          JSON.stringify({ error: 'Failed to get profile' }), 
          { status: 500 }
        );
      }
    }

    // 6. Get or create Stripe customer
    let stripeCustomerId = profile?.stripe_customer_id;
    
    if (!stripeCustomerId) {
      console.log(`🔄 [${requestId}] No Stripe customer ID found, creating new customer`);
      
      stripeCustomerId = await PaymentService.getOrCreateCustomer(userId, userEmail);
      
      // Update profile with new customer ID
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', user.id);
      
      if (updateError) {
        console.error(`❌ [${requestId}] Failed to update stripe_customer_id:`, updateError);
      } else {
        console.log(`✅ [${requestId}] Updated profile with new Stripe customer ID: ${stripeCustomerId}`);
      }
    } else {
      console.log(`✅ [${requestId}] Using existing Stripe customer ID: ${stripeCustomerId}`);
    }

    // 7. Create checkout session
    console.log(`🔄 Creating subscription checkout for customer ${stripeCustomerId}, tier: ${tier}`);
    
    const { url } = await PaymentService.createSubscriptionCheckout(
      stripeCustomerId,
      tier,
      user.id
    );

    if (!url) {
      return new NextResponse(
        JSON.stringify({ error: 'Failed to create checkout session' }), 
        { status: 500 }
      );
    }

    console.log(`✅ [${requestId}] Created checkout session with URL: ${url.substring(0, 50)}...`);
    
    return new NextResponse(
      JSON.stringify({ url }), 
      { status: 200 }
    );
    
  } catch (error) {
    console.error(`❌ [${requestId}] Checkout error:`, error);
    return new NextResponse(
      JSON.stringify({ 
        error: `Checkout failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }), 
      { status: 500 }
    );
  }
}
