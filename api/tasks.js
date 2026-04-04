const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.office365.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function sendAssignmentEmail(supabase, taskDetails, assigneeId, assignerName) {
    if (!assigneeId || !process.env.EMAIL_USER) return;
    const { data: member } = await supabase.from('members').select('email, name').eq('id', assigneeId).single();
    if (!member || !member.email) return;

    const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="background-color: #1e1e24; padding: 20px; text-align: center; border-bottom: 3px solid #d4af37;">
                <h1 style="color: #d4af37; margin: 0; font-size: 24px;">LNN Legal</h1>
                <p style="color: #9ca3af; margin: 5px 0 0 0; font-size: 14px;">Case Management System</p>
            </div>
            <div style="padding: 30px; background-color: #ffffff;">
                <h2 style="margin-top: 0; color: #111827; font-size: 20px;">New Task Assigned</h2>
                <p style="font-size: 15px; color: #4b5563; line-height: 1.5;">Hello <strong>${member.name}</strong>,</p>
                <p style="font-size: 15px; color: #4b5563; line-height: 1.5;"><strong>${assignerName}</strong> has assigned a new task to you.</p>
                <div style="background-color: #f9fafb; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0; border-radius: 0 4px 4px 0;">
                    <h3 style="margin: 0 0 10px 0; color: #1f2937; font-size: 16px;">${taskDetails.title}</h3>
                    ${taskDetails.case_no ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Case No:</strong> ${taskDetails.case_no}</p>` : ''}
                    ${taskDetails.client ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Client:</strong> ${taskDetails.client}</p>` : ''}
                    ${taskDetails.due ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Due Date:</strong> ${taskDetails.due}</p>` : ''}
                </div>
                <div style="text-align: center; margin-top: 30px;">
                    <a href="https://lnn-legal.vercel.app/" style="display: inline-block; background-color: #d4af37; color: #111827; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px;">Open Dashboard</a>
                </div>
            </div>
            <div style="background-color: #f3f4f6; color: #6b7280; text-align: center; padding: 15px; font-size: 12px;">This is an automated notification from the LNN Legal Management System. Please do not reply directly.</div>
        </div>`;

    await transporter.sendMail({
        from: `"LNN Legal Alerts" <${process.env.EMAIL_USER}>`,
        to: member.email,
        subject: `Requires Action: New Task Assigned - ${taskDetails.title}`,
        html: emailHtml
    }).catch(console.error);
}

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function mapTask(t) {
    return {
        id: t.id, 
        title: t.title,
        description: t.notes,
        assigneeId: t.assignee_id, // Modern
        assignee_id: t.assignee_id, // Legacy compatibility
        stage: t.stage, 
        priority: t.priority,
        due: t.due, 
        notes: t.notes, 
        caseId: t.case_id,
        case_id: t.case_id,
        createdAt: t.created_at,
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
        const { 
            title, description, stage, priority, due, 
            assignee_id, case_id, attachments, _userName
        } = req.body;
        
        const { data, error } = await supabase.from('tasks').insert([{
            title: title || 'New Task',
            notes: description || null, // Map description back to notes column
            stage: stage || 'Reading/Brief',
            priority: priority || 'medium',
            due: due || null,
            assignee_id: assignee_id || null,
            case_id: case_id || null,
            attachments: attachments || []
        }]).select().single();
        if (error) return res.status(500).json({ error: error.message });

        await logActivity(supabase, data.id, _userName || 'System', 'created', 'Task created');
        if (attachments && attachments.length > 0) {
            await logActivity(supabase, data.id, _userName || 'System', 'upload', `Attached ${attachments.length} document(s) during creation`);
        }

        if (data.assignee_id) await sendAssignmentEmail(supabase, data, data.assignee_id, _userName || 'System');

        return res.status(201).json(mapTask(data));
    }

    // PUT — update task
    if (req.method === 'PUT') {
        const { id } = req.query;
        const { _userName } = req.body;

        const { 
            title, description, stage, priority, due, 
            assignee_id, case_id, attachments
        } = req.body;

        const { data: oldTask } = await supabase.from('tasks').select('*').eq('id', id).single();
        
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.notes = description; // Map back to notes
        if (stage !== undefined) updates.stage = stage;
        if (priority !== undefined) updates.priority = priority;
        if (due !== undefined) updates.due = due || null; // Fix: convert "" to null
        if (assignee_id !== undefined) updates.assignee_id = assignee_id;
        if (case_id !== undefined) updates.case_id = case_id || null;
        if (attachments !== undefined) updates.attachments = attachments;

        const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
        if (error) return res.status(500).json({ error: error.message });

        const uName = _userName || 'System';
        if (oldTask && data) {
            if (oldTask.stage !== data.stage) await logActivity(supabase, id, uName, 'stage', `Moved from "${oldTask.stage}" to "${data.stage}"`);
            if (oldTask.assignee_id !== data.assignee_id) {
                if (!data.assignee_id) await logActivity(supabase, id, uName, 'reassign', 'Unassigned the task');
                else {
                    await logActivity(supabase, id, uName, 'reassign', 'Re-assigned task to a new member');
                    await sendAssignmentEmail(supabase, data, data.assignee_id, uName);
                }
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
