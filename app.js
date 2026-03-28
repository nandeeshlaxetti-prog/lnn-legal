/* ===== app.js — LexOffice Office Management System ===== */

// ============================================================
// DATA STORE
// ============================================================
const DB = {
    load() {
        this.tasks = JSON.parse(localStorage.getItem('lx_tasks') || '[]');
        this.members = JSON.parse(localStorage.getItem('lx_members') || '[]');
    },
    save() {
        localStorage.setItem('lx_tasks', JSON.stringify(this.tasks));
        localStorage.setItem('lx_members', JSON.stringify(this.members));
    }
};

const STAGES = ['Drafting', 'Review', 'Filing', 'Pending Works', 'Completed'];
const STAGE_META = {
    'Drafting': { dot: '#6366f1', cls: 'badge-drafting' },
    'Review': { dot: '#f59e0b', cls: 'badge-review' },
    'Filing': { dot: '#3b82f6', cls: 'badge-filing' },
    'Pending Works': { dot: '#ef4444', cls: 'badge-pending' },
    'Completed': { dot: '#10b981', cls: 'badge-completed' },
};
const PRIORITY_META = {
    high: { cls: 'pill-high', color: '#ef4444', label: '🔴 High' },
    medium: { cls: 'pill-medium', color: '#f59e0b', label: '🟡 Medium' },
    low: { cls: 'pill-low', color: '#10b981', label: '🟢 Low' },
};

// ============================================================
// UTILITIES
// ============================================================
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
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

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = 'toast', 2800);
}

// ============================================================
// NAVIGATION
// ============================================================
let currentPage = 'dashboard';
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.getElementById(`nav-${page}`)?.classList.add('active');
    document.getElementById('page-title').textContent =
        { dashboard: 'Dashboard', board: 'Work Board', tasks: 'All Tasks', team: 'Team' }[page];
    currentPage = page;
    renderPage(page);

    // Close sidebar on mobile
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}
function renderPage(page) {
    if (page === 'dashboard') renderDashboard();
    if (page === 'board') renderBoard();
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
    const recent = [...tasks].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 6);
    recentList.innerHTML = recent.map(t => {
        const sm = STAGE_META[t.stage];
        return `<div class="task-list-item" onclick="openDetail('${t.id}')">
      <div class="tli-info">
        <div class="tli-title">${esc(t.title)}</div>
        <div class="tli-meta">${t.client ? esc(t.client) + ' · ' : ''}${t.caseNo || ''}</div>
      </div>
      <span class="tli-stage ${sm.cls}">${t.stage}</span>
    </div>`;
    }).join('') || '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">No tasks yet</p>';

    // Workload
    const wl = document.getElementById('workload-list');
    const maxTasks = Math.max(...DB.members.map(m => tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length), 1);
    wl.innerHTML = DB.members.map(m => {
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
// BOARD (KANBAN)
// ============================================================
let draggedTask = null;

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
        <div class="col-title">
          <span class="col-dot" style="background:${sm.dot}"></span>
          ${stage}
        </div>
        <span class="col-count">${staged.length}</span>
      </div>
      <div class="kanban-cards" data-stage="${stage}"></div>
    `;
        const cardsEl = col.querySelector('.kanban-cards');

        staged.forEach(task => {
            cardsEl.appendChild(buildKCard(task));
        });

        // Drag-over
        cardsEl.addEventListener('dragover', e => {
            e.preventDefault();
            cardsEl.classList.add('drag-over');
        });
        cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drag-over'));
        cardsEl.addEventListener('drop', e => {
            e.preventDefault();
            cardsEl.classList.remove('drag-over');
            if (draggedTask) {
                const newStage = cardsEl.dataset.stage;
                if (draggedTask.stage !== newStage) {
                    draggedTask.stage = newStage;
                    DB.save();
                    showToast(`Moved to "${newStage}"`, 'success');
                    renderBoard();
                    if (currentPage === 'dashboard') renderDashboard();
                }
                draggedTask = null;
            }
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
    ${task.client ? `<div class="kcard-client">${esc(task.client)} ${task.caseNo ? '· ' + esc(task.caseNo) : ''}</div>` : ''}
    <div class="kcard-footer">
      <div class="kcard-assignee">
        <div class="kcard-avatar">${initials(member.name)}</div>
        ${esc(member.name.split(' ')[0])}
      </div>
      ${task.due ? `<span class="kcard-due ${ds}">${dueTxt(task.due)}</span>` : ''}
    </div>
    <div class="kcard-actions">
      <button class="kcard-btn" onclick="openDetail('${task.id}')">👁 View</button>
      <button class="kcard-btn" onclick="openTaskModal('${task.id}')">✏️ Edit</button>
      <button class="kcard-btn" onclick="deleteTask('${task.id}')">🗑 Delete</button>
    </div>
  `;
    card.addEventListener('dragstart', () => { draggedTask = task; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); });
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
        (t.caseNo || '').toLowerCase().includes(searchVal)
    );

    const tbody = document.getElementById('tasks-table-body');
    const empty = document.getElementById('tasks-empty');
    const table = document.getElementById('tasks-table');

    if (tasks.length === 0) {
        tbody.innerHTML = '';
        table.style.display = 'none';
        empty.style.display = 'flex';
        empty.style.flexDirection = 'column';
        empty.style.alignItems = 'center';
        return;
    }
    table.style.display = '';
    empty.style.display = 'none';

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
      <td>
        <div class="assignee-chip">
          <div class="chip-av">${initials(member.name)}</div>
          ${esc(member.name)}
        </div>
      </td>
      <td><span class="stage-badge ${sm.cls}">${t.stage}</span></td>
      <td><span class="priority-pill ${pm.cls}">${pm.label}</span></td>
      <td><span class="due-text ${ds !== 'none' ? ds : ''}">${dueTxt(t.due)}</span></td>
      <td onclick="event.stopPropagation()">
        <button class="action-btn" title="Edit"   onclick="openTaskModal('${t.id}')">✏️</button>
        <button class="action-btn" title="Delete" onclick="deleteTask('${t.id}')">🗑️</button>
      </td>
    </tr>`;
    }).join('');
}

// ============================================================
// TEAM
// ============================================================
function renderTeam() {
    const grid = document.getElementById('team-grid');
    if (DB.members.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted);font-size:14px">No members yet. Add one above.</p>';
        return;
    }
    grid.innerHTML = DB.members.map(m => {
        const active = DB.tasks.filter(t => t.assigneeId === m.id && t.stage !== 'Completed').length;
        const completed = DB.tasks.filter(t => t.assigneeId === m.id && t.stage === 'Completed').length;
        return `<div class="member-card">
      <button class="member-delete" onclick="deleteMember('${m.id}')" title="Remove">✕</button>
      <div class="member-av">${initials(m.name)}</div>
      <div class="member-name">${esc(m.name)}</div>
      <div class="member-role">${esc(m.role || '—')}</div>
      ${m.email ? `<div class="member-email">${esc(m.email)}</div>` : ''}
      <div class="member-stats">
        <div class="mstat"><div class="mstat-val" style="color:#6366f1">${active}</div><div class="mstat-lbl">Active</div></div>
        <div class="mstat"><div class="mstat-val" style="color:#10b981">${completed}</div><div class="mstat-lbl">Done</div></div>
      </div>
    </div>`;
    }).join('');
}

function deleteMember(id) {
    if (!confirm('Remove this member? Their tasks will become unassigned.')) return;
    DB.tasks.forEach(t => { if (t.assigneeId === id) t.assigneeId = ''; });
    DB.members = DB.members.filter(m => m.id !== id);
    DB.save();
    renderTeam();
    showToast('Member removed');
}

// ============================================================
// TASK MODAL
// ============================================================
function openTaskModal(taskId = null) {
    const form = document.getElementById('task-form');
    const title = document.getElementById('task-modal-title');
    form.reset();
    populateAssigneeSelect('task-assignee', '');

    if (taskId) {
        const t = DB.tasks.find(t => t.id === taskId);
        if (!t) return;
        title.textContent = 'Edit Task';
        document.getElementById('task-id').value = t.id;
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-client').value = t.client || '';
        document.getElementById('task-case-no').value = t.caseNo || '';
        document.getElementById('task-stage').value = t.stage;
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-due').value = t.due || '';
        document.getElementById('task-notes').value = t.notes || '';
        populateAssigneeSelect('task-assignee', t.assigneeId);
    } else {
        title.textContent = 'New Task';
        document.getElementById('task-id').value = '';
    }
    openModal('task-modal-overlay');
}

document.getElementById('task-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value.trim();
    if (!title) { showToast('Title is required', 'error'); return; }
    const assigneeId = document.getElementById('task-assignee').value;
    if (!assigneeId) { showToast('Please assign to a member', 'error'); return; }

    const data = {
        title,
        client: document.getElementById('task-client').value.trim(),
        caseNo: document.getElementById('task-case-no').value.trim(),
        assigneeId,
        stage: document.getElementById('task-stage').value,
        priority: document.getElementById('task-priority').value,
        due: document.getElementById('task-due').value,
        notes: document.getElementById('task-notes').value.trim(),
    };

    if (id) {
        const idx = DB.tasks.findIndex(t => t.id === id);
        DB.tasks[idx] = { ...DB.tasks[idx], ...data };
        showToast('Task updated ✓');
    } else {
        DB.tasks.push({ id: uid(), ...data });
        showToast('Task created ✓');
    }
    DB.save();
    closeModal('task-modal-overlay');
    renderPage(currentPage);
});

// ============================================================
// MEMBER MODAL
// ============================================================
document.getElementById('member-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('member-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    DB.members.push({
        id: uid(),
        name,
        role: document.getElementById('member-role').value.trim(),
        email: document.getElementById('member-email').value.trim(),
    });
    DB.save();
    closeModal('member-modal-overlay');
    renderTeam();
    showToast('Member added ✓');
    // refresh selects
    populateAssigneeSelect('task-assignee', '');
    populateAssigneeFilter('board-filter-assignee', 'all');
    populateAssigneeFilter('tasks-filter-assignee', 'all');
});

// ============================================================
// DETAIL MODAL
// ============================================================
function openDetail(taskId) {
    const t = DB.tasks.find(t => t.id === taskId);
    if (!t) return;
    const member = getMember(t.assigneeId);
    const sm = STAGE_META[t.stage] || {};
    const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium;
    const ds = dueStatus(t.due);

    document.getElementById('detail-title').textContent = t.title;

    const body = document.getElementById('detail-body');
    body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-field"><label>Client</label><p>${esc(t.client || '—')}</p></div>
      <div class="detail-field"><label>Case No.</label><p>${esc(t.caseNo || '—')}</p></div>
      <div class="detail-field"><label>Assigned To</label>
        <div class="assignee-chip" style="margin-top:4px">
          <div class="chip-av">${initials(member.name)}</div> ${esc(member.name)}
        </div>
      </div>
      <div class="detail-field"><label>Priority</label><p><span class="priority-pill ${pm.cls}">${pm.label}</span></p></div>
      <div class="detail-field"><label>Stage</label><p><span class="stage-badge ${sm.cls}">${t.stage}</span></p></div>
      <div class="detail-field"><label>Due Date</label><p class="due-text ${ds}">${dueTxt(t.due)}</p></div>
    </div>
    <div class="detail-field" style="margin-bottom:16px"><label>Notes</label><div class="detail-notes">${esc(t.notes || 'No notes.')}</div></div>
    <div class="detail-field"><label>Change Stage</label>
      <div class="detail-actions">
        ${STAGES.map(s => {
        const active = s === t.stage;
        const color = STAGE_META[s].dot;
        return `<button class="detail-stage-btn" 
            style="color:${color}; border-color:${color}; ${active ? 'opacity: 0.4; cursor:default;' : ''}"
            onclick="${active ? '' : `changeStage('${t.id}','${s}')`}">${s}</button>`;
    }).join('')}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-secondary" onclick="closeModal('detail-modal-overlay')">Close</button>
      <button class="btn-primary" onclick="closeModal('detail-modal-overlay'); openTaskModal('${t.id}')">✏️ Edit Task</button>
    </div>
  `;
    openModal('detail-modal-overlay');
}

function changeStage(taskId, newStage) {
    const t = DB.tasks.find(t => t.id === taskId);
    if (!t) return;
    t.stage = newStage;
    DB.save();
    closeModal('detail-modal-overlay');
    showToast(`Moved to "${newStage}"`, 'success');
    renderPage(currentPage);
}

// ============================================================
// DELETE TASK
// ============================================================
function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    DB.tasks = DB.tasks.filter(t => t.id !== id);
    DB.save();
    renderPage(currentPage);
    showToast('Task deleted');
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
    if (currentPage === 'tasks') renderTasks();
    else { showPage('tasks'); }
});

// ============================================================
// ESCAPE HTML
// ============================================================
function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.getElementById('new-task-btn').addEventListener('click', () => openTaskModal());

document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
});

document.querySelectorAll('.view-all').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
});

document.getElementById('add-member-btn').addEventListener('click', () => {
    document.getElementById('member-form').reset();
    openModal('member-modal-overlay');
});

// Close modals
['task-modal-close', 'task-cancel-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => closeModal('task-modal-overlay'));
});
['member-modal-close', 'member-cancel-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => closeModal('member-modal-overlay'));
});
document.getElementById('detail-modal-close').addEventListener('click', () => closeModal('detail-modal-overlay'));

// Click outside modal to close
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});

// Sidebar toggle (mobile)
document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// Board filters
document.getElementById('board-filter-assignee').addEventListener('change', renderBoard);
document.getElementById('board-filter-priority').addEventListener('change', renderBoard);
document.getElementById('tasks-filter-stage').addEventListener('change', renderTasks);
document.getElementById('tasks-filter-assignee').addEventListener('change', renderTasks);
document.getElementById('tasks-filter-priority').addEventListener('change', renderTasks);

// Sidebar nav active glow color per stage
document.documentElement.style.setProperty('--stage-draft-color', '#6366f1');

// ============================================================
// INIT
// ============================================================
DB.load();
showPage('dashboard');
