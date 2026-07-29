const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const supabase = getClient();
    const { q, case_id } = req.query;

    if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    let query = supabase
        .from('documents_ocr')
        .select('id, file_url, file_name, case_id, task_id, page_count, created_at, ocr_text')
        .ilike('ocr_text', `%${q.trim()}%`)
        .eq('status', 'done');

    if (case_id) {
        query = query.eq('case_id', case_id);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ error: error.message });

    // Return results with a snippet around the matched keyword
    const results = data.map(doc => {
        const text = doc.ocr_text || '';
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        let snippet = '';
        if (idx !== -1) {
            const start = Math.max(0, idx - 80);
            const end = Math.min(text.length, idx + q.length + 80);
            snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
        }
        return {
            id: doc.id,
            file_url: doc.file_url,
            file_name: doc.file_name,
            case_id: doc.case_id,
            task_id: doc.task_id,
            page_count: doc.page_count,
            created_at: doc.created_at,
            snippet
        };
    });

    return res.json({ query: q, count: results.length, results });
};
