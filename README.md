# ⚖️ LNN Legal — Office Work Management System

A premium, browser-based office work management system built for legal teams to track, assign, and manage case work across stages.

## Features

- **Kanban Work Board** — Drag & drop tasks across stages: Drafting → Review → Filing → Pending Works → Completed
- **Task Management** — Create tasks with client name, case number, assignee, priority, due date, and notes
- **Dashboard** — Live stats, recent tasks, team workload overview, and stage breakdown
- **All Tasks Table** — Filter and search by stage, assignee, priority, or keyword
- **Team Management** — Add/remove team members; view active vs. completed task counts per member
- **Priority Tracking** — High / Medium / Low with color-coded indicators and due date alerts
- **Data Persistence** — All data saved in browser `localStorage` — no backend required

## Getting Started

No installation needed. Just open `index.html` in any modern browser.

```
git clone https://github.com/YOUR_USERNAME/lnn-legal.git
cd lnn-legal
open index.html   # macOS
# or double-click index.html on Windows/Linux
```

## Tech Stack

- Pure **HTML5**, **CSS3**, **Vanilla JavaScript**
- No frameworks, no dependencies, no build step
- Google Fonts (Inter)

## File Structure

```
├── index.html   # Main HTML structure
├── styles.css   # All styling (dark theme, animations)
├── app.js       # Application logic, data store, rendering
└── README.md
```

## Usage

1. Open `index.html` in your browser
2. Go to **Team** → Add your team members
3. Click **+ New Task** to create and assign work
4. Use **Work Board** to drag tasks between stages
5. Monitor progress from the **Dashboard**
