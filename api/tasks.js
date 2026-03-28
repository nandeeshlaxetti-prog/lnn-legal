const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function mapTask(t) {
    return {
        id: t.id, title: t.title, client: t.client,
        caseNo: t.case_no, assigneeId: t.assignee_id,
        stage: t.stage, priority: t.priority,
        due: t.due, notes: t.notes, createdAt: t.created_at,
        attachments: t.attachments || []
    };
}

async function logActivity(supabase, taskId, userName, actionType, description) {
    if (!userName || !taskId) return;
    await supabase.from('activity_logs').insert([{
        task_id: taskId, user_name: userName, action_type: actionType, description
    }]);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getClient();

    // GET — list all tasks
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('tasks').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data.map(mapTask));
    }

    // POST — create task
    if (req.method === 'POST') {
        const { title, client, caseNo, assigneeId, stage, priority, due, notes, attachments, _userName } = req.body;
        const { data, error } = await supabase.from('tasks').insert([{
            title, client: client || null,
            case_no: caseNo || null,
            assignee_id: assigneeId || null,
            stage: stage || 'Drafting',
            priority: priority || 'medium',
            due: due || null,
            notes: notes || null,
            attachments: attachments || []
        }]).select().single();
        if (error) return res.status(500).json({ error: error.message });

        await logActivity(supabase, data.id, _userName || 'System', 'created', 'Task created');
        if (attachments && attachments.length > 0) {
            await logActivity(supabase, data.id, _userName || 'System', 'upload', `Attached ${attachments.length} document(s) during creation`);
        }

        return res.status(201).json(mapTask(data));
    }

    // PUT — update task
    if (req.method === 'PUT') {
        const { id } = req.query;
        const { title, client, caseNo, assigneeId, stage, priority, due, notes, attachments, _userName } = req.body;

        const { data: oldTask } = await supabase.from('tasks').select('*').eq('id', id).single();

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (client !== undefined) updates.client = client || null;
        if (caseNo !== undefined) updates.case_no = caseNo || null;
        if (assigneeId !== undefined) updates.assignee_id = assigneeId || null;
        if (stage !== undefined) updates.stage = stage;
        if (priority !== undefined) updates.priority = priority;
        if (due !== undefined) updates.due = due || null;
        if (notes !== undefined) updates.notes = notes || null;
        if (attachments !== undefined) updates.attachments = attachments;

        const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
        if (error) return res.status(500).json({ error: error.message });

        const uName = _userName || 'System';
        if (oldTask && data) {
            if (oldTask.stage !== data.stage) await logActivity(supabase, id, uName, 'stage', `Moved from "${oldTask.stage}" to "${data.stage}"`);
            if (oldTask.assignee_id !== data.assignee_id) {
                if (!data.assignee_id) await logActivity(supabase, id, uName, 'reassign', 'Unassigned the task');
                else await logActivity(supabase, id, uName, 'reassign', 'Re-assigned task to a new member');
            }
            if (oldTask.due !== data.due) {
                await logActivity(supabase, id, uName, 'edit', `Due date changed to ${data.due ? data.due : 'None'}`);
            }
            if (oldTask.priority !== data.priority) {
                await logActivity(supabase, id, uName, 'edit', `Priority changed to ${data.priority}`);
            }
            const oldAtt = oldTask.attachments || [];
            const newAtt = data.attachments || [];
            if (newAtt.length > oldAtt.length) {
                const addedCount = newAtt.length - oldAtt.length;
                await logActivity(supabase, id, uName, 'upload', `Attached ${addedCount} document(s)`);
            }
        }

        return res.json(mapTask(data));
    }

    // DELETE — delete task
    if (req.method === 'DELETE') {
        const { id } = req.query;
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
};
