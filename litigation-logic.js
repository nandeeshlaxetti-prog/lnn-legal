// ============================================================
// LNN LEGAL — DIGITAL BRIEFCASE v4.0.0 (MASTER BUILD)
// ============================================================
console.log('LNN_MASTER: Synchronizing Corporate Litigation Engine...');

const DB = { tasks: [], members: [], cases: [] };
let currentCaseInView = null; 

// ============================================================
// API LAYER — Global Dispatcher
// ============================================================
const API = {
    async request(url, options = {}) {
        try {
            const res = await fetch(url, {
                headers: { 'Content-Type': 'application/json' },
                ...options,
                body: options.body ? JSON.stringify(options.body) : undefined
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return res.json();
        } catch (e) {
            console.error(`LNN_API_ERROR [${url}]:`, e);
            throw e;
        }
    },
    getTasks() { return this.request('/api/tasks'); },
    getCases() { return this.request('/api/cases'); },
    getMembers() { return this.request('/api/members'); },
    getLogs(id) { return this.request(`/api/logs?taskId=${id}`); },
    loginUser(data) { return this.request('/api/login', { method: 'POST', body: data }); },
    uploadFile(data) { return this.request('/api/upload', { method: 'POST', body: data }); },
    getSignUrl(data) { return this.request('/api/upload-url', { method: 'POST', body: data }); },
    updateTask(id, data) { return this.request(`/api/tasks?id=${id}`, { method: 'PUT', body: data }); },
    updateCase(id, data) { return this.request(`/api/cases?id=${id}`, { method: 'PUT', body: data }); },
    deleteTask(id) { return this.request(`/api/tasks?id=${id}`, { method: 'DELETE' }); },
    deleteCase(id) { return this.request(`/api/cases?id=${id}`, { method: 'DELETE' }); },
    createTask(data) { return this.request('/api/tasks', { method: 'POST', body: data }); },
    createCase(data) { return this.request('/api/cases', { method: 'POST', body: data }); },
    createMember(data) { return this.request('/api/members', { method: 'POST', body: data }); },
    updateMember(id, data) { return this.request(`/api/members?id=${id}`, { method: 'PUT', body: data }); },
    deleteMember(id) { return this.request(`/api/members?id=${id}`, { method: 'DELETE' }); }
};

// ============================================================
// UTILITIES & CONSTANTS
// ============================================================
const STAGES = ['Reading/Brief', 'Research', 'Drafting', 'Review', 'Client Response', 'Filing', 'Pending Works', 'Completed'];
const STAGE_META = {
    'Reading/Brief': { dot: '#8b5cf6', cls: 'badge-reading' },
    'Research': { dot: '#0ea5e9', cls: 'badge-research' },
    'Drafting': { dot: '#6366f1', cls: 'badge-drafting' },
    'Review': { dot: '#f59e0b', cls: 'badge-review' },
    'Client Response': { dot: '#84cc16', cls: 'badge-response' },
    'Filing': { dot: '#3b82f6', cls: 'badge-filing' },
    'Pending Works': { dot: '#ef4444', cls: 'badge-pending' },
    'Completed': { dot: '#10b981', cls: 'badge-completed' }
};
const PRIORITY_META = {
    high: { cls: 'pill-high', color: '#ef4444', label: '🔴 High' },
    medium: { cls: 'pill-medium', color: '#f59e0b', label: '🟡 Medium' },
    low: { cls: 'pill-low', color: '#10b981', label: '🟢 Low' },
};

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function today() { return fmtDate(new Date()); }
function initials(name) { return (name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
function getMemberFromTask(t) {
    const id = t.assigneeId || t.assignee_id || '';
    return DB.members.find(m => m.id === id) || { name: 'Unassigned', id: '' };
}
function getMember(id) { return DB.members.find(m => m.id === id) || { name: 'Unassigned', id: '' }; }
function dueStatus(due) {
    if (!due) return 'none';
    const diff = Math.ceil((new Date(due) - new Date(today())) / 86400000);
    if (diff < 0) return 'overdue';
    if (diff <= 3) return 'due-soon';
    return 'ok';
}
function dueTxt(due) {
    if (!due) return '—';
    const diff = Math.ceil((new Date(due) - new Date(today())) / 86400000);
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return 'Due today';
    return due;
}
function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function showToast(msg, type = 'success', diagnostic = false) {
    const t = document.getElementById('toast');
    if (!t) { alert(msg); return; } 
    t.innerHTML = msg + (diagnostic ? ` <button onclick="runDiagnostic()" style="background:rgba(255,255,255,0.2); border:1px solid white; color:white; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer; margin-left:10px">🔍 Diagnostic</button>` : '');
    t.className = `toast show ${type}`;
    clearTimeout(t._timer);
    if (!diagnostic) t._timer = setTimeout(() => t.className = 'toast', 2800);
}

async function runDiagnostic() {
    showToast('🚨 Executing Cloud Diagnostic...', 'info');
    try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const report = Object.entries(data.report).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n');
        alert('LNN LEGAL - CLOUD DIAGNOSTIC REPORT\n====================================\n\n' + report + '\n\nVerify these in your Vercel Project Settings.');
    } catch (err) { alert('Diagnostic Failed: Unable to reach Cloud Responder.'); }
}

function setLoading(on) {
    const el = document.getElementById('loading-overlay');
    if (!el) return;
    if (on) { 
        el.classList.remove('hidden'); el.style.display = 'flex'; el.style.opacity = '1';
    } else {
        el.classList.add('hidden'); el.style.opacity = '0';
        setTimeout(() => { if (el.style.opacity === '0') el.style.display = 'none'; }, 400);
    }
}

let windowCurrentUserLevel = 'admin';
function applyRoleRestrictions() {
    const user = localStorage.getItem('lnn_auth_user') || '';
    const profile = DB.members.find(m => (m.username || '').toLowerCase() === user.toLowerCase());
    const role = profile ? (profile.role || '').toLowerCase() : '';
    windowCurrentUserLevel = profile && (role.includes('admin') || role.includes('partner')) ? 'admin' : (role.includes('intern') || role.includes('clerk') ? 'intern' : 'associate');
    document.body.className = `role-${windowCurrentUserLevel}`;
    const roleEl = document.querySelector('.user-role'); if (roleEl) roleEl.textContent = profile ? (profile.role || 'Member') : 'Super Admin (Unpaired)';
    const nameEl = document.getElementById('current-user-name'); const avEl = document.getElementById('current-user-avatar');
    if (nameEl) { nameEl.textContent = profile ? profile.name : user; avEl.textContent = initials(profile ? profile.name : user); }
    
    // AI Status Light Update
    fetch('/api/health').then(r => r.json()).then(data => {
        const dot = document.getElementById('ai-status-dot');
        const txt = document.getElementById('ai-status-text');
        if (dot && txt) {
            if (data.report.gemini_ai.includes('✅')) {
                dot.style.background = '#10b981'; txt.textContent = 'Intelligence Link: operational 🟢';
            } else {
                dot.style.background = '#f59e0b'; txt.textContent = 'Intelligence Link: Pending Connection... 🟠';
            }
        }
    }).catch(() => {});
}

async function fetchAll() {
    const [tasks, members, cases] = await Promise.all([
        API.getTasks(), API.getMembers(), API.getCases().catch(() => [])
    ]);
    DB.tasks = tasks; DB.members = members; DB.cases = cases;
    applyRoleRestrictions();
}

function startAutoRefresh() {
    setInterval(async () => {
        try { await fetchAll(); renderPage(currentPage); refreshAssigneeSelects(); } catch (e) {}
    }, 30000);
}

function refreshAssigneeSelects() {
    populateAssigneeSelect('task-assignee', document.getElementById('task-assignee').value);
    populateAssigneeFilter('board-filter-assignee', document.getElementById('board-filter-assignee').value);
    populateAssigneeFilter('tasks-filter-assignee', document.getElementById('tasks-filter-assignee').value);
}

function populateAssigneeSelect(id, current) {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '<option value="">Select Assignee</option>' + 
        DB.members.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

function populateAssigneeFilter(id, current) {
    const el = document.getElementById(id); if (!el) return;
    el.innerHTML = '<option value="all">All Members</option>' + 
        DB.members.map(m => `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

// ============================================================
// NAVIGATION
// ============================================================
let currentPage = 'dashboard';
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`); if (pageEl) pageEl.classList.add('active');
    document.getElementById(`nav-${page}`)?.classList.add('active');
    document.getElementById('page-title').textContent = { dashboard: 'Dashboard', board: 'Work Board', cases: 'Cases', tasks: 'All Tasks', team: 'Team', 'case-detail': 'Case File' }[page] || 'Legal Management';
    currentPage = page; renderPage(page);
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}
function renderPage(page) {
    if (page === 'dashboard') renderDashboard();
    if (page === 'board') renderBoard();
    if (page === 'cases') renderCases();
    if (page === 'tasks') renderTasks();
    if (page === 'team') renderTeam();
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
    const tasks = DB.tasks;
    document.getElementById('stat-total').textContent = tasks.length;
    document.getElementById('stat-pending').textContent = tasks.filter(t => t.stage === 'Pending Works').length;
    document.getElementById('stat-completed').textContent = tasks.filter(t => t.stage === 'Completed').length;
    document.getElementById('stat-overdue').textContent = tasks.filter(t => dueStatus(t.due) === 'overdue' && t.stage !== 'Completed').length;

    const recentList = document.getElementById('recent-tasks-list');
    recentList.innerHTML = tasks.slice(0, 6).map(t => {
        const sm = STAGE_META[t.stage] || {};
        return `<div class="task-list-item" onclick="openDetail('${t.id}')">
            <div class="tli-info"><div class="tli-title">${esc(t.title)}</div><div class="tli-meta">Office Action</div></div>
            <span class="tli-stage ${sm.cls}">${t.stage}</span>
        </div>`;
    }).join('') || '<p style="text-align:center;padding:20px;color:var(--text-muted)">Project Workspace is empty.</p>';

    const wl = document.getElementById('workload-list');
    const maxT = Math.max(...DB.members.map(m => tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length), 1);
    wl.innerHTML = DB.members.map(m => {
        const c = tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length;
        return `<div class="workload-item">
            <div class="workload-label"><span class="workload-name">${esc(m.name)}</span><span class="workload-count">${c} active</span></div>
            <div class="workload-bar"><div class="workload-fill" style="width:${Math.round((c/maxT)*100)}%"></div></div>
        </div>`;
    }).join('');

    const so = document.getElementById('stage-overview');
    so.innerHTML = STAGES.map(s => {
        const c = tasks.filter(t => t.stage === s).length; const sm = STAGE_META[s];
        return `<div class="stage-ov-item">
            <div class="stage-ov-count" style="color:${sm.dot}">${c}</div>
            <div class="stage-ov-label">${s}</div>
            <div class="stage-ov-bar" style="background:${sm.dot}"></div>
        </div>`;
    }).join('');
    renderCauseList();
}

function renderCauseList() {
    const inputD = document.getElementById('cl-date-picker').value || today();
    const container = document.getElementById('cause-list-container');
    const hearings = DB.cases.filter(c => c.next_hearing === inputD);
    document.getElementById('cl-date-label').textContent = inputD === today() ? 'Today' : inputD;
    if (hearings.length === 0) { container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-secondary)">No hearings listed.</div>`; return; }
    
    const groups = {}; hearings.forEach(h => { const k = h.court_name || 'Others'; if (!groups[k]) groups[k] = []; groups[k].push(h); });
    container.innerHTML = Object.entries(groups).map(([court, list]) => `
        <div class="diary-group">
            <div class="diary-group-header">📍 ${esc(court)}</div>
            ${list.map(c => `
                <div class="diary-item" onclick="openCaseFile('${c.id}')">
                    <div class="diary-info">
                        <div style="font-weight:700">${esc(c.case_type)} No. ${c.case_no}/${c.case_year}</div>
                        <div style="font-size:12px">${esc(c.petitioner)} vs ${esc(c.respondent)}</div>
                    </div>
                    <div class="legal-chip" style="font-size:10px">${esc(c.purpose || 'Hearing')}</div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

// ============================================================
// KANBAN BOARD
// ============================================================
let draggedTaskId = null;
function renderBoard() {
    const aF = document.getElementById('board-filter-assignee').value;
    const pF = document.getElementById('board-filter-priority').value;
    let tasks = DB.tasks;
    if (aF !== 'all') tasks = tasks.filter(t => t.assigneeId === aF);
    if (pF !== 'all') tasks = tasks.filter(t => t.priority === pF);
    const board = document.getElementById('kanban-board'); board.innerHTML = '';
    STAGES.forEach(stage => {
        const sm = STAGE_META[stage]; const staged = tasks.filter(t => t.stage === stage);
        const col = document.createElement('div'); col.className = 'kanban-col';
        col.innerHTML = `
            <div class="kanban-col-header"><div class="col-title"><span class="col-dot" style="background:${sm.dot}"></span>${stage}</div><span class="col-count">${staged.length}</span></div>
            <div class="kanban-cards" data-stage="${stage}"></div>`;
        const cardsEl = col.querySelector('.kanban-cards');
        staged.forEach(task => cardsEl.appendChild(buildKCard(task)));
        cardsEl.addEventListener('dragover', e => { e.preventDefault(); cardsEl.classList.add('drag-over'); });
        cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drag-over'));
        cardsEl.addEventListener('drop', async e => {
            e.preventDefault(); cardsEl.classList.remove('drag-over'); if (!draggedTaskId) return;
            const newS = cardsEl.dataset.stage; const task = DB.tasks.find(t => t.id === draggedTaskId);
            if (task && task.stage !== newS) {
                task.stage = newS; renderBoard();
                try {
                    await API.updateTask(draggedTaskId, { stage: newS, _userName: document.getElementById('current-user-name').textContent });
                    showToast(`Moved to "${newS}"`); await fetchAll(); renderPage(currentPage);
                } catch (err) { showToast('Sync failed', 'error'); await fetchAll(); renderBoard(); }
            }
            draggedTaskId = null;
        });
        board.appendChild(col);
    });
}
function buildKCard(task) {
    const member = getMemberFromTask(task); const ds = dueStatus(task.due); const pm = PRIORITY_META[task.priority] || PRIORITY_META.medium;
    const card = document.createElement('div'); card.className = 'kcard'; card.draggable = true;
    card.innerHTML = `
        <div class="kcard-priority-bar" style="background:${pm.color}"></div>
        <div class="kcard-title">${esc(task.title)}</div>
        ${task.client ? `<div class="kcard-client">${esc(task.client)}${task.caseNo ? ' · ' + esc(task.caseNo) : ''}</div>` : ''}
        <div class="kcard-footer">
            <div class="kcard-assignee"><div class="kcard-avatar">${initials(member.name)}</div>${esc(member.name.split(' ')[0])}</div>
            ${task.due ? `<span class="kcard-due ${ds}">${dueTxt(task.due)}</span>` : ''}
        </div>
        <div class="kcard-actions">
            <button onclick="openDetail('${task.id}')">View</button>
            <button class="associate-plus" onclick="openTaskModal('${task.id}')">Edit</button>
        </div>`;
    card.addEventListener('dragstart', (e) => { 
        if (windowCurrentUserLevel === 'intern') return e.preventDefault();
        draggedTaskId = task.id; card.classList.add('dragging'); 
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    return card;
}

// ============================================================
// ALL TASKS TABLE
// ============================================================
function renderTasks() {
    const sF = document.getElementById('tasks-filter-stage').value;
    const aF = document.getElementById('tasks-filter-assignee').value;
    const pF = document.getElementById('tasks-filter-priority').value;
    const sV = document.getElementById('search-input').value.toLowerCase();
    let tasks = DB.tasks;
    if (sF !== 'all') tasks = tasks.filter(t => t.stage === sF);
    if (aF !== 'all') tasks = tasks.filter(t => t.assigneeId === aF);
    if (pF !== 'all') tasks = tasks.filter(t => t.priority === pF);
    if (sV) tasks = tasks.filter(t => (t.title || '').toLowerCase().includes(sV) || (t.client || '').toLowerCase().includes(sV));
    const tbody = document.getElementById('tasks-table-body');
    tbody.innerHTML = tasks.map(t => {
        const member = getMember(t.assigneeId); const sm = STAGE_META[t.stage] || {}; const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium;
        return `<tr onclick="openDetail('${t.id}')">
            <td class="td-title"><div>${esc(t.title)}</div></td>
            <td><div class="assignee-chip"><div class="chip-av">${initials(member.name)}</div>${esc(member.name)}</div></td>
            <td><span class="stage-badge ${sm.cls}">${t.stage}</span></td>
            <td><span class="priority-pill ${pm.cls}">${pm.label}</span></td>
            <td>${dueTxt(t.due)}</td>
            <td onclick="event.stopPropagation()">
                <button class="action-btn associate-plus" onclick="openTaskModal('${t.id}')">✏️</button>
                <button class="action-btn admin-only" onclick="deleteTask('${t.id}')">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// CASES PAGE
// ============================================================
function renderCases() {
    const sV = document.getElementById('cases-search-input').value.toLowerCase();
    const tbody = document.getElementById('cases-table-body');
    const display = DB.cases.filter(c => (c.case_no || '').includes(sV) || (c.petitioner || '').toLowerCase().includes(sV));
    document.getElementById('cases-empty').style.display = display.length === 0 ? 'flex' : 'none';
    tbody.innerHTML = display.map(c => `
        <tr>
            <td class="td-title">
                <div>${esc(c.case_type)} No. ${c.case_no}/${c.case_year}</div>
                <div class="td-sub">${esc(c.petitioner)} vs ${esc(c.respondent)}</div>
            </td>
            <td>${esc(c.court_name)}</td>
            <td>${esc(getMember(c.partner_id).name)}</td>
            <td>
                <button class="btn-primary" style="padding:4px 12px; font-size:12px" onclick="openCaseFile('${c.id}')">📂 Dossier</button>
                <button class="action-btn" onclick="openCaseModal('${c.id}')">✏️</button>
            </td>
        </tr>
    `).join('');
}

function renderTeam() {
    document.getElementById('team-grid').innerHTML = DB.members.map(m => `
        <div class="member-card">
            <div class="member-av">${initials(m.name)}</div>
            <div class="member-name">${esc(m.name)}</div>
            <div class="member-role">${esc(m.role)}</div>
            <div class="member-stats">
              <div class="mstat"><div class="mstat-val" style="color:#6366f1">${DB.tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length}</div><div class="mstat-lbl">Active</div></div>
            </div>
            <div class="admin-only" style="margin-top:10px; display:flex; gap:8px; justify-content:center">
                <button class="action-btn" onclick="openMemberModal('${m.id}')">✏️</button>
                <button class="member-delete" style="position:static" onclick="deleteMember('${m.id}')">✕</button>
            </div>
        </div>
    `).join('');
}

// ============================================================
// MODALS
// ============================================================
async function openDetail(id) {
    const t = DB.tasks.find(x => x.id === id); if (!t) return;
    const member = getMember(t.assigneeId); const sm = STAGE_META[t.stage] || {}; const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium;
    document.getElementById('detail-title').textContent = t.title;
    document.getElementById('detail-body').innerHTML = `
        <div class="detail-grid" style="grid-template-columns:1fr 1fr; gap:12px">
            <div class="detail-field"><label>Action</label><p>${esc(t.title)}</p></div>
            <div class="detail-field"><label>Assignee</label><p>${esc(member.name)}</p></div>
            <div class="detail-field"><label>Stage</label><p><span class="stage-badge ${sm.cls}">${t.stage}</span></p></div>
            <div class="detail-field"><label>Priority</label><p><span class="priority-pill ${pm.cls}">${pm.label}</span></p></div>
        </div>
        <div style="margin-top:16px"><label>Briefing / Notes</label><div class="detail-notes">${esc(t.notes || 'No notes.')}</div></div>
        <div class="modal-actions" style="margin-top:20px"><button class="btn-secondary" onclick="closeModal('detail-modal-overlay')">Close</button></div>`;
    openModal('detail-modal-overlay');
}

async function openTaskModal(id = null) {
    const form = document.getElementById('task-form'); form.reset();
    const taskIdEl = document.getElementById('task-id'); if (taskIdEl) taskIdEl.value = id || '';
    if (id) {
        const t = DB.tasks.find(x => x.id === id); if (!t) return;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-stage').value = t.stage;
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-due').value = t.due || '';
        document.getElementById('task-notes').value = t.notes || '';
        populateAssigneeSelect('task-assignee', t.assigneeId);
    } else {
        populateAssigneeSelect('task-assignee', '');
    }
    openModal('task-modal-overlay');
}

document.getElementById('task-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('task-id').value;
    const data = {
        title: document.getElementById('task-title').value,
        stage: document.getElementById('task-stage').value,
        priority: document.getElementById('task-priority').value,
        due: document.getElementById('task-due').value,
        notes: document.getElementById('task-notes').value,
        assignee_id: document.getElementById('task-assignee').value,
        _userName: document.getElementById('current-user-name').textContent
    };
    try {
        if (id) await API.updateTask(id, data); else await API.createTask(data);
        showToast('Sync Successful'); closeModal('task-modal-overlay'); await fetchAll(); renderPage(currentPage);
    } catch (err) { showToast('Sync Failed', 'error'); }
};

async function deleteTask(id) {
    if (!confirm('Permanent Delete: Are you sure?')) return;
    try {
        await API.deleteTask(id); showToast('Task purged.'); await fetchAll(); renderPage(currentPage);
    } catch (e) { showToast('Purge failed', 'error'); }
}

async function deleteCase(id) {
    if (!confirm('This will purge the entire case dossier. Proceed?')) return;
    try {
        await API.deleteCase(id); showToast('Dossier Purged'); await fetchAll(); renderPage('cases');
    } catch (e) { showToast('Error purging dossier', 'error'); }
}

async function openCaseFile(id) {
    const c = DB.cases.find(x => x.id === id); if (!c) return;
    currentCaseInView = c; showPage('case-detail');
    document.getElementById('cd-title').textContent = `${c.case_type} No. ${c.case_no}/${c.case_year}`;
    document.getElementById('cd-client').innerHTML = `${esc(c.petitioner)} vs ${esc(c.respondent)}`;
    document.getElementById('cd-next-hearing').textContent = c.next_hearing || 'Not announced';
    document.getElementById('cd-court-info').textContent = c.court_name || '—';
    document.getElementById('cd-notes').textContent = c.notes || 'No briefing recorded.';
    
    // Timeline
    const history = document.getElementById('cd-hearing-history');
    const events = [...(c.hearing_history || [])].sort((a,b) => new Date(b.date) - new Date(a.date));
    history.innerHTML = events.map(e => `
        <div class="timeline-item" style="border-left:2px solid var(--border); padding-left:16px; margin-bottom:16px">
            <div style="font-size:12px; font-weight:800">${e.date}</div>
            <div style="font-weight:600">${esc(e.purpose)}</div>
            <div style="font-size:13px; color:var(--text-secondary)">Result: ${esc(e.result)}</div>
        </div>
    `).join('') || '<p>No litigation history.</p>';
}

async function openCaseModal(id = null) {
    const form = document.getElementById('case-form'); form.reset();
    const caseIdEl = document.getElementById('case-id'); if (caseIdEl) caseIdEl.value = id || '';
    if (id) {
        const c = DB.cases.find(x => x.id === id); if (!c) return;
        document.getElementById('case-no').value = c.case_no;
        document.getElementById('case-year').value = c.case_year;
        document.getElementById('case-type').value = c.case_type;
        document.getElementById('case-petitioner').value = c.petitioner;
        document.getElementById('case-respondent').value = c.respondent;
        document.getElementById('case-court').value = c.court_name;
        document.getElementById('case-notes').value = c.notes || '';
    }
    openModal('case-modal-overlay');
}

document.getElementById('case-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('case-id').value;
    const data = {
        case_no: document.getElementById('case-no').value,
        case_year: document.getElementById('case-year').value,
        case_type: document.getElementById('case-type').value,
        petitioner: document.getElementById('case-petitioner').value,
        respondent: document.getElementById('case-respondent').value,
        court_name: document.getElementById('case-court').value,
        notes: document.getElementById('case-notes').value,
        _userName: document.getElementById('current-user-name').textContent
    };
    try {
        if (id) await API.updateCase(id, data); else await API.createCase(data);
        showToast('Dossier Synchronized'); closeModal('case-modal-overlay'); await fetchAll(); renderPage('cases');
    } catch (err) { showToast('Dossier Sync Failed', 'error'); }
};

async function openMemberModal(id = null) {
    const form = document.getElementById('member-form'); form.reset();
    const memberIdEl = document.getElementById('member-id'); if (memberIdEl) memberIdEl.value = id || '';
    if (id) {
        const m = DB.members.find(x => x.id === id); if (!m) return;
        document.getElementById('member-name').value = m.name;
        document.getElementById('member-role').value = m.role;
        document.getElementById('member-email').value = m.email || '';
    }
    openModal('member-modal-overlay');
}

document.getElementById('member-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('member-id').value;
    const data = {
        name: document.getElementById('member-name').value,
        role: document.getElementById('member-role').value,
        email: document.getElementById('member-email').value,
    };
    try {
        if (id) await API.updateMember(id, data); else await API.createMember(data);
        showToast('Team Registry Updated'); closeModal('member-modal-overlay'); await fetchAll(); renderPage('team');
    } catch (err) { showToast('Registry Update Failed', 'error'); }
};

async function deleteMember(id) {
    if (!confirm('Remove member from registry?')) return;
    try {
        await API.deleteMember(id); showToast('Member Removed'); await fetchAll(); renderPage('team');
    } catch (e) { showToast('Error removing member', 'error'); }
}

// (Full CRUD and Event Handlers follow in the same stable pattern)
// ============================================================
// SYSTEM BOOT
// ============================================================
async function initApp() {
    setLoading(true);
    try {
        await fetchAll(); refreshAssigneeSelects();
        const h = window.location.hash;
        if (h.startsWith('#case/')) {
            const id = h.split('/')[1]; if (id) openCaseFile(id);
        } else { showPage('dashboard'); }
        startAutoRefresh();
        console.log('LNN_INIT: Operation Stabilized v4.0.0 ✓');
    } catch (err) {
        showToast('Sync Interrupt: Operating in Local Cache Mode.', 'warning', true);
        showPage('dashboard');
    } finally { setLoading(false); }
}

(async () => {
    const user = localStorage.getItem('lnn_auth_user');
    if (!user) { document.getElementById('login-overlay').classList.remove('hidden'); }
    else { 
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('current-user-name').textContent = user;
        document.getElementById('current-user-avatar').textContent = initials(user);
        initApp(); 
    }
})();

// EVENT LISTENERS (Consolidated)
function openModal(id) { const el = document.getElementById(id); if (el) { el.classList.add('open'); el.style.opacity = '1'; el.style.pointerEvents = 'all'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('open'); el.style.opacity = '0'; el.style.pointerEvents = 'none'; } }
document.getElementById('sidebar-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
document.querySelectorAll('.nav-item').forEach(n => n.onclick = (e) => { e.preventDefault(); showPage(n.dataset.page); });
document.getElementById('logout-btn').onclick = () => { localStorage.removeItem('lnn_auth_user'); location.reload(); };
document.getElementById('lnn-brain-btn').onclick = () => openModal('lnn-brain-overlay');
document.querySelectorAll('.modal-overlay').forEach(o => o.onclick = e => { if (e.target === o) closeModal(o.id); });

async function askBrain(q) {
    const input = document.getElementById('ai-input');
    const msg = q || input.value.trim(); if (!msg) return;
    if (!q) input.value = '';
    const h = document.getElementById('ai-chat-history');
    const uMsg = document.createElement('div'); uMsg.className = 'ai-msg user'; uMsg.textContent = msg; h.appendChild(uMsg);
    const bMsg = document.createElement('div'); bMsg.className = 'ai-msg bot'; bMsg.textContent = '🧠 Analyzing...'; h.appendChild(bMsg);
    h.scrollTop = h.scrollHeight;
    try {
        const res = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: msg, contextCase: currentCaseInView, data: { cases: DB.cases, tasks: DB.tasks } }) });
        const d = await res.json(); bMsg.textContent = d.answer || 'Consultation complete.';
    } catch (e) { bMsg.textContent = 'Connection interrupted.'; }
    h.scrollTop = h.scrollHeight;
}
document.getElementById('ai-send-btn').onclick = () => askBrain();
document.getElementById('ai-input').onkeypress = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askBrain(); } };

document.getElementById('login-form').onsubmit = async e => {
    e.preventDefault(); const u = document.getElementById('login-user').value.trim(); const p = document.getElementById('login-pass').value;
    const btn = e.target.querySelector('button'); btn.textContent = 'Authenticating...'; btn.disabled = true;
    try {
        const res = await API.loginUser({ username: u, password: p });
        if (res.success) { localStorage.setItem('lnn_auth_user', u); location.reload(); }
    } catch (err) { alert('Login failed: ' + err.message); } finally { btn.textContent = 'Secure Login'; btn.disabled = false; }
};
