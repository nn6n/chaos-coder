import Stripe from "stripe";
import { z } from "zod";
import { AuthService } from "@/lib/auth";
import { addUserCredits, createCreditPurchase, createSubscriptionHistory } from "@/lib/db-helpers";
import { Database } from "@/types/supabase";
import { SupabaseClient } from "@supabase/supabase-js";

type SubscriptionTier =
  Database["public"]["Tables"]["profiles"]["Row"]["subscription_tier"];
type SubscriptionStatus = NonNullable<
  Database["public"]["Tables"]["profiles"]["Row"]["subscription_status"]
>;
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

// Define types for Stripe events to avoid any type
type StripeEvent = Stripe.Event;
type StripeSession = Stripe.Checkout.Session;
type StripeSubscription = Stripe.Subscription;
type StripeInvoice = Stripe.Invoice;
type StripeCustomer = Stripe.Customer;
type StripeDeletedCustomer = Stripe.DeletedCustomer;

/**
 * Subscription plan configuration
 */
export const PLANS = {
  FREE: {
    name: "Free",
    tier: "free",
    credits: 30,
    price: 0,
    features: ["30 free credits per day", "Max 3x generations"],
  },
  PRO: {
    name: "Pro",
    tier: "pro",
    credits: 100,
    price: 10,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    features: [
      "100 free credits per day",
      "Ability to configure vibes",
      "Buy additional credits: $1 = 15 credits",
    ],
    topUpRate: 15, // Credits per $1
  },
  ULTRA: {
    name: "Ultra",
    tier: "ultra",
    credits: 1000,
    price: 50,
    priceId: process.env.STRIPE_ULTRA_PRICE_ID,
    features: [
      "1000 free credits per day",
      "Everything from other plans",
      "Priority support",
      "Buy additional credits: $1 = 30 credits",
      "Generations can be saved (coming soon)",
    ],
    topUpRate: 30, // Credits per $1
  },
};

// Define schema for plan tiers
export const PlanTierSchema = z.enum(["free", "pro", "ultra"]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

/**
 * Centralized payment service that provides methods for all payment-related operations
 */
export class PaymentService {
  private static stripe: Stripe | null = null;

  /**
   * Get or initialize Stripe instance
   */
  static getStripe(): Stripe {
    if (this.stripe) {
      return this.stripe;
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing Stripe secret key");
    }

    // Use a compatible API version and specify it explicitly
    this.stripe = new Stripe(secretKey, {
      apiVersion: "2023-10-16" as Stripe.LatestApiVersion,
      typescript: true,
    });

    return this.stripe;
  }

  /**
   * Calculate the price for purchasing credits based on subscription tier
   */
  static calculateCreditPrice(amount: number, tier: PlanTier): number {
    // Get the appropriate top-up rate based on the subscription tier
    let topUpRate = 0;

    if (tier === "pro") {
      topUpRate = PLANS.PRO.topUpRate || 15;
    } else if (tier === "ultra") {
      topUpRate = PLANS.ULTRA.topUpRate || 30;
    } else {
      // Free tier cannot purchase credits
      return 0;
    }

    // Calculate the price - $1 per X credits, rounded up to nearest dollar
    const price = Math.ceil(amount / topUpRate);

    return price;
  }

  /**
   * Get or create a Stripe customer for a user
   */
  static async getOrCreateCustomer(
    userId: string,
    email: string
  ): Promise<string> {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const supabase =
      (await AuthService.createServerClient()) as SupabaseClient<Database>;

    // Check if user already has a customer ID
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profile?.stripe_customer_id) {
      // Verify the customer still exists in Stripe
      try {
        const customer = (await stripe.customers.retrieve(
          profile.stripe_customer_id
        )) as StripeCustomer | StripeDeletedCustomer;
        if (!("deleted" in customer)) {
          return customer.id;
        }
      } catch (error) {
        console.error("Error retrieving Stripe customer:", error);
      }
    }

    // Create new customer if none exists
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });

    return customer.id;
  }

  /**
   * Create a subscription checkout session
   */
  static async createSubscriptionCheckout(
    customerId: string,
    tier: "pro" | "ultra",
    userId: string
  ): Promise<{ url: string | null }> {
    console.log(
      `🔄 Creating subscription checkout for customer ${customerId}, tier: ${tier}`
    );

    try {
      const stripe = this.getStripe();

      // Get the appropriate price ID based on the tier
      const priceId =
        tier === "pro"
          ? process.env.STRIPE_PRO_PRICE_ID
          : process.env.STRIPE_ULTRA_PRICE_ID;

      if (!priceId) {
        throw new Error(`Price ID not found for ${tier} tier`);
      }

      // Get the product ID for this price to include in metadata
      let productId = "";
      try {
        const price = await stripe.prices.retrieve(priceId);
        productId = price.product as string;
        console.log(`📊 Retrieved product ID for ${tier} tier: ${productId}`);
      } catch (error) {
        console.warn(
          `⚠️ Could not retrieve product ID for price ${priceId}:`,
          error
        );
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        mode: "subscription",
        success_url: `${this.getSiteUrl()}/dashboard?checkout=success`,
        cancel_url: `${this.getSiteUrl()}/dashboard?checkout=cancelled`,
        metadata: {
          userId,
          tier,
          productId,
        },
      });

      return { url: session.url };
    } catch (error) {
      console.error("Error creating subscription checkout:", error);
      throw new Error(
        `Failed to create checkout session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Create a credit purchase checkout session
   */
  static async createCreditPurchaseCheckout(
    customerId: string,
    amount: number,
    tier: PlanTier,
    userId: string
  ): Promise<{ url: string | null }> {
    if (tier === "free") {
      throw new Error("Free tier users cannot purchase credits");
    }

    try {
      const stripe = this.getStripe();
      const price = this.calculateCreditPrice(amount, tier);

      if (price <= 0) {
        throw new Error("Invalid credit amount or pricing calculation");
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${amount} AI Credits`,
                description: "AI Credits for generating content",
              },
              unit_amount: price * 100, // Convert dollars to cents
            },
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        mode: "payment",
        success_url: `${this.getSiteUrl()}/dashboard?checkout=success`,
        cancel_url: `${this.getSiteUrl()}/dashboard?checkout=cancelled`,
        metadata: {
          userId,
          isCreditPurchase: "true",
          credits: amount.toString(),
          tier,
        },
      });

      return { url: session.url };
    } catch (error) {
      console.error("Error creating credit purchase checkout:", error);
      throw new Error(
        `Failed to create credits checkout session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Handle the Stripe webhook event
   */
  static async handleWebhookEvent(
    body: string,
    signature: string,
    webhookSecret: string
  ): Promise<{ success: boolean; message: string }> {
    const stripe = this.getStripe();

    try {
      // Verify the event came from Stripe
      const event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );

      console.log(`🔔 Processing webhook event: ${event.type}`);
      console.log(`📊 Event ID: ${event.id}`);

      // Handle different event types
      switch (event.type) {
        case "checkout.session.completed":
          console.log(`🔄 Handling checkout.session.completed event`);
          await this.handleCheckoutSessionCompleted(
            event.data.object as StripeSession
          );
          break;

        case "customer.subscription.created":
          console.log(`🔄 Handling customer.subscription.created event`);
          await this.handleSubscriptionChange(
            event.data.object as StripeSubscription
          );
          break;

        case "customer.subscription.updated":
          console.log(`🔄 Handling customer.subscription.updated event`);
          await this.handleSubscriptionChange(
            event.data.object as StripeSubscription
          );
          break;

        case "customer.subscription.deleted":
          console.log(`🔄 Handling customer.subscription.deleted event`);
          await this.handleSubscriptionCancelled(
            event.data.object as StripeSubscription
          );
          break;

        case "invoice.payment_succeeded":
          console.log(`🔄 Handling invoice.payment_succeeded event`);
          await this.handleInvoicePaymentSucceeded(
            event.data.object as StripeInvoice
          );
          break;

        case "invoice.payment_failed":
          console.log(`🔄 Handling invoice.payment_failed event`);
          await this.handleInvoicePaymentFailed(
            event.data.object as StripeInvoice
          );
          break;

        default:
          console.log(`⚠️ Unhandled event type: ${event.type}`);
      }

      return { success: true, message: `Processed ${event.type} event` };
    } catch (error) {
      console.error("❌ Webhook error:", error);
      return {
        success: false,
        message: `Webhook Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Handle checkout session completed event
   */
  private static async handleCheckoutSessionCompleted(session: StripeSession) {
    console.log(`🔄 Processing checkout session completed: ${session.id}`);
    console.log(`📊 Session metadata:`, session.metadata);

    // If this is a credit purchase, add credits to the user's account
    if (session.metadata?.credits && session.metadata?.userId) {
      // Get the user's current tier to determine credit multiplier
      const userId = session.metadata.userId;
      const supabase = await AuthService.createAdminClient();

      // Get the user's tier
      const { data: userProfile, error: profileError } = await supabase
        .from("profiles")
        .select("subscription_tier, credits, last_credit_refresh")
        .eq("id", userId)
        .single();

      if (profileError) {
        console.error(`❌ Error getting user profile: ${profileError.message}`);
        return;
      }

      const userTier = userProfile.subscription_tier || "free";
      console.log(`📊 User tier: ${userTier}, Current credits: ${userProfile.credits}`);

      // Calculate credits to add based on tier top-up rate
      const creditsAmount = parseInt(session.metadata.credits);
      const creditsToAdd = creditsAmount;
      
      // Calculate amount paid
      const amountPaid = session.amount_total ? session.amount_total / 100 : 0;
      
      console.log(`💰 Adding ${creditsToAdd} credits to user ${userId}`);

      // Add credits to the user's account using the calculated amount
      const { error } = await addUserCredits(
        supabase,
        userId,
        creditsToAdd
      );

      if (error) {
        console.error(`❌ Error adding credits: ${error.message}`);
        return;
      }

      console.log(`✅ Credits added successfully: ${creditsToAdd}`);

      // Record the purchase in the credit_purchases table
      try {
        await createCreditPurchase(supabase, {
          user_id: userId,
          amount: creditsToAdd, // Use the calculated amount
          price_paid: amountPaid,
          currency: session.currency || "usd",
          stripe_session_id: session.id,
          stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : undefined
        });

        console.log(`✅ Credit purchase recorded in database`);
      } catch (error) {
        console.error(`❌ Error recording purchase: ${error}`);
      }
    }
    // If this is a subscription checkout
    else if (session.mode === "subscription" && session.metadata?.userId && session.metadata?.tier) {
      console.log(`🔄 Processing subscription checkout: ${session.id}`);
      
      const userId = session.metadata.userId;
      const tier = session.metadata.tier as SubscriptionTier;
      const supabase = await AuthService.createAdminClient();
      
      try {
        // Get the current profile to check if this is an upgrade
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("subscription_tier, last_credit_refresh")
          .eq("id", userId)
          .single();
          
        if (profileError) {
          console.error(`❌ Error fetching profile: ${profileError.message}`);
        } else {
          const prevTier = profileData?.subscription_tier || 'free';
          
          // Check if this is an upgrade that requires immediate credit refresh
          const isUpgrade = tier !== prevTier && 
            (
              (tier === 'ultra' && ['pro', 'free'].includes(prevTier)) ||
              (tier === 'pro' && prevTier === 'free')
            );
          
          // Check if user already received credits today
          const lastCreditRefresh = profileData?.last_credit_refresh ? new Date(profileData.last_credit_refresh) : null;
          const today = new Date();
          const hasReceivedCreditsToday = lastCreditRefresh && 
            lastCreditRefresh.getDate() === today.getDate() &&
            lastCreditRefresh.getMonth() === today.getMonth() &&
            lastCreditRefresh.getFullYear() === today.getFullYear();
          
          // If this is an upgrade and user hasn't received credits today
          if (isUpgrade && !hasReceivedCreditsToday) {
            console.log(`🔄 Subscription upgrade detected: ${prevTier} -> ${tier}`);
            console.log(`💰 Granting immediate daily credits for tier: ${tier}`);
            
            // Determine credit amount based on tier
            const creditAmount = tier === 'ultra' ? 1000 : tier === 'pro' ? 100 : 30;
            
            try {
              // Call the add_user_credits function to add credits and record the transaction
              const { data: creditsData, error: creditsError } = await addUserCredits(
                supabase,
                userId,
                creditAmount,
                "plan_upgrade",
                `Immediate credits grant after upgrading to ${tier} plan`
              );
              
              if (creditsError) {
                console.error(`❌ Error granting immediate credits: ${creditsError.message}`);
              } else {
                console.log(`✅ Successfully granted ${creditAmount} credits after plan upgrade. New total: ${creditsData}`);
                
                // Update last_credit_refresh timestamp
                await supabase
                  .from("profiles")
                  .update({ 
                    last_credit_refresh: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", userId);
              }
            } catch (err) {
              console.error(`❌ Exception granting immediate credits:`, err);
            }
          } else if (isUpgrade && hasReceivedCreditsToday) {
            console.log(`ℹ️ User already received credits today, skipping immediate credit grant`);
          }
        }
        
        // Update the subscription with user metadata if there is a subscription
        if (session.subscription) {
          const stripe = this.getStripe();
          
          try {
            await stripe.subscriptions.update(
              session.subscription as string,
              {
                metadata: {
                  userId: session.metadata.userId,
                  tier: session.metadata.tier,
                },
              }
            );
            console.log(`✅ Updated subscription metadata`);
          } catch (subError) {
            console.error(`❌ Error updating subscription metadata:`, subError);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing subscription checkout:`, error);
      }
    } else {
      console.log(`ℹ️ No credits or subscription metadata in session, skipping processing`);
    }
  }

  /**
   * Handle subscription change event
   */
  private static async handleSubscriptionChange(
    subscription: StripeSubscription
  ) {
    console.log(
      `🔄 Processing subscription change for subscription: ${subscription.id}`
    );
    console.log(`📊 Subscription status: ${subscription.status}`);
    console.log(`📊 Full subscription data:`, subscription);

    // Use admin client to bypass RLS policies
    const supabase = await AuthService.createAdminClient() as SupabaseClient<Database>;

    try {
      // Get the user ID from the subscription metadata
      const userId = subscription.metadata?.userId;
      if (!userId) {
        console.error("❌ No user ID in subscription metadata");
        return;
      }
      console.log(`✅ User ID found in subscription metadata: ${userId}`);

      // Check current profile state
      console.log(`🔍 Checking current profile state for user ${userId}`);
      const { data: currentProfile, error: currentProfileError } =
        await supabase.from("profiles").select("*").eq("id", userId).single();

      if (currentProfileError) {
        console.error(
          "❌ Error fetching current profile:",
          currentProfileError
        );

        // Create a new profile if one doesn't exist
        const tier = (subscription.metadata?.tier ||
          "free") as SubscriptionTier;
        console.log(
          `🔄 Creating new profile for user ${userId} with tier ${tier}`
        );

        const newProfile: ProfileInsert = {
          id: userId,
          subscription_tier: tier,
          subscription_status: subscription.status as SubscriptionStatus,
          stripe_customer_id:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
          stripe_subscription_id: subscription.id,
          subscription_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          subscription_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
          credits: tier === "ultra" ? 1000 : tier === "pro" ? 100 : 30,
          last_credit_refresh: new Date().toISOString(),
        };

        console.log(`📊 New profile data:`, newProfile);

        const { error: createError } = await supabase
          .from("profiles")
          .insert(newProfile);

        if (createError) {
          console.error("❌ Failed to create profile:", createError);
          console.error(
            "❌ Profile creation error details:",
            JSON.stringify(createError)
          );

          // If this is an RLS error, log additional information
          if (createError.code === "42501") {
            console.error(
              "❌ This is a Row-Level Security policy error. Make sure:"
            );
            console.error(
              "   1. The supabase client is using the service role key"
            );
            console.error(
              "   2. The RLS policies allow inserts for the service role"
            );
            console.error("   3. The correct schema is being used");
          }

          return;
        }
        console.log(`✅ Created new profile for user ${userId}`);
      } else {
        console.log(`📊 Current profile state:`, currentProfile);

        // Update the existing profile
        const tier = (subscription.metadata?.tier ||
          currentProfile.subscription_tier) as SubscriptionTier;
        const profileUpdate: ProfileUpdate = {
          subscription_tier: tier,
          subscription_status: subscription.status as SubscriptionStatus,
          stripe_subscription_id: subscription.id,
          subscription_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          subscription_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        };

        console.log(`📊 Profile update data:`, profileUpdate);

        const { error: updateError } = await supabase
          .from("profiles")
          .update(profileUpdate)
          .eq("id", userId);

        if (updateError) {
          console.error("❌ Error updating profile:", updateError);
          return;
        }

        // Check if this is an upgrade (higher tier) that requires immediate credit refresh
        const isUpgrade = tier !== currentProfile.subscription_tier && 
          (
            (tier === 'ultra' && ['pro', 'free'].includes(currentProfile.subscription_tier)) ||
            (tier === 'pro' && currentProfile.subscription_tier === 'free')
          );
        
        // Check if user already received credits today
        const lastCreditRefresh = currentProfile.last_credit_refresh ? new Date(currentProfile.last_credit_refresh) : null;
        const today = new Date();
        const hasReceivedCreditsToday = lastCreditRefresh && 
          lastCreditRefresh.getDate() === today.getDate() &&
          lastCreditRefresh.getMonth() === today.getMonth() &&
          lastCreditRefresh.getFullYear() === today.getFullYear();
        
        // If this is an upgrade and user hasn't received credits today, grant them immediate credits
        if (isUpgrade && !hasReceivedCreditsToday) {
          console.log(`🔄 Subscription upgrade detected: ${currentProfile.subscription_tier} -> ${tier}`);
          console.log(`💰 Granting immediate daily credits for tier: ${tier}`);
          
          // Determine credit amount based on tier
          const creditAmount = tier === 'ultra' ? 1000 : tier === 'pro' ? 100 : 30;
          
          try {
            // Call the add_user_credits function to add credits and record the transaction
            const { data: creditsData, error: creditsError } = await addUserCredits(
              supabase,
              userId,
              creditAmount,
              "plan_upgrade",
              `Immediate credits grant after upgrading to ${tier} plan`
            );
            
            if (creditsError) {
              console.error("❌ Error granting immediate credits:", creditsError);
            } else {
              console.log(`✅ Successfully granted ${creditAmount} credits after plan upgrade. New total: ${creditsData}`);
              
              // Update last_credit_refresh timestamp
              await supabase
                .from("profiles")
                .update({ 
                  last_credit_refresh: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq("id", userId);
            }
          } catch (err) {
            console.error("❌ Exception granting immediate credits:", err);
          }
        } else if (isUpgrade && hasReceivedCreditsToday) {
          console.log(`ℹ️ User already received credits today, skipping immediate credit grant`);
        }
      }

      // Record the subscription change in history
      try {
        await createSubscriptionHistory(supabase, {
          user_id: userId,
          subscription_tier: subscription.metadata?.tier || currentProfile?.subscription_tier || 'free',
          status: subscription.status,
          currency: subscription.currency || "usd",
          stripe_subscription_id: subscription.id
        });
      } catch (error) {
        console.error("Error recording subscription history:", error);
      }

      console.log(`✅ Updated profile for user ${userId}`);
    } catch (error) {
      console.error("❌ Error processing subscription change:", error);
      if (error instanceof Error) {
        console.error("❌ Error message:", error.message);
        console.error("❌ Error stack:", error.stack);
      }
    }
  }

  /**
   * Handle subscription cancelled event
   */
  private static async handleSubscriptionCancelled(
    subscription: StripeSubscription
  ) {
    const supabase = await AuthService.createServerClient();

    // Find the user ID from the customer metadata
    const customerId = subscription.customer;
    const stripe = this.getStripe();

    try {
      const customer = (await stripe.customers.retrieve(
        customerId
      )) as StripeCustomer;

      if (!customer || customer.deleted) {
        console.error("Customer not found or deleted");
        return;
      }

      const userId = customer.metadata?.userId;

      if (!userId) {
        console.error("No user ID in customer metadata");
        return;
      }

      // Update the user's subscription information to free tier
      try {
        const { error } = await (supabase as any)
          .from("profiles")
          .update({
            subscription_tier: "free",
            subscription_status: "canceled",
          })
          .eq("id", userId);

        if (error) {
          console.error("Error updating profile:", error);
          return;
        }
      } catch (error) {
        console.error("Error updating profile:", error);
      }

      // Record in subscription history
      try {
        await (supabase as any).from("subscription_history").insert({
          user_id: userId,
          subscription_tier: "free",
          status: "canceled",
          currency: subscription.currency || "usd",
          stripe_subscription_id: subscription.id,
        });
      } catch (error) {
        console.error("Error recording subscription history:", error);
      }

      console.log(`Cancelled subscription for user ${userId}`);
    } catch (error) {
      console.error("Error processing subscription cancellation:", error);
    }
  }

  /**
   * Handle invoice payment succeeded event
   */
  private static async handleInvoicePaymentSucceeded(invoice: StripeInvoice) {
    console.log(`Invoice payment succeeded: ${invoice.id}`);
    // Use admin client for any database operations if implemented in the future
  }

  /**
   * Handle invoice payment failed event
   */
  private static async handleInvoicePaymentFailed(invoice: StripeInvoice) {
    console.log(`Invoice payment failed: ${invoice.id}`);
    
    if (!invoice.customer || !invoice.subscription) {
      console.error(`❌ Missing customer or subscription ID in invoice`);
      return;
    }
    
    // Get the customer and change their subscription status
    const customerId = typeof invoice.customer === 'string' 
      ? invoice.customer 
      : invoice.customer.id;
      
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;
    
    try {
      // Use admin client for database operations
      const supabase = await AuthService.createAdminClient();
      
      // Update the profile with past_due status
      const { error } = await supabase
        .from('profiles')
        .update({ 
          subscription_status: 'past_due',
          updated_at: new Date().toISOString()
        })
        .eq('stripe_customer_id', customerId)
        .eq('stripe_subscription_id', subscriptionId);
        
      if (error) {
        console.error(`❌ Failed to update subscription status: ${error.message}`);
      } else {
        console.log(`✅ Updated subscription status to past_due for customer ${customerId}`);
      }
    } catch (err) {
      console.error(`❌ Error handling invoice payment failure:`, err);
    }
  }

  /**
   * Get the site URL based on environment
   */
  private static getSiteUrl(): string {
    return (
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : "http://localhost:3000")
    );
  }

  /**
   * Cancel a user's subscription
   */
  static async cancelSubscription(
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    const supabase = await AuthService.createServerClient();

    try {
      // Get the user's profile to find their Stripe customer ID
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("stripe_customer_id, subscription_tier")
        .eq("id", userId)
        .single();

      if (profileError || !profile) {
        throw new Error("User profile not found");
      }

      if (!profile.stripe_customer_id || profile.subscription_tier === "free") {
        throw new Error("No active subscription to cancel");
      }

      const stripe = this.getStripe();

      // Find the subscription ID
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: "active",
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        throw new Error("No active subscription found");
      }

      // Cancel the subscription
      await stripe.subscriptions.cancel(subscriptions.data[0].id);

      // Update the profile immediately
      try {
        await (supabase as any)
          .from("profiles")
          .update({
            subscription_tier: "free",
            subscription_status: "canceled",
          })
          .eq("id", userId);
      } catch (error) {
        console.error("Error updating profile after cancellation:", error);
      }

      // Add to subscription history
      try {
        await (supabase as any).from("subscription_history").insert({
          user_id: userId,
          subscription_tier: "free",
          status: "canceled",
          stripe_subscription_id: subscriptions.data[0].id,
        });
      } catch (error) {
        console.error(
          "Error recording subscription cancellation history:",
          error
        );
      }

      return {
        success: true,
        message:
          "Subscription successfully cancelled. Your account has been downgraded to the free tier.",
      };
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      return {
        success: false,
        message: `Failed to cancel subscription: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }
}

// Export for convenience
export const getStripe = PaymentService.getStripe.bind(PaymentService);
export const createSubscriptionCheckout =
  PaymentService.createSubscriptionCheckout.bind(PaymentService);
export const createCreditPurchaseCheckout =
  PaymentService.createCreditPurchaseCheckout.bind(PaymentService);
export const calculateCreditPrice =
  PaymentService.calculateCreditPrice.bind(PaymentService);
export const createOrRetrieveCustomer =
  PaymentService.getOrCreateCustomer.bind(PaymentService);
export const cancelSubscription =
  PaymentService.cancelSubscription.bind(PaymentService);
export const handleWebhookEvent =
  PaymentService.handleWebhookEvent.bind(PaymentService);
