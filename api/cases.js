const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getClient();

    // GET — list all cases
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('cases').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    // POST — create case
    if (req.method === 'POST') {
        const { 
            case_type, case_no, case_year, court_name, court_hall, 
            petitioner_type, petitioner, respondent_type, respondent, 
            appearing_for, partner_id, notes, attachments,
            stage, next_hearing, purpose,
            hearing_history, cnr
        } = req.body;
        
        const { data, error } = await supabase.from('cases').insert([{
            case_type: case_type || null,
            case_no: case_no || null,
            case_year: case_year || null,
            court_name: court_name || null,
            court_hall: court_hall || null,
            petitioner_type: petitioner_type || 'Petitioner',
            petitioner: petitioner || null,
            respondent_type: respondent_type || 'Respondent',
            respondent: respondent || null,
            appearing_for: appearing_for || 'Petitioner',
            partner_id: partner_id || null,
            notes: notes || null,
            attachments: attachments || [],
            stage: stage || 'Admission / Fresh Filing',
            next_hearing: next_hearing || null,
            purpose: purpose || null,
            hearing_history: hearing_history || [],
            cnr: cnr || null
        }]).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json(data);
    }

    // PUT — update case
    if (req.method === 'PUT') {
        const { id } = req.query;
        const { 
            case_type, case_no, case_year, court_name, court_hall, 
            petitioner_type, petitioner, respondent_type, respondent, 
            appearing_for, partner_id, notes, attachments,
            stage, next_hearing, purpose,
            hearing_history, cnr
        } = req.body;
        
        const updates = {};
        if (case_type !== undefined) updates.case_type = case_type || null;
        if (case_no !== undefined) updates.case_no = case_no || null;
        if (case_year !== undefined) updates.case_year = case_year || null;
        if (court_name !== undefined) updates.court_name = court_name || null;
        if (court_hall !== undefined) updates.court_hall = court_hall || null;
        if (petitioner_type !== undefined) updates.petitioner_type = petitioner_type;
        if (petitioner !== undefined) updates.petitioner = petitioner || null;
        if (respondent_type !== undefined) updates.respondent_type = respondent_type;
        if (respondent !== undefined) updates.respondent = respondent || null;
        if (appearing_for !== undefined) updates.appearing_for = appearing_for;
        if (partner_id !== undefined) updates.partner_id = partner_id || null;
        if (notes !== undefined) updates.notes = notes || null;
        if (attachments !== undefined) updates.attachments = attachments;
        if (cnr !== undefined) updates.cnr = cnr || null;
        
        if (stage !== undefined) updates.stage = stage;
        if (next_hearing !== undefined) updates.next_hearing = next_hearing || null;
        if (purpose !== undefined) updates.purpose = purpose || null;
        if (hearing_history !== undefined) updates.hearing_history = hearing_history;

        const { data, error } = await supabase.from('cases').update(updates).eq('id', id).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    // DELETE — delete case
    if (req.method === 'DELETE') {
        const { id } = req.query;
        const { error } = await supabase.from('cases').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
