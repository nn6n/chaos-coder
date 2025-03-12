import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * Helper function to safely call database RPC functions with proper typing
 * This works around type issues with the supabase.rpc method
 */
export function callDatabaseFunction<T = unknown, P extends Record<string, unknown> = Record<string, unknown>>(
  supabase: SupabaseClient<Database>,
  functionName: string,
  params: P
): Promise<{ data: T | null; error: Error | null }> {
  // We need to use type assertion here because the Supabase types don't properly support
  // dynamic function names for RPC calls
  return (supabase as unknown as {
    rpc(fn: string, params: P): Promise<{ data: T | null; error: Error | null }>;
  }).rpc(functionName, params);
}

/**
 * Helper function specifically for add_user_credits
 */
export function addUserCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  amount: number,
  type = 'purchase',
  description?: string
): Promise<{ data: number | null; error: Error | null }> {
  return callDatabaseFunction<number>(supabase, 'add_user_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_description: description
  });
}

/**
 * Interface for credit purchase data
 */
export interface CreditPurchase {
  user_id: string;
  amount: number;
  price_paid: number;
  currency: string;
  stripe_session_id: string;
  stripe_payment_intent_id?: string;
}

/**
 * Helper function to safely create a credit purchase record
 */
export async function createCreditPurchase(
  supabase: SupabaseClient<Database>,
  purchase: CreditPurchase
): Promise<{ data: any; error: Error | null }> {
  // Use type assertion because the Database type doesn't fully match the actual schema
  return (supabase as unknown as {
    from(table: string): {
      insert(data: CreditPurchase): Promise<{ data: any; error: Error | null }>;
    }
  }).from('credit_purchases').insert(purchase);
}

/**
 * Helper function to safely create a subscription history record
 */
export interface SubscriptionHistory {
  user_id: string;
  subscription_tier: string;
  status: string;
  currency?: string;
  stripe_subscription_id?: string;
  amount_paid?: number;
  description?: string;
}

export async function createSubscriptionHistory(
  supabase: SupabaseClient<Database>,
  history: SubscriptionHistory
): Promise<{ data: any; error: Error | null }> {
  // Use type assertion because the Database type doesn't fully match the actual schema
  return (supabase as unknown as {
    from(table: string): {
      insert(data: SubscriptionHistory): Promise<{ data: any; error: Error | null }>;
    }
  }).from('subscription_history').insert(history);
} 