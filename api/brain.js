const fetch = require('node-fetch');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { query, contextCase, data } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.json({ answer: "⚠️ AI Brain configuration missing. Please provide your Gemini API key in the environment variables." });
    }

    // CONTEXT READY: STRUCTURE THE LITIGATION DATA
    const caseStr = data.cases.map(c => `${c.case_type} No. ${c.case_no}/${c.case_year} (${c.petitioner} vs ${c.respondent})`).join('\n');
    const taskStr = data.tasks.slice(0, 15).map(t => `${t.title} [${t.stage}]`).join('\n'); // Sample Tasks

    const systemPrompt = `You are the "LNN Legal Brain", a senior AI litigation associate expert in Indian High Court and District Court proceedings.
You have access to the firm's dashboard data. Be professional, high-density, and precise.

FIRM DATA:
CASES:
${caseStr}

RECENT TASKS:
${taskStr}

ACTIVE CASE CONTEXT:
${contextCase ? `${contextCase.case_type} No. ${contextCase.case_no}/${contextCase.case_year}. Brief: ${contextCase.notes || 'None'}` : 'None'}

USER QUERY:
${query}

Instructions:
1. If the user asks for a briefing, summarize the active case succinctly.
2. If the user asks about the dashboard, use the data provided.
3. Be helpful but do not give definitive legal advice—always frame it as an office strategy assistant.`;

    try {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });

        const gData = await geminiRes.json();
        const answer = gData.candidates?.[0]?.content?.parts?.[0]?.text || "Strategy generated. Proceed with litigation actions.";
        
        return res.json({ answer });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Brain synchronization failed." });
    }
};
