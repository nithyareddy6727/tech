import 'dotenv/config';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  port: Number(process.env.PORT || 5000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  llmApiKey: process.env.LLM_API_KEY,
  llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173'
};