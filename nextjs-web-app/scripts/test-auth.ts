const fs = require('fs');
const path = require('path');

async function testAuth() {
  console.log('Testing Supabase Auth SSR implementation...');
  
  const authDir = path.join(__dirname, '../src/lib/auth');
  const files = fs.readdirSync(authDir);
  
  console.log('Auth directory contains:', files);
  
  // Check for required files
  const requiredFiles = ['client.ts', 'server.ts', 'index.ts', 'service.ts'];
  const missingFiles = requiredFiles.filter(file => !files.includes(file));
  
  if (missingFiles.length > 0) {
    console.error('Missing required files:', missingFiles);
    process.exit(1);
  }
  
  // Check middleware.ts
  const middlewarePath = path.join(__dirname, '../middleware.ts');
  if (!fs.existsSync(middlewarePath)) {
    console.error('Missing middleware.ts file');
    process.exit(1);
  }
  
  // Check if index.ts exports what we need
  const indexContent = fs.readFileSync(path.join(authDir, 'index.ts'), 'utf8');
  const indexExportsAuthService = indexContent.includes('export { AuthService }');
  const indexExportsBrowserClient = indexContent.includes('createBrowserClient');
  const indexExportsServerClient = indexContent.includes('createServerClient');
  
  if (!indexExportsAuthService) {
    console.error('❌ AuthService is not exported from index.ts');
    process.exit(1);
  }
  
  if (!indexExportsBrowserClient) {
    console.error('❌ createBrowserClient is not exported from index.ts');
    process.exit(1);
  }
  
  if (!indexExportsServerClient) {
    console.error('❌ createServerClient is not exported from index.ts');
    process.exit(1);
  }
  
  console.log('✅ index.ts exports required functions');
  console.log('✅ All required auth files are present');
  console.log('✅ Auth implementation is correctly structured');
  console.log('Test complete.');
}

testAuth().catch(console.error); 