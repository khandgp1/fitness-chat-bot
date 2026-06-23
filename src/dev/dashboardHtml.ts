export function getDashboardHtml(clientId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GM Ritual Bot - Dev Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0d1117;
      --bg-card: #161b22;
      --bg-input: #21262d;
      --border-color: #30363d;
      --text-main: #c9d1d9;
      --text-muted: #8b949e;
      --text-bright: #f0f6fc;
      
      --color-primary: #58a6ff;
      --color-primary-hover: #1f6feb;
      --color-success: #3fb950;
      --color-success-bg: rgba(63, 185, 80, 0.15);
      --color-danger: #f85149;
      --color-danger-bg: rgba(248, 81, 73, 0.15);
      --color-warning: #d29922;
      --color-warning-bg: rgba(210, 153, 34, 0.15);
      --color-info: #bc8cff;
      --color-info-bg: rgba(188, 140, 255, 0.15);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: var(--bg-main);
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }

    /* Header styling */
    header {
      background-color: var(--bg-card);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-icon {
      font-size: 1.5rem;
      background: linear-gradient(135deg, var(--color-primary), var(--color-info));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
    }

    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text-bright);
      letter-spacing: -0.02em;
    }

    .clock-display {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
    }

    .clock-time {
      color: var(--color-primary);
      font-weight: 500;
    }

    .clock-offset {
      color: var(--text-muted);
      font-size: 0.75rem;
      border-left: 1px solid var(--border-color);
      padding-left: 1rem;
    }

    /* Main Layout */
    .dashboard-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-left {
      border-right: 1px solid var(--border-color);
    }

    .panel-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      background: rgba(22, 27, 34, 0.5);
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-bright);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Panel Contents */
    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    /* Chat log list */
    .chat-log {
      flex: 1;
      border: 1px solid var(--border-color);
      background-color: rgba(22, 27, 34, 0.3);
      border-radius: 8px;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 250px;
    }

    .chat-empty {
      color: var(--text-muted);
      text-align: center;
      margin: auto;
      font-style: italic;
      font-size: 0.9rem;
    }

    .chat-message {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      animation: fadeIn 0.2s ease-out;
    }

    .chat-message-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-bottom: 1px dashed var(--border-color);
      padding-bottom: 0.25rem;
      margin-bottom: 0.25rem;
    }

    .chat-user {
      color: var(--color-primary);
      font-weight: 600;
    }

    .chat-text {
      color: var(--text-bright);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      white-space: pre-wrap;
    }

    /* Badge styles */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.6rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .badge-compliant {
      background-color: var(--color-success-bg);
      color: var(--color-success);
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-miss {
      background-color: var(--color-danger-bg);
      color: var(--color-danger);
      border: 1px solid rgba(248, 81, 73, 0.3);
    }

    .badge-pending {
      background-color: var(--color-warning-bg);
      color: var(--color-warning);
      border: 1px solid rgba(210, 153, 34, 0.3);
    }

    .badge-unknown {
      background-color: rgba(139, 148, 158, 0.1);
      color: var(--text-muted);
      border: 1px solid rgba(139, 148, 158, 0.2);
    }

    /* Cards & Grids */
    .section-title {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-bright);
    }

    /* Forms & Inputs */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-row {
      display: flex;
      gap: 0.75rem;
    }

    label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    input, textarea, select {
      background-color: var(--bg-input);
      border: 1px solid var(--border-color);
      color: var(--text-bright);
      padding: 0.6rem 0.8rem;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.15s ease;
    }

    input:focus, textarea:focus, select:focus {
      border-color: var(--color-primary);
    }

    textarea {
      resize: vertical;
      min-height: 70px;
    }

    /* Buttons */
    .btn {
      background-color: var(--bg-input);
      border: 1px solid var(--border-color);
      color: var(--text-bright);
      padding: 0.6rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all 0.15s ease;
      user-select: none;
    }

    .btn:hover {
      background-color: var(--border-color);
      border-color: var(--text-muted);
    }

    .btn-primary {
      background-color: var(--color-primary);
      border-color: var(--color-primary-hover);
      color: #fff;
    }

    .btn-primary:hover {
      background-color: var(--color-primary-hover);
      border-color: var(--color-primary-hover);
    }

    .btn-danger {
      color: var(--color-danger);
    }

    .btn-danger:hover {
      background-color: var(--color-danger-bg);
      border-color: var(--color-danger);
    }

    .btn-group {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    /* Tabs & Tables */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 1rem;
    }

    .tab {
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }

    .tab:hover {
      color: var(--text-bright);
    }

    .tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
      font-weight: 600;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .data-table-container {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-card);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    th, td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      background-color: rgba(22, 27, 34, 0.6);
      font-weight: 600;
      color: var(--text-bright);
    }

    tr:last-child td {
      border-bottom: none;
    }

    .mono {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
    }

    .text-sm {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Animation */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="brand-icon">⚡</span>
      <span class="brand-title">GM Ritual Bot — Dev Dashboard</span>
    </div>
    <div class="clock-display">
      <span>Dev Clock:</span>
      <span class="clock-time" id="dev-time-display">Loading...</span>
      <span class="clock-offset" id="dev-offset-display">Offset: 0s</span>
    </div>
  </header>

  <div class="dashboard-container">
    <!-- LEFT PANEL: Chat Log -->
    <div class="panel panel-left">
      <div class="panel-header">
        <span>Webhook Message Stream</span>
        <span class="text-sm" id="messages-count">0 messages</span>
      </div>
      <div class="panel-content">
        <div class="chat-log" id="chat-log-container">
          <div class="chat-empty">No messages received yet. Send a message below to test!</div>
        </div>

        <form class="stat-card" id="webhook-form" style="gap: 1rem;">
          <div class="section-title" style="margin-bottom: 0;">Send Test Message (Webhook)</div>
          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label for="userId">Client ID</label>
              <input type="text" id="userId" value="${clientId}" required>
            </div>
          </div>
          <div class="form-group">
            <label for="message">Message Text</label>
            <textarea id="message" placeholder="Type a morning ritual check-in... (e.g. GM! Today is a great day)" required></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Send Message</button>
        </form>
      </div>
    </div>

    <!-- RIGHT PANEL: Bot State Inspector -->
    <div class="panel">
      <div class="panel-header">
        <span>Bot State Inspector</span>
        <span class="badge badge-unknown" id="state-client-id">Unknown</span>
      </div>
      <div class="panel-content">
        <!-- Client Stats Grid -->
        <div>
          <div class="section-title">Current State</div>
          <div class="grid-stats">
            <div class="stat-card">
              <span class="stat-label">Compliance</span>
              <span id="stat-compliance"><span class="badge badge-unknown">Unknown</span></span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Streak Count</span>
              <span class="stat-value" id="stat-streak">0</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">GM Today?</span>
              <span class="stat-value" id="stat-gm-received">No</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Response Level</span>
              <span class="stat-value" id="stat-response-level">0</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Window Position</span>
              <span class="stat-value" id="stat-window-pos">0</span>
            </div>
          </div>
        </div>

        <!-- Developer Controls Card -->
        <div class="stat-card">
          <div class="section-title">Developer Controls</div>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: space-between; align-items: center;">
              <div class="btn-group">
                <button class="btn btn-primary" onclick="triggerClockAction('advance-day')">☀️ Advance 1 Day</button>
                <button class="btn" onclick="triggerClockAction('advance-30min')">⏱️ Advance 30 Min</button>
                <button class="btn" onclick="triggerClockAction('reset-clock')">🔄 Reset Clock</button>
              </div>
              <button class="btn btn-danger" onclick="triggerResetClient()">🗑️ Reset Client Data</button>
            </div>
            <div class="text-sm">
              Note: Advancing the day will flush pending batches. Resetting client data deletes and re-creates the client state with fresh defaults.
            </div>
          </div>
        </div>

        <!-- Logs section -->
        <div>
          <div class="tabs">
            <div class="tab active" onclick="switchTab(event, 'tab-classification')">Classification Log</div>
            <div class="tab" onclick="switchTab(event, 'tab-gm')">GM Log</div>
            <div class="tab" onclick="switchTab(event, 'tab-pending')">Pending Review</div>
            <div class="tab" onclick="switchTab(event, 'tab-miss')">Miss Log</div>
          </div>

          <!-- Classification Log Tab -->
          <div id="tab-classification" class="tab-content active">
            <div class="data-table-container">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Message</th>
                    <th>Result</th>
                    <th>Reasoning</th>
                  </tr>
                </thead>
                <tbody id="classification-log-body">
                  <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- GM Log Tab -->
          <div id="tab-gm" class="tab-content">
            <div class="data-table-container">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Message</th>
                    <th>Reasoning</th>
                  </tr>
                </thead>
                <tbody id="gm-log-body">
                  <tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Pending Review Tab -->
          <div id="tab-pending" class="tab-content">
            <div class="data-table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Timestamp</th>
                    <th>Message</th>
                    <th>Failure Reason</th>
                  </tr>
                </thead>
                <tbody id="pending-log-body">
                  <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Miss Log Tab -->
          <div id="tab-miss" class="tab-content">
            <div class="data-table-container" style="padding: 1rem;">
              <div id="miss-log-content" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <span class="text-sm" style="color: var(--text-muted);">No misses recorded.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let lastStateHash = "";
    let lastMessagesHash = "";

    // Polling function
    async function pollData() {
      try {
        const [stateRes, messagesRes] = await Promise.all([
          fetch('/dev/api/state'),
          fetch('/dev/api/messages')
        ]);

        if (stateRes.ok && messagesRes.ok) {
          const stateData = await stateRes.json();
          const messagesData = await messagesRes.json();

          updateClockDisplay(stateData.clock);
          updateBotState(stateData.state);
          updateMessages(messagesData);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }

    function updateClockDisplay(clock) {
      if (!clock) return;
      const date = new Date(clock.devTime);
      document.getElementById('dev-time-display').textContent = date.toLocaleString();
      
      const offsetSec = Math.round(clock.offsetMs / 1000);
      let offsetText = "Offset: 0s";
      if (offsetSec !== 0) {
        const hours = Math.floor(Math.abs(offsetSec) / 3600);
        const mins = Math.floor((Math.abs(offsetSec) % 3600) / 60);
        const secs = Math.abs(offsetSec) % 60;
        offsetText = \`Offset: \${offsetSec > 0 ? '+' : '-'}\${hours}h \${mins}m \${secs}s\`;
      }
      document.getElementById('dev-offset-display').textContent = offsetText;
    }

    function updateBotState(state) {
      if (!state) return;
      
      // Simple hash to avoid redundant DOM updates
      const stateHash = JSON.stringify(state);
      if (stateHash === lastStateHash) return;
      lastStateHash = stateHash;

      document.getElementById('state-client-id').textContent = state.client_id || 'Unknown';
      
      // Compliance Status Badge
      const statusElement = document.getElementById('stat-compliance');
      const status = state.compliance_status || 'Unknown';
      let badgeClass = 'badge-unknown';
      if (status === 'Compliant') badgeClass = 'badge-compliant';
      if (status === 'Miss') badgeClass = 'badge-miss';
      if (status === 'Pending Review') badgeClass = 'badge-pending';
      
      statusElement.innerHTML = \`<span class="badge \${badgeClass}">\${status}</span>\`;
      
      document.getElementById('stat-streak').textContent = state.streak_count ?? 0;
      document.getElementById('stat-gm-received').textContent = state.gm_received_today ? 'Yes' : 'No';
      document.getElementById('stat-gm-received').style.color = state.gm_received_today ? 'var(--color-success)' : 'var(--text-muted)';
      document.getElementById('stat-response-level').textContent = state.current_response_level ?? 0;
      document.getElementById('stat-window-pos').textContent = state.window_position ?? 0;

      // Update Classification Log
      const classLogBody = document.getElementById('classification-log-body');
      if (state.classification_log && state.classification_log.length > 0) {
        classLogBody.innerHTML = state.classification_log.map(entry => {
          const badge = entry.is_valid_gm 
            ? '<span class="badge badge-compliant" style="font-size: 0.65rem; padding: 0.1rem 0.4rem;">Valid</span>'
            : '<span class="badge badge-miss" style="font-size: 0.65rem; padding: 0.1rem 0.4rem;">Invalid</span>';
          return \`<tr>
            <td class="mono">\${formatTimestamp(entry.timestamp)}</td>
            <td>\${escapeHtml(entry.message)}</td>
            <td>\${badge}</td>
            <td class="text-sm">\${escapeHtml(entry.reasoning || '')}</td>
          </tr>\`;
        }).reverse().join('');
      } else {
        classLogBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>';
      }

      // Update GM Log
      const gmLogBody = document.getElementById('gm-log-body');
      if (state.gm_log && state.gm_log.length > 0) {
        gmLogBody.innerHTML = state.gm_log.map(entry => {
          return \`<tr>
            <td class="mono">\${formatTimestamp(entry.timestamp)}</td>
            <td>\${escapeHtml(entry.message)}</td>
            <td class="text-sm">\${escapeHtml(entry.reasoning || '')}</td>
          </tr>\`;
        }).reverse().join('');
      } else {
        gmLogBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>';
      }

      // Update Pending Review Log
      const pendingLogBody = document.getElementById('pending-log-body');
      if (state.pending_review_log && state.pending_review_log.length > 0) {
        pendingLogBody.innerHTML = state.pending_review_log.map(entry => {
          return \`<tr>
            <td class="mono">\${entry.date}</td>
            <td class="mono">\${formatTimestamp(entry.timestamp)}</td>
            <td>\${escapeHtml(entry.message)}</td>
            <td class="text-sm" style="color: var(--color-warning);">\${escapeHtml(entry.failure_reason || '')}</td>
          </tr>\`;
        }).reverse().join('');
      } else {
        pendingLogBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No logs available</td></tr>';
      }

      // Update Miss Log
      const missLogContent = document.getElementById('miss-log-content');
      if (state.miss_log && state.miss_log.length > 0) {
        missLogContent.innerHTML = state.miss_log.map(date => {
          return \`<span class="badge badge-miss">\${date}</span>\`;
        }).reverse().join('');
      } else {
        missLogContent.innerHTML = '<span class="text-sm" style="color: var(--text-muted);">No misses recorded.</span>';
      }
    }

    function updateMessages(messages) {
      if (!messages) return;

      const messagesHash = JSON.stringify(messages);
      if (messagesHash === lastMessagesHash) return;
      lastMessagesHash = messagesHash;

      document.getElementById('messages-count').textContent = \`\${messages.length} messages\`;

      const chatLog = document.getElementById('chat-log-container');
      if (messages.length === 0) {
        chatLog.innerHTML = '<div class="chat-empty">No messages received yet. Send a message below to test!</div>';
        return;
      }

      const shouldScroll = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 50;

      chatLog.innerHTML = messages.map(msg => {
        return \`<div class="chat-message">
          <div class="chat-message-header">
            <span class="chat-user">\${escapeHtml(msg.userId)}</span>
            <span>\${formatTimestamp(msg.timestamp)}</span>
          </div>
          <div class="chat-text">\${escapeHtml(msg.message)}</div>
        </div>\`;
      }).join('');

      if (shouldScroll) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }

    // Helper functions
    function formatTimestamp(isoString) {
      if (!isoString) return '';
      try {
        const date = new Date(isoString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch {
        return isoString;
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function switchTab(evt, tabId) {
      const tabcontents = document.getElementsByClassName("tab-content");
      for (let i = 0; i < tabcontents.length; i++) {
        tabcontents[i].classList.remove("active");
      }

      const tabs = document.getElementsByClassName("tab");
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove("active");
      }

      document.getElementById(tabId).classList.add("active");
      evt.currentTarget.classList.add("active");
    }

    async function triggerClockAction(action) {
      try {
        const res = await fetch(\`/dev/\${action}\`, { method: 'POST' });
        if (res.ok) {
          await pollData();
        }
      } catch (err) {
        console.error(\`Failed to trigger clock action \${action}:\`, err);
      }
    }

    async function triggerResetClient() {
      try {
        const res = await fetch('/dev/reset', { method: 'POST' });
        if (res.ok) {
          // Clear hashes to force full UI refresh
          lastStateHash = "";
          await pollData();
        } else {
          const errData = await res.json();
          alert('Failed to reset client state: ' + (errData.error || res.statusText));
        }
      } catch (err) {
        console.error('Reset client error:', err);
        alert('Failed to reset client state: ' + err.message);
      }
    }

    // Handle Form Submission
    document.getElementById('webhook-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('userId').value;
      const messageInput = document.getElementById('message');
      const message = messageInput.value;

      if (!userId || !message) return;

      try {
        const res = await fetch('/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, message })
        });

        if (res.ok) {
          messageInput.value = '';
          await pollData();
        } else {
          alert('Failed to send webhook message: ' + res.statusText);
        }
      } catch (err) {
        console.error('Webhook post error:', err);
        alert('Failed to send webhook message: ' + err.message);
      }
    });

    // Start polling immediately and then every 3s
    pollData();
    setInterval(pollData, 3000);
  </script>
</body>
</html>`;
}
