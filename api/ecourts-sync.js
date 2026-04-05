const { createClient } = require('@supabase/supabase-js');

function getClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { caseId, cnr } = req.body;
    const apiKey = process.env.ECOURTS_INDIA_TOKEN;

    if (!apiKey) {
        return res.status(500).json({ error: "eCourts India API Token missing. Add ECOURTS_INDIA_TOKEN to Vercel env vars." });
    }
    if (!cnr) {
        return res.status(400).json({ error: "CNR number is required for synchronization." });
    }

    try {
        // 1. Trigger a live refresh from eCourts servers first
        try {
            await fetch(`https://webapi.ecourtsindia.com/api/partner/case/${cnr}/refresh`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            // Wait for the scrape to complete (API says 5-10 min, but often faster)
            await new Promise(r => setTimeout(r, 8000));
        } catch (e) { /* refresh is best-effort, continue with fetch */ }

        // 2. Fetch case data (now hopefully refreshed)
        const response = await fetch(`https://webapi.ecourtsindia.com/api/partner/case/${cnr}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error?.message || `eCourts returned HTTP ${response.status}`);
        }

        const result = await response.json();
        const courtData = result.data?.courtCaseData;
        const entityInfo = result.data?.entityInfo;

        if (!courtData) {
            return res.status(404).json({ error: "No case data found for this CNR on eCourts." });
        }

        // 2. Extract key fields — prefer hearing history's last entry (more reliable than entityInfo)
        const hearings = courtData.historyOfCaseHearings || [];
        const lastHistoryEntry = hearings.length > 0 ? hearings[hearings.length - 1] : null;
        
        // The most recent hearing's "hearingDate" field = the actual next date posted by the court
        const nextFromHistory = lastHistoryEntry?.hearingDate || null;
        const nextFromEntity = entityInfo?.nextDateOfHearing 
            ? entityInfo.nextDateOfHearing.split('T')[0] 
            : null;
        
        // Use whichever is later (most up-to-date)
        const nextHearing = (nextFromHistory && nextFromEntity) 
            ? (nextFromHistory > nextFromEntity ? nextFromHistory : nextFromEntity)
            : nextFromHistory || nextFromEntity;
        
        const lastHearing = lastHistoryEntry?.businessOnDate 
            || (entityInfo?.lastDateOfHearing ? entityInfo.lastDateOfHearing.split('T')[0] : null);
        const caseStatus = courtData.caseStatus || 'Unknown';
        const judges = (courtData.judges || []).join(', ');
        
        // Build hearing history from eCourts data
        const hearingHistory = (courtData.historyOfCaseHearings || []).map(h => ({
            date: h.businessOnDate,
            purpose: h.purposeOfListing || 'Hearing',
            result: h.hearingDate ? `Next: ${h.hearingDate}` : 'Disposed',
            judge: h.judge || ''
        }));

        // 3. Update in Supabase
        if (caseId) {
            const supabase = getClient();
            
            // Try updating with all fields first
            let updateData = {
                next_hearing: nextHearing,
                hearing_history: hearingHistory,
                purpose: caseStatus,
            };

            // Try adding optional columns (they may not exist in schema)
            try {
                // First attempt with all fields
                const { data, error } = await supabase
                    .from('cases')
                    .update(updateData)
                    .eq('id', caseId)
                    .select()
                    .single();

                if (error) {
                    // If it fails (likely missing columns), try minimal update
                    console.error('Full update failed, trying minimal:', error.message);
                    const { data: minData, error: minError } = await supabase
                        .from('cases')
                        .update({ next_hearing: nextHearing, purpose: caseStatus })
                        .eq('id', caseId)
                        .select()
                        .single();
                    
                    if (minError) throw minError;
                    
                    // Manually attach hearing history to the response even if DB doesn't store it
                    minData.hearing_history = hearingHistory;
                    return res.json({
                        success: true,
                        updated: minData,
                        message: `✅ Synced (partial). Next: ${nextHearing || 'Not announced'}. ${hearingHistory.length} hearings found. Note: Add 'hearing_history' column to Supabase for full timeline.`
                    });
                }

                return res.json({
                    success: true,
                    updated: data,
                    message: `✅ Synced from eCourts. Status: ${caseStatus}. Next: ${nextHearing || 'Not announced'}. ${hearingHistory.length} hearing records imported.`
                });
            } catch (dbErr) {
                console.error('Supabase update error:', dbErr);
                return res.status(500).json({ error: `Database update failed: ${dbErr.message}` });
            }
        }

        // If no caseId, just return the raw data for preview
        return res.json({
            success: true,
            preview: {
                caseType: courtData.caseTypeRaw || courtData.caseType,
                caseNo: courtData.filingNumber,
                petitioners: courtData.petitioners,
                respondents: courtData.respondents,
                court: result.data?.descriptions?.enumLookup?.courtCode?.[courtData.cnrCourtCode] || courtData.courtName,
                status: caseStatus,
                nextHearing,
                lastHearing,
                judges,
                hearingCount: courtData.hearingCount,
                orderCount: courtData.orderCount,
                hearingHistory
            },
            message: `eCourts data fetched. ${courtData.petitioners?.[0] || ''} vs ${courtData.respondents?.[0] || ''}`
        });

    } catch (err) {
        console.error('eCourts sync error:', err);
        return res.status(500).json({ error: err.message || "Bridge to eCourts India failed." });
    }
};
