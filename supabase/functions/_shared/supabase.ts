import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { requireEnv } from "./env.ts";

const supabaseUrl = requireEnv("SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// Service role client: bypasses RLS. iOS 앱에는 절대 노출하면 안 됨.
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

