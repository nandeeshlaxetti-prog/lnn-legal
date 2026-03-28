module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

        // Append the internal suffix to convert the simple username to a secure Supabase email
        const email = `${username.toLowerCase()}@lnnlegal.internal`;
        const authUrl = `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`;

        // We use the dynamic native fetch in API routes
        const fetch = globalThis.fetch || require('node-fetch');

        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error_description || data.message || 'Invalid credentials' });
        }

        return res.status(200).json({ success: true, username });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
