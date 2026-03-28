import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://bzggladwagieulssfjko.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6Z2dsYWR3YWdpZXVsc3NmamtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM3NTEsImV4cCI6MjA4OTQ2OTc1MX0.2WjfiIL1eO1y11V0hUjF98xAt2MCErEThhR2xPfJfx8'
export const supabase = createClient(supabaseUrl, supabaseKey)
