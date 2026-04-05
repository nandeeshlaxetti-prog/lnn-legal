const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Build a rich context string from live database
function buildContext(members, tasks, cases, contextCase) {
    const lines = [];

    // Member details with workload
    lines.push('=== TEAM MEMBERS ===');
    members.forEach(m => {
        const active = tasks.filter(t => (t.assignee_id === m.id) && t.stage !== 'Completed');
        const completed = tasks.filter(t => (t.assignee_id === m.id) && t.stage === 'Completed');
        lines.push(`• ${m.name} (${m.role || 'Member'}) — ${active.length} active tasks, ${completed.length} completed`);
        if (active.length > 0) {
            active.forEach(t => lines.push(`    - "${t.title}" [${t.stage}] ${t.priority ? `Priority: ${t.priority}` : ''} ${t.due ? `Due: ${t.due}` : ''}`));
        }
    });

    // Cases
    lines.push('\n=== ACTIVE CASES ===');
    cases.forEach(c => {
        const partner = members.find(m => m.id === c.partner_id);
        lines.push(`• ${c.case_type} No. ${c.case_no}/${c.case_year} — ${c.petitioner} vs ${c.respondent}`);
        lines.push(`    Court: ${c.court_name || '—'} | Next Hearing: ${c.next_hearing || 'Not set'} | Partner: ${partner ? partner.name : '—'}`);
        if (c.purpose) lines.push(`    Purpose: ${c.purpose}`);
    });

    // Task summary by stage
    lines.push('\n=== TASK PIPELINE ===');
    const stages = ['Reading/Brief', 'Research', 'Drafting', 'Review', 'Client Response', 'Filing', 'Pending Works', 'Completed'];
    stages.forEach(s => {
        const count = tasks.filter(t => t.stage === s).length;
        if (count > 0) lines.push(`• ${s}: ${count} tasks`);
    });

    // Overdue tasks
    const today = new Date().toISOString().split('T')[0];
    const overdue = tasks.filter(t => t.due && t.due < today && t.stage !== 'Completed');
    if (overdue.length > 0) {
        lines.push('\n=== ⚠️ OVERDUE TASKS ===');
        overdue.forEach(t => {
            const m = members.find(x => x.id === t.assignee_id);
            lines.push(`• "${t.title}" — Due: ${t.due}, Assigned to: ${m ? m.name : 'Unassigned'}`);
        });
    }

    // Active case context
    if (contextCase) {
        lines.push(`\n=== CURRENTLY VIEWING CASE ===`);
        lines.push(`${contextCase.case_type} No. ${contextCase.case_no}/${contextCase.case_year}`);
        lines.push(`${contextCase.petitioner} vs ${contextCase.respondent}`);
        lines.push(`Court: ${contextCase.court_name || '—'}`);
        lines.push(`Next Hearing: ${contextCase.next_hearing || 'Not set'}`);
        if (contextCase.notes) lines.push(`Brief: ${contextCase.notes}`);
    }

    return lines.join('\n');
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { query, contextCase } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // Fetch live data from database
    let members = [], tasks = [], cases = [];
    try {
        const supabase = getClient();
        const [mRes, tRes, cRes] = await Promise.all([
            supabase.from('members').select('*'),
            supabase.from('tasks').select('*').order('created_at', { ascending: false }),
            supabase.from('cases').select('*')
        ]);
        members = mRes.data || [];
        tasks = tRes.data || [];
        cases = cRes.data || [];
    } catch (e) {
        console.error('Brain DB fetch error:', e);
    }

    const context = buildContext(members, tasks, cases, contextCase);

    if (!apiKey) {
        return res.json({ answer: "⚠️ Gemini API key not configured. Add GEMINI_API_KEY to your Vercel environment variables." });
    }

    const systemPrompt = `You are the "LNN Legal Brain", a senior AI litigation strategy assistant for a law firm in Bengaluru, India. You specialize in Indian High Court and District Court proceedings.

You have LIVE access to the firm's complete database. Use this data to answer questions precisely.

${context}

USER QUESTION: ${query}

INSTRUCTIONS:
- Answer based on the ACTUAL DATA above. Reference real names, case numbers, and dates.
- If asked about a person, find them in the team list and describe their current assignments.
- If asked about workload, give specific numbers and task names.
- If asked about cases, reference the actual case numbers and parties.
- If asked about deadlines, check the due dates and next hearing dates.
- Be concise but thorough. Use bullet points for lists.
- You are an office strategy assistant — frame advice professionally but don't give definitive legal opinions.
- Respond in clear English. Keep responses under 300 words unless the user asks for detail.`;

    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1024
                    }
                })
            }
        );

        const gData = await geminiRes.json();
        
        if (gData.error) {
            console.error('Gemini API error:', gData.error);
            return res.json({ answer: `⚠️ Gemini Error: ${gData.error.message || 'Unknown error'}` });
        }

        const answer = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) {
            console.error('Gemini empty response:', JSON.stringify(gData));
            return res.json({ answer: '⚠️ Gemini returned an empty response. Check API key permissions.' });
        }
        
        return res.json({ answer });
    } catch (err) {
        console.error('Brain error:', err);
        return res.status(500).json({ answer: `⚠️ Connection to Gemini failed: ${err.message}` });
    }
};
