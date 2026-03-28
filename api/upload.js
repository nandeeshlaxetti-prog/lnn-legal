const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = getClient();
        const { fileName, fileData, mimeType } = req.body;

        if (!fileName || !fileData) return res.status(400).json({ error: 'Missing file data' });

        // Convert base64 to buffer
        const buffer = Buffer.from(fileData, 'base64');

        // Sanitize filename and add timestamp to avoid collisions
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const path = `${Date.now()}_${safeName}`;

        const { data, error } = await supabase.storage.from('documents').upload(path, buffer, {
            contentType: mimeType || 'application/octet-stream',
            upsert: false
        });

        if (error) {
            // Auto-format bucket error so it's clear
            if (error.message.includes('bucket')) {
                return res.status(500).json({ error: 'Bucket "documents" does not exist in Supabase.' });
            }
            return res.status(500).json({ error: error.message });
        }

        // Get public URL
        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);

        return res.status(200).json({ name: fileName, url: urlData.publicUrl });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
