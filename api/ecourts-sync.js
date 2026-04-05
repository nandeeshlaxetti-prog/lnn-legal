const { createClient } = require('@supabase/supabase-js');
// eCourtsIndia Partner Sync utilizing Native Fetch (Node 18+)

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { caseId, cnr } = req.body;
    const apiKey = process.env.ECOURTS_INDIA_TOKEN; // Bearer eci_live_...

    if (!apiKey) {
        return res.status(500).json({ error: "eCourtsIndia Partner API Token missing from environment variables." });
    }

    if (!cnr) {
        return res.status(400).json({ error: "CNR number is required for synchronization." });
    }

    try {
        // 1. Fetch from eCourtsIndia Partner REST API
        const response = await fetch(`https://webapi.ecourtsindia.com/api/partner/case/${cnr}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) throw new Error(`eCourts Fetch Failed: ${response.statusText}`);
        const result = await response.json();
        const courtData = result.data?.courtCaseData;

        if (!courtData) return res.status(404).json({ error: "No case data found for this CNR." });

        // 2. Map to LNN Legal Schema
        const nextH = courtData.nextHearingDate || null;
        const purpose = courtData.caseStatus || "Scheduled Hearing";
        
        // 3. Update Supabase
        const supabase = getClient();
        const { data, error } = await supabase
            .from('cases')
            .update({
                next_hearing: nextH,
                purpose: purpose,
                case_status: courtData.caseStatus,
                ecourts_last_sync: new Date().toISOString()
            })
            .eq('id', caseId)
            .select()
            .single();

        if (error) throw error;

        return res.json({ 
            success: true, 
            updated: data, 
            raw: courtData,
            message: `Case synchronized successfully. Next date: ${nextH || 'Not Announced'}` 
        });
        
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Bridge to eCourtsIndia failed. Check CNR and API Token." });
    }
};
