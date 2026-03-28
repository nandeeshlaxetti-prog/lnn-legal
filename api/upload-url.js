const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { fileName } = req.body;

        if (!fileName) return res.status(400).json({ error: 'Missing file name' });

        // Sanitize to avoid illegal folder paths
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const path = `${Date.now()}_${safeName}`;

        // Create a secure direct-to-storage signed URL (bypassing Vercel's 4.5MB limit entirely)
        const { data, error } = await supabase.storage.from('documents').createSignedUploadUrl(path);

        if (error) {
            console.error('Signed URL Error:', error);
            return res.status(500).json({ error: error.message });
        }

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);

        return res.status(200).json({
            signedUrl: data.signedUrl,
            token: data.token,
            publicUrl: urlData.publicUrl
        });
    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: err.message });
    }
};
