const { createClient } = require('@supabase/supabase-js');

// Increase Vercel Serverless maximum payload to match our UI limits (4.5MB)
module.exports.config = {
    api: {
        bodyParser: {
            sizeLimit: '4.5mb'
        }
    }
};

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports.default = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const supabase = getClient();
        const { fileName, fileData, mimeType } = req.body;

        if (!fileName || !fileData) return res.status(400).json({ error: 'Missing file data' });

        const buffer = Buffer.from(fileData, 'base64');

        // Sanitize to avoid illegal folder paths
        const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const path = `${Date.now()}_${safeName}`;

        const { data, error } = await supabase.storage.from('documents').upload(path, buffer, {
            contentType: mimeType || 'application/octet-stream',
            upsert: false
        });

        if (error) {
            console.error('Supabase Error:', error);
            if (error.message.includes('bucket')) {
                return res.status(500).json({ error: 'Bucket "documents" missing or is not Public.' });
            }
            return res.status(500).json({ error: error.message });
        }

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);

        return res.status(200).json({ name: fileName, url: urlData.publicUrl });
    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: err.message });
    }
};

// Also assign to module.exports for Vercel's older routing syntax
module.exports = Object.assign(module.exports.default, module.exports);
