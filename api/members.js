const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function mapMember(m) {
    return { id: m.id, name: m.name, role: m.role, username: m.username, email: m.email, createdAt: m.created_at };
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getClient();

    // GET — list all members
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('members').select('*').order('created_at', { ascending: true });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data.map(mapMember));
    }

    // POST — create member
    if (req.method === 'POST') {
        const { name, role, email, username } = req.body;
        const { data, error } = await supabase.from('members').insert([{
            name, role: role || null, email: email || null, username: username || null
        }]).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json(mapMember(data));
    }

    // DELETE — delete member + unassign their tasks (pass ?id=)
    if (req.method === 'DELETE') {
        const { id } = req.query;
        // Unassign tasks belonging to this member
        await supabase.from('tasks').update({ assignee_id: null }).eq('assignee_id', id);
        // Delete the member
        const { error } = await supabase.from('members').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
