import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth';

export async function GET(_req: NextRequest) {
  try {
    console.log('🧪 Testing admin client for webhook operations');
    
    // Create an admin client using the service role key
    const supabase = await AuthService.createAdminClient();
    
    // Test a simple query to verify the client works
    const { data, error } = await supabase.from('profiles').select('id').limit(1);
    
    if (error) {
      console.error('❌ Admin client test failed:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message,
        details: 'Admin client failed to query profiles table'
      }, { status: 500 });
    }
    
    // Return success response with the test results
    return NextResponse.json({ 
      success: true, 
      message: 'Admin client successfully queried profiles table',
      data
    });
  } catch (error) {
    console.error('❌ Unexpected error in admin client test:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'Unexpected error occurred during admin client test'
    }, { status: 500 });
  }
} 