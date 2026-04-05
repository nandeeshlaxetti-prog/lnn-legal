module.exports = async (req, res) => {
    const report = {
        supabase_url: process.env.SUPABASE_URL ? '✅ Configured' : '❌ MISSING',
        supabase_key: process.env.SUPABASE_SERVICE_KEY ? '✅ Configured' : '❌ MISSING',
        gemini_ai: process.env.GEMINI_API_KEY ? '✅ Configured' : '⚠️ NOT LINKED (Optional)',
        ecourts_api: process.env.ECOURTS_INDIA_TOKEN ? '✅ Configured' : '⚠️ NOT LINKED (Optional)',
        email_alerts: process.env.EMAIL_USER ? '✅ Configured' : '⚠️ NOT LINKED (Optional)',
        timestamp: new Date().toISOString()
    };
    
    // Check if any critical keys are missing
    const criticalMissing = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    res.status(criticalMissing ? 500 : 200).json({
        status: criticalMissing ? 'error' : 'operational',
        report
    });
};
