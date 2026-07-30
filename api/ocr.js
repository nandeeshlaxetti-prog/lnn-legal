const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getClient();

    // ── POST: Save OCR text for a document ────────────────────────────────
    if (req.method === 'POST') {
        const { file_url, file_name, case_id, task_id, ocr_text, page_count } = req.body;
        if (!file_url) return res.status(400).json({ error: 'file_url is required' });

        const { data, error } = await supabase
            .from('documents_ocr')
            .upsert([{
                file_url,
                file_name: file_name || null,
                case_id: case_id || null,
                task_id: task_id || null,
                ocr_text: ocr_text || '',
                page_count: page_count || 1,
                status: ocr_text ? 'done' : 'failed'
            }], { onConflict: 'file_url' })
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json(data);
    }

    // ── GET: Three modes based on query params ────────────────────────────
    if (req.method === 'GET') {
        const { file_url, case_id, task_id, search } = req.query;

        // Mode 1: Full-text search across all indexed documents
        if (search) {
            if (search.trim().length < 2) {
                return res.status(400).json({ error: 'Search query must be at least 2 characters' });
            }

            let query = supabase
                .from('documents_ocr')
                .select('id, file_url, file_name, case_id, task_id, page_count, created_at, ocr_text')
                .ilike('ocr_text', `%${search.trim()}%`)
                .eq('status', 'done');

            if (case_id) query = query.eq('case_id', case_id);

            const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
            if (error) return res.status(500).json({ error: error.message });

            const results = (data || []).map(doc => {
                const text = doc.ocr_text || '';
                const idx = text.toLowerCase().indexOf(search.toLowerCase());
                let snippet = '';
                if (idx !== -1) {
                    const start = Math.max(0, idx - 80);
                    const end = Math.min(text.length, idx + search.length + 80);
                    snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
                }
                return { id: doc.id, file_url: doc.file_url, file_name: doc.file_name, case_id: doc.case_id, task_id: doc.task_id, page_count: doc.page_count, created_at: doc.created_at, snippet };
            });

            return res.json({ query: search, count: results.length, results });
        }

        // Mode 2: Fetch OCR record for a specific file URL
        if (file_url) {
            const { data, error } = await supabase
                .from('documents_ocr')
                .select('*')
                .eq('file_url', file_url);
            if (error) return res.status(500).json({ error: error.message });
            return res.json(data && data.length > 0 ? data[0] : null);
        }

        // Mode 3: Fetch all OCR records for a case or task
        if (case_id || task_id) {
            let query = supabase.from('documents_ocr').select('*');
            if (case_id) query = query.eq('case_id', case_id);
            if (task_id) query = query.eq('task_id', task_id);
            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) return res.status(500).json({ error: error.message });
            return res.json(data || []);
        }

        return res.status(400).json({ error: 'Provide file_url, case_id, task_id, or search param' });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
