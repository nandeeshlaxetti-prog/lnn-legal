// ============================================================
// LNN LEGAL — DIGITAL BRIEFCASE v3.0.0 (TITAN BUILD)
// ============================================================
console.log('LNN_TITAN: Synchronizing Office Logic...');

const DB = { tasks: [], members: [], cases: [] };
let currentCaseInView = null; 

const API = {
    async request(url, options = {}) {
        console.log(`LNN_SYNC: Accessing ${url}...`);
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

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) { alert(msg); return; } // Hard fail-safe
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = 'toast', 2800);
}

function setLoading(on) {
    const el = document.getElementById('loading-overlay');
    if (!el) return;
    if (on) {
        el.classList.remove('hidden'); el.style.display = 'flex';
        el.style.opacity = '1'; el.style.pointerEvents = 'all';
    } else {
        el.classList.add('hidden');
        el.style.opacity = '0'; el.style.pointerEvents = 'none';
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
    const roleEl = document.querySelector('.user-role');
    if (roleEl) roleEl.textContent = profile ? (profile.role || 'Member') : 'Super Admin (Unpaired)';
    const nameEl = document.getElementById('current-user-name');
    const avEl = document.getElementById('current-user-avatar');
    if (nameEl) { nameEl.textContent = profile ? profile.name : user; avEl.textContent = initials(profile ? profile.name : user); }
}

async function fetchAll() {
    console.log('LNN_CORE: Synchronizing litigation database...');
    const [tasks, members, cases] = await Promise.all([
        API.getTasks(), 
        API.getMembers(),
        API.getCases().catch(() => []) 
    ]);
    DB.tasks = tasks; DB.members = members; DB.cases = cases;
    applyRoleRestrictions();
}

function startAutoRefresh() {
    setInterval(async () => {
        try {
            await fetchAll(); renderPage(currentPage); refreshAssigneeSelects();
            document.getElementById('last-sync').textContent = 'Synced ' + new Date().toLocaleTimeString();
        } catch (e) { console.warn('LNN_REFRESH_STALLED'); }
    }, 30000);
}

function refreshAssigneeSelects() {
    populateAssigneeSelect('task-assignee', document.getElementById('task-assignee').value);
    populateAssigneeFilter('board-filter-assignee', document.getElementById('board-filter-assignee').value);
    populateAssigneeFilter('tasks-filter-assignee', document.getElementById('tasks-filter-assignee').value);
}

let currentPage = 'dashboard';
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');
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
            <div class="tli-info"><div class="tli-title">${esc(t.title)}</div><div class="tli-meta">Office Task</div></div>
            <span class="tli-stage ${sm.cls}">${t.stage}</span>
        </div>`;
    }).join('') || '<p style="text-align:center;padding:20px">No tasks assigned.</p>';

    const wl = document.getElementById('workload-list');
    const maxTasks = Math.max(...DB.members.map(m => tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length), 1);
    wl.innerHTML = DB.members.map(m => {
        const count = tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length;
        return `<div class="workload-item">
            <div class="workload-label"><span class="workload-name">${esc(m.name)}</span><span class="workload-count">${count} tasks</span></div>
            <div class="workload-bar"><div class="workload-fill" style="width:${Math.round((count / maxTasks) * 100)}%"></div></div>
        </div>`;
    }).join('');

    const so = document.getElementById('stage-overview');
    so.innerHTML = STAGES.map(s => {
        const count = tasks.filter(t => t.stage === s).length;
        const sm = STAGE_META[s];
        return `<div class="stage-ov-item">
            <div class="stage-ov-count" style="color:${sm.dot}">${count}</div>
            <div class="stage-ov-label">${s}</div>
            <div class="stage-ov-bar" style="background:${sm.dot}"></div>
        </div>`;
    }).join('');
    renderCauseList();
}

function renderCauseList() {
    const inputDate = document.getElementById('cl-date-picker').value || today();
    const container = document.getElementById('cause-list-container');
    const hearings = DB.cases.filter(c => c.next_hearing === inputDate);
    document.getElementById('cl-date-label').textContent = inputDate === today() ? 'Today' : inputDate;
    if (hearings.length === 0) { container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-secondary)">No hearings scheduled.</div>`; return; }
    
    const groups = {}; hearings.forEach(h => { const key = h.court_name || 'Others'; if (!groups[key]) groups[key] = []; groups[key].push(h); });
    container.innerHTML = Object.entries(groups).map(([court, list]) => `
        <div class="diary-group">
            <div class="diary-group-header">📍 ${esc(court)}</div>
            ${list.map(c => `
                <div class="diary-item" onclick="openCaseFile('${c.id}')">
                    <div class="diary-info">
                        <div style="font-weight:700">${esc(c.case_type)} No. ${c.case_no}/${c.case_year}</div>
                        <div style="font-size:12px">${esc(c.petitioner)} vs ${esc(c.respondent)}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

let draggedTaskId = null;
function renderBoard() {
    const assigneeFilter = document.getElementById('board-filter-assignee').value;
    const priorityFilter = document.getElementById('board-filter-priority').value;
    let tasks = DB.tasks;
    if (assigneeFilter !== 'all') tasks = tasks.filter(t => t.assigneeId === assigneeFilter);
    if (priorityFilter !== 'all') tasks = tasks.filter(t => t.priority === priorityFilter);
    const board = document.getElementById('kanban-board'); board.innerHTML = '';
    STAGES.forEach(stage => {
        const sm = STAGE_META[stage]; const staged = tasks.filter(t => t.stage === stage);
        const col = document.createElement('div'); col.className = 'kanban-col';
        col.innerHTML = `
            <div class="kanban-col-header"><div class="col-title"><span class="col-dot" style="background:${sm.dot}"></span>${stage}</div><span class="col-count">${staged.length}</span></div>
            <div class="kanban-cards" data-stage="${stage}"></div>`;
        const cardsEl = col.querySelector('.kanban-cards');
        staged.forEach(task => { cardsEl.appendChild(buildKCard(task)); });
        cardsEl.addEventListener('dragover', e => { e.preventDefault(); cardsEl.classList.add('drag-over'); });
        cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drag-over'));
        cardsEl.addEventListener('drop', async e => {
            e.preventDefault(); cardsEl.classList.remove('drag-over'); if (!draggedTaskId) return;
            const newStage = cardsEl.dataset.stage; const task = DB.tasks.find(t => t.id === draggedTaskId);
            if (task && task.stage !== newStage) {
                task.stage = newStage; renderBoard();
                try {
                    await API.updateTask(draggedTaskId, { stage: newStage, _userName: document.getElementById('current-user-name').textContent });
                    showToast(`Moved to "${newStage}"`); await fetchAll(); renderPage(currentPage);
                } catch (err) { showToast('Update failed', 'error'); await fetchAll(); renderBoard(); }
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
            <td>${esc(t.title)}</td>
            <td><div class="assignee-chip"><div class="chip-av">${initials(member.name)}</div>${esc(member.name)}</div></td>
            <td><span class="stage-badge ${sm.cls}">${t.stage}</span></td>
            <td><span class="priority-pill ${pm.cls}">${pm.label}</span></td>
            <td>${dueTxt(t.due)}</td>
        </tr>`;
    }).join('');
}

function renderCases() {
    const sV = document.getElementById('cases-search-input').value.toLowerCase();
    const cGrid = document.getElementById('cases-table-body');
    cGrid.innerHTML = DB.cases.filter(c => (c.case_no || '').includes(sV) || (c.petitioner || '').toLowerCase().includes(sV)).map(c => `
        <tr>
            <td>${esc(c.case_type)} No. ${esc(c.case_no)}/${esc(c.case_year)}</td>
            <td>${esc(c.petitioner)} vs ${esc(c.respondent)}</td>
            <td>${esc(c.court_name)}</td>
            <td><button class="btn-primary" onclick="openCaseFile('${c.id}')"> dossier </button></td>
        </tr>
    `).join('');
}

function renderTeam() {
    document.getElementById('team-grid').innerHTML = DB.members.map(m => `
        <div class="member-card">
            <div class="member-av">${initials(m.name)}</div>
            <div class="member-name">${esc(m.name)}</div>
            <div class="member-role">${esc(m.role)}</div>
            <div class="member-stats"><div>Active: ${DB.tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length}</div></div>
        </div>
    `).join('');
}

async function openDetail(id) {
    const t = DB.tasks.find(x => x.id === id); if (!t) return;
    const member = getMember(t.assigneeId); const sm = STAGE_META[t.stage] || {};
    document.getElementById('detail-title').textContent = t.title;
    document.getElementById('detail-body').innerHTML = `
        <div class="detail-grid">
            <div class="detail-field"><label>Assignee</label><p>${esc(member.name)}</p></div>
            <div class="detail-field"><label>Stage</label><p><span class="stage-badge ${sm.cls}">${t.stage}</span></p></div>
        </div>
        <div style="margin-top:20px"><label>Notes</label><p>${esc(t.notes || 'None')}</p></div>
        <div class="modal-actions"><button onclick="closeModal('detail-modal-overlay')">Close</button></div>`;
    openModal('detail-modal-overlay');
}

async function initApp() {
    setLoading(true);
    try {
        console.log('LNN_INIT: Fetching database assets...');
        await fetchAll();
        refreshAssigneeSelects();
        const h = window.location.hash;
        if (h.startsWith('#case/')) {
            const id = h.split('/')[1]; if (id) openCaseFile(id);
        } else {
            showPage('dashboard');
        }
        startAutoRefresh();
        console.log('LNN_INIT: Workspace stabilized ✓');
    } catch (err) {
        console.error('LNN_BOOT_FAILURE:', err);
        showToast('Sync Failed. Check credentials.', 'error');
        setTimeout(initApp, 10000);
    } finally {
        setLoading(false);
    }
}

// Initial Boot
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

// EVENT HANDLERS
document.getElementById('sidebar-toggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
document.querySelectorAll('.nav-item').forEach(n => n.onclick = (e) => { e.preventDefault(); showPage(n.dataset.page); });
document.getElementById('logout-btn').onclick = () => { localStorage.removeItem('lnn_auth_user'); location.reload(); };

function openModal(id) { const el = document.getElementById(id); if (el) { el.classList.add('open'); el.style.opacity = '1'; el.style.pointerEvents = 'all'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('open'); el.style.opacity = '0'; el.style.pointerEvents = 'none'; } }

document.getElementById('login-form').onsubmit = async e => {
    e.preventDefault(); const u = document.getElementById('login-user').value.trim(); const p = document.getElementById('login-pass').value;
    try {
        const res = await API.loginUser({ username: u, password: p });
        if (res.success) { localStorage.setItem('lnn_auth_user', u); location.reload(); }
    } catch (err) { showToast('Login failed', 'error'); }
};

// ... Remaining UI Event listeners linked ...
