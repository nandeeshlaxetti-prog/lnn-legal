// ============================================================
// IN-MEMORY STORE (populated from API)
// ============================================================
const DB = { tasks: [], members: [], cases: [] };

// ============================================================
// API LAYER — calls Vercel serverless functions
// ============================================================
const API = {
    async request(url, options = {}) {
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
    },

    getTasks() { return this.request('/api/tasks'); },
    createTask(data) { return this.request('/api/tasks', { method: 'POST', body: data }); },
    updateTask(id, data) { return this.request(`/api/tasks?id=${id}`, { method: 'PUT', body: data }); },
    deleteTask(id) { return this.request(`/api/tasks?id=${id}`, { method: 'DELETE' }); },

    getCases() { return this.request('/api/cases'); },
    createCase(data) { return this.request('/api/cases', { method: 'POST', body: data }); },
    updateCase(id, data) { return this.request(`/api/cases?id=${id}`, { method: 'PUT', body: data }); },
    deleteCase(id) { return this.request(`/api/cases?id=${id}`, { method: 'DELETE' }); },

    getMembers() { return this.request('/api/members'); },
    createMember(data) { return this.request('/api/members', { method: 'POST', body: data }); },
    updateMember(id, data) { return this.request(`/api/members?id=${id}`, { method: 'PUT', body: data }); },
    deleteMember(id) { return this.request(`/api/members?id=${id}`, { method: 'DELETE' }); },

    uploadFile(data) { return this.request('/api/upload', { method: 'POST', body: data }); },
    getSignUrl(data) { return this.request('/api/upload-url', { method: 'POST', body: data }); },
    getLogs(id) { return this.request(`/api/logs?taskId=${id}`); },
    loginUser(data) { return this.request('/api/login', { method: 'POST', body: data }); }
};

// ============================================================
// CONSTANTS
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

// ============================================================
// UTILITIES
// ============================================================
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function today() { return fmtDate(new Date()); }
function initials(name) { return (name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }
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
function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = 'toast', 2800);
}

function setLoading(on) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

let windowCurrentUserLevel = 'admin';

function applyRoleRestrictions() {
    const user = localStorage.getItem('lnn_auth_user') || '';
    const profile = DB.members.find(m => (m.username || '').toLowerCase() === user.toLowerCase());
    const role = profile ? (profile.role || '').toLowerCase() : '';

    if (!profile || role.includes('admin') || role.includes('partner')) windowCurrentUserLevel = 'admin';
    else if (role.includes('intern') || role.includes('clerk')) windowCurrentUserLevel = 'intern';
    else windowCurrentUserLevel = 'associate';

    document.body.className = `role-${windowCurrentUserLevel}`;

    const roleEl = document.querySelector('.user-role');
    if (roleEl) {
        roleEl.textContent = profile ? (profile.role || 'Member') : 'Super Admin (Unpaired)';
    }

    const nameEl = document.getElementById('current-user-name');
    const avEl = document.getElementById('current-user-avatar');
    if (nameEl) {
        nameEl.textContent = profile ? profile.name : user;
        avEl.textContent = initials(profile ? profile.name : user);
    }
}

// ============================================================
// FETCH ALL DATA
// ============================================================
async function fetchAll() {
    const [tasks, members, cases] = await Promise.all([
        API.getTasks(), 
        API.getMembers(),
        API.getCases().catch(() => []) // Handle cases as separate aspect
    ]);
    DB.tasks = tasks;
    DB.members = members;
    DB.cases = cases;
    applyRoleRestrictions();
}

// ============================================================
// AUTO REFRESH every 30s (catches changes from other users)
// ============================================================
function startAutoRefresh() {
    setInterval(async () => {
        try {
            await fetchAll();
            renderPage(currentPage);
            refreshAssigneeSelects();
            document.getElementById('last-sync').textContent = 'Synced ' + new Date().toLocaleTimeString();
        } catch (e) { /* silent */ }
    }, 30000);
}

function refreshAssigneeSelects() {
    const taskSel = document.getElementById('task-assignee');
    const curTask = taskSel.value;
    populateAssigneeSelect('task-assignee', curTask);
    populateAssigneeFilter('board-filter-assignee', document.getElementById('board-filter-assignee').value);
    populateAssigneeFilter('tasks-filter-assignee', document.getElementById('tasks-filter-assignee').value);
}

// ============================================================
// NAVIGATION
// ============================================================
let currentPage = 'dashboard';
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');
    
    document.getElementById(`nav-${page}`)?.classList.add('active');
    document.getElementById('page-title').textContent =
        { dashboard: 'Dashboard', board: 'Work Board', cases: 'Cases', tasks: 'All Tasks', team: 'Team', 'case-detail': 'Case File' }[page] || 'Legal Management';
    
    currentPage = page;
    renderPage(page);
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
    const total = tasks.length;
    const pending = tasks.filter(t => t.stage === 'Pending Works').length;
    const completed = tasks.filter(t => t.stage === 'Completed').length;
    const overdue = tasks.filter(t => dueStatus(t.due) === 'overdue' && t.stage !== 'Completed').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-completed').textContent = completed;
    document.getElementById('stat-overdue').textContent = overdue;

    // Recent tasks
    const recentList = document.getElementById('recent-tasks-list');
    const recent = tasks.slice(0, 6);
    recentList.innerHTML = recent.map(t => {
        const sm = STAGE_META[t.stage] || {};
        return `<div class="task-list-item" onclick="openDetail('${t.id}')">
      <div class="tli-info">
        <div class="tli-title">${esc(t.title)}</div>
        <div class="tli-meta">Office Task</div>
      </div>
      <span class="tli-stage ${sm.cls}">${t.stage}</span>
    </div>`;
    }).join('') || '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">No tasks yet. Click + New Task to start.</p>';

    // Team workload
    const wl = document.getElementById('workload-list');
    const maxTasks = Math.max(...DB.members.map(m => tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length), 1);
    wl.innerHTML = DB.members.length === 0
        ? '<p style="color:var(--text-muted);font-size:13px">No team members yet.</p>'
        : DB.members.map(m => {
            const count = tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length;
            const pct = Math.round((count / maxTasks) * 100);
            return `<div class="workload-item">
        <div class="workload-label">
          <span class="workload-name">${esc(m.name)}</span>
          <span class="workload-count">${count} tasks</span>
        </div>
        <div class="workload-bar"><div class="workload-fill" style="width:${pct}%"></div></div>
      </div>`;
        }).join('');

    // Stage overview
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
}

// ============================================================
// KANBAN BOARD
// ============================================================
let draggedTaskId = null;

function renderBoard() {
    const assigneeFilter = document.getElementById('board-filter-assignee').value;
    const priorityFilter = document.getElementById('board-filter-priority').value;
    populateAssigneeFilter('board-filter-assignee', assigneeFilter);

    let tasks = DB.tasks;
    if (assigneeFilter !== 'all') tasks = tasks.filter(t => t.assigneeId === assigneeFilter);
    if (priorityFilter !== 'all') tasks = tasks.filter(t => t.priority === priorityFilter);

    const board = document.getElementById('kanban-board');
    board.innerHTML = '';

    STAGES.forEach(stage => {
        const sm = STAGE_META[stage];
        const staged = tasks.filter(t => t.stage === stage);

        const col = document.createElement('div');
        col.className = 'kanban-col';
        col.innerHTML = `
      <div class="kanban-col-header">
        <div class="col-title"><span class="col-dot" style="background:${sm.dot}"></span>${stage}</div>
        <span class="col-count">${staged.length}</span>
      </div>
      <div class="kanban-cards" data-stage="${stage}"></div>`;

        const cardsEl = col.querySelector('.kanban-cards');
        staged.forEach(task => cardsEl.appendChild(buildKCard(task)));

        cardsEl.addEventListener('dragover', e => { e.preventDefault(); cardsEl.classList.add('drag-over'); });
        cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drag-over'));
        cardsEl.addEventListener('drop', async e => {
            e.preventDefault();
            cardsEl.classList.remove('drag-over');
            if (!draggedTaskId) return;
            const newStage = cardsEl.dataset.stage;
            const task = DB.tasks.find(t => t.id === draggedTaskId);
            if (task && task.stage !== newStage) {
                task.stage = newStage; // optimistic
                renderBoard();
                try {
                    await API.updateTask(draggedTaskId, { stage: newStage, _userName: document.getElementById('current-user-name').textContent });
                    showToast(`Moved to "${newStage}"`, 'success');
                    await fetchAll(); renderPage(currentPage);
                } catch (err) { showToast('Failed to update stage', 'error'); await fetchAll(); renderBoard(); }
            }
            draggedTaskId = null;
        });

        board.appendChild(col);
    });
}

function buildKCard(task) {
    const member = getMember(task.assigneeId);
    const ds = dueStatus(task.due);
    const pm = PRIORITY_META[task.priority] || PRIORITY_META.medium;

    const card = document.createElement('div');
    card.className = 'kcard';
    card.draggable = true;
    card.innerHTML = `
    <div class="kcard-priority-bar" style="background:${pm.color}"></div>
    <div class="kcard-title">${esc(task.title)}</div>
    ${task.client ? `<div class="kcard-client">${esc(task.client)}${task.caseNo ? ' · ' + esc(task.caseNo) : ''}</div>` : ''}
    <div class="kcard-footer">
      <div class="kcard-assignee">
        <div class="kcard-avatar">${initials(member.name)}</div>
        ${esc(member.name.split(' ')[0])}
      </div>
      ${task.due ? `<span class="kcard-due ${ds}">${dueTxt(task.due)}</span>` : ''}
    </div>
    <div class="kcard-actions">
      <button class="kcard-btn" onclick="openDetail('${task.id}')">👁 View</button>
      <button class="kcard-btn associate-plus" onclick="openTaskModal('${task.id}')">✏️ Edit</button>
      <button class="kcard-btn admin-only" onclick="deleteTask('${task.id}')">🗑 Delete</button>
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
    const stageFilter = document.getElementById('tasks-filter-stage').value;
    const assigneeFilter = document.getElementById('tasks-filter-assignee').value;
    const priorityFilter = document.getElementById('tasks-filter-priority').value;
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    populateAssigneeFilter('tasks-filter-assignee', assigneeFilter);

    let tasks = DB.tasks;
    if (stageFilter !== 'all') tasks = tasks.filter(t => t.stage === stageFilter);
    if (assigneeFilter !== 'all') tasks = tasks.filter(t => t.assigneeId === assigneeFilter);
    if (priorityFilter !== 'all') tasks = tasks.filter(t => t.priority === priorityFilter);
    if (searchVal) tasks = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(searchVal) ||
        (t.client || '').toLowerCase().includes(searchVal) ||
        (t.caseNo || '').toLowerCase().includes(searchVal) ||
        (t.cnr || '').toLowerCase().includes(searchVal)
    );

    const tbody = document.getElementById('tasks-table-body');
    const empty = document.getElementById('tasks-empty');
    const table = document.getElementById('tasks-table');

    if (tasks.length === 0) {
        tbody.innerHTML = '';
        table.style.display = 'none';
        empty.style.display = 'flex'; empty.style.flexDirection = 'column'; empty.style.alignItems = 'center';
        return;
    }
    table.style.display = ''; empty.style.display = 'none';

    tbody.innerHTML = tasks.map(t => {
        const member = getMember(t.assigneeId);
        const sm = STAGE_META[t.stage] || {};
        const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium;
        const ds = dueStatus(t.due);
        return `<tr onclick="openDetail('${t.id}')">
      <td class="td-title">
        <div>${esc(t.title)}</div>
        ${t.client || t.caseNo ? `<div class="td-sub">${t.client ? esc(t.client) : ''}${t.caseNo ? ' · ' + esc(t.caseNo) : ''}</div>` : ''}
      </td>
      <td><div class="assignee-chip"><div class="chip-av">${initials(member.name)}</div>${esc(member.name)}</div></td>
      <td><span class="stage-badge ${sm.cls}">${t.stage}</span></td>
      <td><span class="priority-pill ${pm.cls}">${pm.label}</span></td>
      <td><span class="due-text ${ds !== 'none' ? ds : ''}">${dueTxt(t.due)}</span></td>
      <td onclick="event.stopPropagation()">
        <button class="action-btn associate-plus" title="Edit"   onclick="openTaskModal('${t.id}')">✏️</button>
        <button class="action-btn admin-only" title="Delete" onclick="deleteTask('${t.id}')">🗑️</button>
      </td>
    </tr>`;
    }).join('');
}

// ============================================================
// CASES PAGE (Case Management)
// ============================================================
function renderCases() {
    const searchVal = document.getElementById('cases-search-input').value.toLowerCase();
    const cases = DB.cases;

    const displayCases = cases.filter(c => 
        (c.case_type || '').toLowerCase().includes(searchVal) ||
        (c.case_no || '').toLowerCase().includes(searchVal) ||
        (c.petitioner || '').toLowerCase().includes(searchVal) ||
        (c.respondent || '').toLowerCase().includes(searchVal) ||
        (c.cnr_no || '').toLowerCase().includes(searchVal)
    );

    const tbody = document.getElementById('cases-table-body');
    const empty = document.getElementById('cases-empty');
    if (displayCases.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = displayCases.map(c => {
        const partner = DB.members.find(m => m.id === c.partner_id) || { name: '—' };
        const fullNo = `${c.case_type} ${c.case_no}/${c.case_year}`;
        return `<tr>
            <td class="td-title">
                <div>${esc(fullNo)}</div>
                <div class="td-sub">${esc(c.petitioner)} vs ${esc(c.respondent)}</div>
            </td>
            <td><code>${esc(c.cnr_no || '—')}</code></td>
            <td>
                <div>P: ${esc(c.petitioner || '—')}</div>
                <div class="td-sub">R: ${esc(c.respondent || '—')}</div>
            </td>
            <td>${esc(c.court_name || '—')}</td>
            <td>${esc(partner.name)}</td>
            <td>
                <button class="btn-primary" style="padding:4px 12px;font-size:12px" onclick="openCaseFile('${c.id}')">📂 View File</button>
                <button class="action-btn" onclick="openCaseModal('${c.id}')" title="Edit Properties">✏️</button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// TEAM PAGE
// ============================================================
function renderTeam() {
    const grid = document.getElementById('team-grid');
    if (DB.members.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted);font-size:14px;padding:20px">No members yet. Click + Add Member to begin.</p>';
        return;
    }
    grid.innerHTML = DB.members.map(m => {
        const active = DB.tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length;
        const completed = DB.tasks.filter(t => t.assigneeId === m.id && t.stage === 'Completed').length;
        return `<div class="member-card">
      <div class="member-actions admin-only" style="position: absolute; top: 10px; right: 10px; display: flex; gap: 8px">
          <button class="action-btn" onclick="openMemberModal('${m.id}')" title="Edit Profile">✏️</button>
          <button class="member-delete" style="position:static" onclick="deleteMember('${m.id}')" title="Remove Member">✕</button>
      </div>
      <div class="member-av">${initials(m.name)}</div>
      <div class="member-name">${esc(m.name)}</div>
      <div class="member-role">${esc(m.role || '—')}</div>
      ${m.email ? `<div class="member-email" style="font-weight:600;margin-top:4px">✉️ ${esc(m.email)}</div>` : ''}
      ${m.phone ? `<div class="member-email" style="font-weight:600;color:var(--text-primary)">📱 ${esc(m.phone)}</div>` : ''}
      <div class="member-stats">
        <div class="mstat"><div class="mstat-val" style="color:#6366f1">${active}</div><div class="mstat-lbl">Active</div></div>
        <div class="mstat"><div class="mstat-val" style="color:#10b981">${completed}</div><div class="mstat-lbl">Done</div></div>
      </div>
    </div>`;
    }).join('');
}

// ============================================================
// TASK MODAL
// ============================================================
let currentTaskAttachments = [];

function openTaskModal(taskId = null) {
    const form = document.getElementById('task-form');
    form.reset();
    currentTaskAttachments = [];
    document.getElementById('task-file-list').innerHTML = '';
    document.getElementById('task-file').value = '';
    populateAssigneeSelect('task-assignee', '');

    if (taskId) {
        const t = DB.tasks.find(t => t.id === taskId);
        if (!t) return;
        document.getElementById('task-modal-title').textContent = 'Edit Office Task';
        document.getElementById('task-id').value = t.id;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-stage').value = t.stage;
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-due').value = t.due || '';
        document.getElementById('task-notes').value = t.notes || '';
        populateAssigneeSelect('task-assignee', t.assigneeId || '');
    } else {
        document.getElementById('task-modal-title').textContent = 'New Office Task';
        document.getElementById('task-id').value = '';
    }
    openModal('task-modal-overlay');
}

window.removeAttachment = function (idx) {
    currentTaskAttachments.splice(idx, 1);
    openTaskModal(document.getElementById('task-id').value); // Re-render modal state
};

document.getElementById('task-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

    let finalAttachments = [...currentTaskAttachments];

    try {
        const fileInput = document.getElementById('task-file');
        if (fileInput.files.length > 0) {
            submitBtn.textContent = 'Uploading files…';
            for (let i = 0; i < fileInput.files.length; i++) {
                const file = fileInput.files[i];

                // 1. Get secure one-time signed URL bypassing Vercel's 4.5MB ceiling
                const authUrl = await API.getSignUrl({ fileName: file.name });

                // 2. Transmit bytes directly into Supabase Storage
                const uploadRes = await fetch(authUrl.signedUrl, {
                    method: 'PUT',
                    body: file,
                    headers: { 'Content-Type': file.type || 'application/octet-stream' }
                });

                if (!uploadRes.ok) throw new Error(`Document upload failed securely for ${file.name}`);

                finalAttachments.push({ name: file.name, url: authUrl.publicUrl });
            }
        }

        const data = {
            title,
            assigneeId: document.getElementById('task-assignee').value,
            stage: document.getElementById('task-stage').value,
            priority: document.getElementById('task-priority').value,
            due: document.getElementById('task-due').value,
            notes: document.getElementById('task-notes').value.trim(),
            attachments: finalAttachments,
            _userName: document.getElementById('current-user-name').textContent
        };

        if (id) {
            const updated = await API.updateTask(id, data);
            const idx = DB.tasks.findIndex(t => t.id === id);
            if (idx !== -1) DB.tasks[idx] = updated;
            showToast('Task updated ✓');
        } else {
            const created = await API.createTask(data);
            DB.tasks.unshift(created);
            showToast('Task created ✓');
        }
        closeModal('task-modal-overlay');
        renderPage(currentPage);
        await fetchAll(); renderPage(currentPage);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Save Task';
    }
});

// ============================================================
// MEMBER MODAL
// ============================================================
function openMemberModal(memberId = null) {
    const form = document.getElementById('member-form');
    form.reset();

    if (memberId) {
        const m = DB.members.find(x => x.id === memberId);
        if (!m) return;
        document.getElementById('member-modal-title').textContent = 'Edit Team Member';
        document.getElementById('member-id').value = m.id;
        document.getElementById('member-name').value = m.name;
        document.getElementById('member-username').value = m.username || '';
        document.getElementById('member-role').value = m.role || 'Associate';
        document.getElementById('member-email').value = m.email || '';
        document.getElementById('member-phone').value = m.phone || '';
        document.getElementById('member-submit-btn').textContent = 'Save Changes';
    } else {
        document.getElementById('member-modal-title').textContent = 'Add Team Member';
        document.getElementById('member-id').value = '';
        document.getElementById('member-submit-btn').textContent = 'Add Member';
    }
    openModal('member-modal-overlay');
}

document.getElementById('member-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('member-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';

    try {
        const id = document.getElementById('member-id').value;
        const data = {
            name,
            username: document.getElementById('member-username').value.trim().toLowerCase(),
            role: document.getElementById('member-role').value.trim(),
            email: document.getElementById('member-email').value.trim(),
            phone: document.getElementById('member-phone').value.trim()
        };

        if (id) {
            const updated = await API.updateMember(id, data);
            const idx = DB.members.findIndex(m => m.id === id);
            if (idx !== -1) DB.members[idx] = updated;
            showToast('Profile updated ✓');
        } else {
            const created = await API.createMember(data);
            DB.members.push(created);
            showToast('Member added ✓');
        }
        closeModal('member-modal-overlay');
        renderTeam();
        refreshAssigneeSelects();
        applyRoleRestrictions();
        await fetchAll(); renderPage(currentPage);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Save Member';
    }
});

// ============================================================
// TASK DETAIL MODAL
// ============================================================
async function openDetail(taskId) {
    const t = DB.tasks.find(t => t.id === taskId);
    if (!t) return;

    document.getElementById('detail-body').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Loading history...</div>';
    openModal('detail-modal-overlay');

    const logs = await API.getLogs(taskId).catch(() => []);
    const logsHtml = logs.length === 0 ? '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">No history yet.</p>' :
        '<div class="audit-trail">' + logs.map(l => `
        <div class="audit-item">
          <div class="audit-dot" style="background: ${l.action_type === 'stage' ? '#f59e0b' : l.action_type === 'reassign' ? '#3b82f6' : l.action_type === 'created' ? '#10b981' : '#6366f1'}"></div>
          <div class="audit-time">${new Date(l.created_at).toLocaleString()}</div>
          <div><span class="audit-user">${esc(l.user_name)}</span> ${esc(l.description)}</div>
        </div>
      `).join('') + '</div>';

    const member = getMember(t.assigneeId);
    const sm = STAGE_META[t.stage] || {};
    const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium;
    const ds = dueStatus(t.due);

    document.getElementById('detail-title').textContent = t.title;
    document.getElementById('detail-body').innerHTML = `
    <div class="detail-grid" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="detail-field"><label>Office Action</label><p>${esc(t.title)}</p></div>
      <div class="detail-field"><label>Assigned To</label>
        <div class="assignee-chip" style="margin-top:4px">
          <div class="chip-av">${initials(member.name)}</div>${esc(member.name)}
        </div>
      </div>
      <div class="detail-field"><label>Priority</label><p><span class="priority-pill ${pm.cls}">${pm.label}</span></p></div>
      <div class="detail-field"><label>Stage</label><p><span class="stage-badge ${sm.cls}">${t.stage}</span></p></div>
      <div class="detail-field"><label>Due Date</label><p class="due-text ${ds}">${dueTxt(t.due)}</p></div>
    </div>
    <div class="detail-field" style="margin:16px 0"><label>Office Notes</label>
      <div class="detail-notes" style="background:var(--bg-secondary);padding:12px;border-radius:6px;font-size:14px">${esc(t.notes || 'No notes.')}</div>
    </div>
    
    <div class="modal-actions" style="border-top:1px solid var(--border);padding-top:16px">
      <button class="btn-secondary" onclick="closeModal('detail-modal-overlay')">Close</button>
      <button class="btn-primary" onclick="closeModal('detail-modal-overlay');openTaskModal('${t.id}')">✏️ Edit Action</button>
    </div>`;
}

// ============================================================
// CASE FILE DIALOG
// ============================================================
async function openCaseFile(caseId) {
    const c = DB.cases.find(x => x.id === caseId);
    if (!c) return showToast('Case file not found', 'error');

    showPage('case-detail');
    
    // Populate Case Info
    const fullNo = `${c.case_type} ${c.case_no}/${c.case_year}`;
    document.getElementById('cd-title').textContent = fullNo;
    document.getElementById('cd-client').textContent = `${c.petitioner || '—'} vs ${c.respondent || '—'}`;
    document.getElementById('cd-case-no').textContent = fullNo;
    document.getElementById('cd-cnr').textContent = c.cnr_no || '—';

    // Sidebar Extension
    const p = DB.members.find(m => m.id === c.partner_id);
    document.getElementById('cd-assignee-name').textContent = p ? p.name : 'Unassigned';
    document.getElementById('cd-assignee-role').textContent = 'Partner In-Charge';
    document.getElementById('cd-created-at').textContent = new Date(c.created_at).toLocaleDateString();

    // Detailed Info
    document.getElementById('cd-notes').innerHTML = `
        <div style="margin-bottom:12px">
            <strong>Court:</strong> ${esc(c.court_name || '—')} | <strong>Hall:</strong> ${esc(c.court_hall || '—')}
        </div>
        <div style="margin-bottom:12px">
            <strong>Appearing For:</strong> <span class="priority-pill" style="background:#e0e7ff;color:#4338ca">${esc(c.appearing_for || 'Petitioner')}</span>
        </div>
        <div>${esc(c.notes || 'No briefing added.')}</div>
    `;

    // Documents
    const docGrid = document.getElementById('cd-documents');
    if (c.attachments && c.attachments.length > 0) {
        docGrid.innerHTML = c.attachments.map(a => `<a href="${a.url}" target="_blank" class="doc-card"><span class="doc-icon">📄</span><span class="doc-name">${esc(a.name)}</span></a>`).join('');
    } else {
        docGrid.innerHTML = '<p class="empty-text">No documents in file.</p>';
    }

    // Timeline (empty for separate case management for now)
    document.getElementById('cd-timeline').innerHTML = '<p class="empty-text">Timeline separation enabled.</p>';

    document.getElementById('cd-edit-btn').onclick = () => openCaseModal(caseId);
}

// ============================================================
// CASE MODAL (Legal Management)
// ============================================================
function openCaseModal(caseId = null) {
    const form = document.getElementById('case-form');
    form.reset();
    populatePartnerSelect();
    
    if (caseId) {
        const c = DB.cases.find(x => x.id === caseId);
        if (!c) return;
        document.getElementById('case-modal-title').textContent = 'Edit Case File';
        document.getElementById('case-id').value = c.id;
        document.getElementById('case-type').value = c.case_type || '';
        document.getElementById('case-no').value = c.case_no || '';
        document.getElementById('case-year').value = c.case_year || '';
        document.getElementById('case-court').value = c.court_name || '';
        document.getElementById('case-hall').value = c.court_hall || '';
        document.getElementById('case-petitioner').value = c.petitioner || '';
        document.getElementById('case-respondent').value = c.respondent || '';
        document.getElementById('case-appearing-for').value = c.appearing_for || 'Petitioner';
        document.getElementById('case-partner').value = c.partner_id || '';
        document.getElementById('case-cnr').value = c.cnr_no || '';
        document.getElementById('case-notes').value = c.notes || '';
    } else {
        document.getElementById('case-modal-title').textContent = 'New Case File';
        document.getElementById('case-id').value = '';
        document.getElementById('case-year').value = new Date().getFullYear();
    }
    openModal('case-modal-overlay');
}

function populatePartnerSelect() {
    const select = document.getElementById('case-partner');
    select.innerHTML = '<option value="">Select Partner</option>' + 
        DB.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}

document.getElementById('case-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('case-id').value;
    const data = {
        case_type: document.getElementById('case-type').value,
        case_no: document.getElementById('case-no').value.trim(),
        case_year: document.getElementById('case-year').value.trim(),
        court_name: document.getElementById('case-court').value.trim(),
        court_hall: document.getElementById('case-hall').value.trim(),
        petitioner: document.getElementById('case-petitioner').value.trim(),
        respondent: document.getElementById('case-respondent').value.trim(),
        appearing_for: document.getElementById('case-appearing-for').value,
        partner_id: document.getElementById('case-partner').value,
        cnr_no: document.getElementById('case-cnr').value.trim(),
        notes: document.getElementById('case-notes').value.trim()
    };
    try {
        if (id) {
            const res = await API.updateCase(id, data);
            const idx = DB.cases.findIndex(x => x.id === id);
            DB.cases[idx] = res;
            showToast('Case file updated ✓');
        } else {
            const res = await API.createCase(data);
            DB.cases.unshift(res);
            showToast('Case file created ✓');
        }
        closeModal('case-modal-overlay');
        renderCases();
    } catch (err) { showToast(err.message, 'error'); }
});

// ============================================================
// DELETE
// ============================================================
async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    DB.tasks = DB.tasks.filter(t => t.id !== id); // optimistic
    renderPage(currentPage);
    try {
        await API.deleteTask(id);
        showToast('Task deleted');
        await fetchAll(); renderPage(currentPage);
    } catch (err) { showToast('Error deleting task', 'error'); await fetchAll(); renderPage(currentPage); }
}

async function deleteMember(id) {
    if (!confirm('Remove this member? Their tasks will become unassigned.')) return;
    DB.members = DB.members.filter(m => m.id !== id); // optimistic
    DB.tasks.forEach(t => { if (t.assigneeId === id) t.assigneeId = ''; });
    renderTeam(); refreshAssigneeSelects();
    try {
        await API.deleteMember(id);
        showToast('Member removed');
        await fetchAll(); renderPage(currentPage);
    } catch (err) { showToast('Error removing member', 'error'); await fetchAll(); renderPage(currentPage); }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function populateAssigneeSelect(selectId, selectedId) {
    const sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="">Select member</option>' +
        DB.members.map(m => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}
function populateAssigneeFilter(selectId, selectedVal) {
    const sel = document.getElementById(selectId);
    const cur = selectedVal || sel.value;
    sel.innerHTML = '<option value="all">All Members</option>' +
        DB.members.map(m => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}

// ============================================================
// SEARCH
// ============================================================
document.getElementById('search-input').addEventListener('input', () => {
    if (currentPage !== 'tasks') showPage('tasks');
    else renderTasks();
});

// ============================================================
// EVENT LISTENERS
// ============================================================
document.getElementById('new-task-btn').addEventListener('click', () => openTaskModal());

document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); })
);
document.querySelectorAll('.view-all').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); })
);
document.getElementById('add-member-btn').addEventListener('click', () => openMemberModal());

['task-modal-close', 'task-cancel-btn'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('task-modal-overlay'))
);
['member-modal-close', 'member-cancel-btn'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('member-modal-overlay'))
);
['case-modal-close', 'case-cancel-btn'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('case-modal-overlay'))
);
document.getElementById('detail-modal-close').addEventListener('click', () => closeModal('detail-modal-overlay'));
document.querySelectorAll('.modal-overlay').forEach(overlay =>
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); })
);
document.getElementById('sidebar-toggle').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open')
);

document.getElementById('cases-search-input').addEventListener('input', renderCases);
document.getElementById('add-case-btn').addEventListener('click', () => openCaseModal());

document.getElementById('case-back-btn').addEventListener('click', () => {
    window.location.hash = ''; // Clear hash
    showPage('dashboard');
});

// Hash routing for deep links
function handleHash() {
    const h = window.location.hash;
    if (h.startsWith('#case/')) {
        const id = h.split('/')[1];
        if (id) openCaseDetail(id);
    }
}
window.addEventListener('hashchange', handleHash);

document.getElementById('board-filter-assignee').addEventListener('change', renderBoard);
document.getElementById('board-filter-priority').addEventListener('change', renderBoard);
document.getElementById('tasks-filter-stage').addEventListener('change', renderTasks);
document.getElementById('tasks-filter-assignee').addEventListener('change', renderTasks);
document.getElementById('tasks-filter-priority').addEventListener('change', renderTasks);

// ============================================================
// LOGIN & INIT
// ============================================================
document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const err = document.getElementById('login-err');
    const btn = e.target.querySelector('button');
    err.style.display = 'none';
    btn.textContent = 'Authenticating…';
    btn.disabled = true;

    try {
        const res = await API.loginUser({ username: u, password: p });
        if (res.success) {
            localStorage.setItem('lnn_auth_user', u);
            document.getElementById('login-overlay').classList.add('hidden');
            initApp();
        }
    } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
    } finally {
        btn.textContent = 'Secure Login';
        btn.disabled = false;
    }
});

async function initApp() {
    setLoading(true);
    try {
        await fetchAll();
        refreshAssigneeSelects();
        
        // Handle deep links on init
        const h = window.location.hash;
        if (h.startsWith('#case/')) {
            handleHash();
        } else {
            showPage('dashboard');
        }
        
        startAutoRefresh();
    } catch (err) {
        showToast('Could not connect to database. Check your setup.', 'error');
        showPage('dashboard'); // render empty
    } finally {
        setLoading(false);
    }
}

// Initial Boot
(async () => {
    const user = localStorage.getItem('lnn_auth_user');
    if (!user) {
        document.getElementById('login-overlay').classList.remove('hidden');
    } else {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('current-user-name').textContent = user;
        document.getElementById('current-user-avatar').textContent = initials(user);
        initApp();
    }
})();

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('lnn_auth_user');
    location.reload();
});
