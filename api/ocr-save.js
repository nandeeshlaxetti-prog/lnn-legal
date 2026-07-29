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

    // POST — save OCR result
    if (req.method === 'POST') {
        const { file_url, file_name, case_id, task_id, ocr_text, page_count } = req.body;

        if (!file_url) return res.status(400).json({ error: 'file_url is required' });

        // Upsert: if this file_url already has an OCR record, update it
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

    // GET — fetch OCR text for a specific file URL
    if (req.method === 'GET') {
        const { file_url, case_id, task_id } = req.query;

        let query = supabase.from('documents_ocr').select('*');

        if (file_url) {
            query = query.eq('file_url', file_url);
        } else if (case_id) {
            query = query.eq('case_id', case_id).order('created_at', { ascending: false });
        } else if (task_id) {
            query = query.eq('task_id', task_id).order('created_at', { ascending: false });
        } else {
            return res.status(400).json({ error: 'Provide file_url, case_id, or task_id' });
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json(file_url ? (data[0] || null) : data);
    }

    res.status(405).json({ error: 'Method not allowed' });
};
