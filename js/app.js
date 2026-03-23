/* ========================================
   Hangar — Docker Manager
   Main Application Logic
   ======================================== */

class Hangar {
    constructor() {
        this.apiUrl = '';
        this.containers = [];
        this.images = [];
        this.volumes = [];
        this.networks = [];
        this.currentView = 'containers';
        this.containerFilter = 'all';
        this.refreshInterval = null;
        this.logAbortController = null;

        this.init();
    }

    init() {
        // Check for saved connection
        const saved = localStorage.getItem('hangar-api-url');
        if (saved) {
            document.getElementById('docker-url').value = saved;
        }

        this.bindEvents();
    }

    bindEvents() {
        // Connection
        document.getElementById('connect-btn').addEventListener('click', () => this.connect());
        document.getElementById('docker-url').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.connect();
        });
        document.getElementById('disconnect-btn').addEventListener('click', () => this.disconnect());
        document.getElementById('refresh-btn').addEventListener('click', () => this.refreshAll());

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchView(btn.dataset.view));
        });

        // Container filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setContainerFilter(btn.dataset.filter));
        });

        // Search
        document.getElementById('container-search').addEventListener('input', (e) => {
            this.renderContainers(e.target.value);
        });

        // Image actions
        document.getElementById('pull-image-btn').addEventListener('click', () => this.showPullModal());
        document.getElementById('prune-images-btn').addEventListener('click', () => this.pruneImages());
        document.getElementById('pull-cancel').addEventListener('click', () => this.hidePullModal());
        document.getElementById('pull-confirm').addEventListener('click', () => this.pullImage());
        document.getElementById('pull-image-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.pullImage();
        });

        // Volume actions
        document.getElementById('prune-volumes-btn').addEventListener('click', () => this.pruneVolumes());

        // Drawers
        document.getElementById('log-close').addEventListener('click', () => this.closeLogDrawer());
        document.getElementById('inspect-close').addEventListener('click', () => this.closeInspectDrawer());
        document.getElementById('log-clear').addEventListener('click', () => {
            document.getElementById('log-output').textContent = '';
        });

        // Confirm modal
        document.getElementById('confirm-cancel').addEventListener('click', () => this.hideConfirmModal());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeLogDrawer();
                this.closeInspectDrawer();
                this.hidePullModal();
                this.hideConfirmModal();
            }
        });
    }

    // ========================================
    // Connection
    // ========================================

    async connect() {
        const urlInput = document.getElementById('docker-url');
        const errorEl = document.getElementById('connect-error');
        const btn = document.getElementById('connect-btn');
        const url = urlInput.value.trim().replace(/\/$/, '');

        if (!url) {
            this.showConnectError('Please enter a Docker API URL');
            return;
        }

        btn.textContent = 'Connecting...';
        btn.disabled = true;
        errorEl.classList.add('hidden');

        try {
            const resp = await fetch(`${url}/version`, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            this.apiUrl = url;
            localStorage.setItem('hangar-api-url', url);

            document.getElementById('docker-version').textContent = `Docker ${data.Version} (API ${data.ApiVersion})`;
            document.getElementById('connect-modal').classList.remove('active');
            document.getElementById('main-app').classList.remove('hidden');

            this.refreshAll();
            this.refreshInterval = setInterval(() => this.refreshAll(), 5000);

        } catch (err) {
            this.showConnectError(this.friendlyError(err));
        } finally {
            btn.textContent = 'Connect';
            btn.disabled = false;
        }
    }

    friendlyError(err) {
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            return 'Cannot reach Docker API. Make sure the Docker socket is exposed via TCP.';
        }
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
            return 'Connection timed out. Is Docker running?';
        }
        return `Connection failed: ${err.message}`;
    }

    showConnectError(msg) {
        const el = document.getElementById('connect-error');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    disconnect() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = null;
        this.closeLogDrawer();
        this.closeInspectDrawer();
        document.getElementById('main-app').classList.add('hidden');
        document.getElementById('connect-modal').classList.add('active');
    }

    // ========================================
    // API Helpers
    // ========================================

    async api(path, options = {}) {
        const resp = await fetch(`${this.apiUrl}${path}`, {
            ...options,
            signal: options.signal || AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(text || `HTTP ${resp.status}`);
        }
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('json')) return resp.json();
        return resp.text();
    }

    // ========================================
    // Refresh Data
    // ========================================

    async refreshAll() {
        try {
            const [containers, images, volumes, networks] = await Promise.all([
                this.api('/containers/json?all=true'),
                this.api('/images/json'),
                this.api('/volumes'),
                this.api('/networks'),
            ]);

            this.containers = containers || [];
            this.images = images || [];
            this.volumes = (volumes && volumes.Volumes) || [];
            this.networks = networks || [];

            // Update counts
            document.getElementById('container-count').textContent = this.containers.length;
            document.getElementById('image-count').textContent = this.images.length;
            document.getElementById('volume-count').textContent = this.volumes.length;
            document.getElementById('network-count').textContent = this.networks.length;

            // Update status
            const indicator = document.getElementById('status-indicator');
            indicator.classList.remove('error');
            indicator.querySelector('.status-text').textContent = 'Connected';

            this.renderCurrentView();

        } catch (err) {
            const indicator = document.getElementById('status-indicator');
            indicator.classList.add('error');
            indicator.querySelector('.status-text').textContent = 'Disconnected';
        }
    }

    renderCurrentView() {
        switch (this.currentView) {
            case 'containers': this.renderContainers(); break;
            case 'images': this.renderImages(); break;
            case 'volumes': this.renderVolumes(); break;
            case 'networks': this.renderNetworks(); break;
        }
    }

    // ========================================
    // Navigation
    // ========================================

    switchView(view) {
        this.currentView = view;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-view="${view}"]`).classList.add('active');

        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${view}`).classList.add('active');

        this.renderCurrentView();
    }

    // ========================================
    // Containers
    // ========================================

    setContainerFilter(filter) {
        this.containerFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        this.renderContainers();
    }

    renderContainers(search = '') {
        const list = document.getElementById('container-list');
        const searchTerm = search || document.getElementById('container-search').value;
        let filtered = [...this.containers];

        // Apply filter
        if (this.containerFilter === 'running') {
            filtered = filtered.filter(c => c.State === 'running');
        } else if (this.containerFilter === 'stopped') {
            filtered = filtered.filter(c => c.State !== 'running');
        }

        // Apply search
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            filtered = filtered.filter(c => {
                const name = this.containerName(c).toLowerCase();
                const image = (c.Image || '').toLowerCase();
                return name.includes(q) || image.includes(q);
            });
        }

        if (filtered.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>No containers found</p></div>';
            return;
        }

        // Sort: running first, then by name
        filtered.sort((a, b) => {
            if (a.State === 'running' && b.State !== 'running') return -1;
            if (a.State !== 'running' && b.State === 'running') return 1;
            return this.containerName(a).localeCompare(this.containerName(b));
        });

        list.innerHTML = filtered.map(c => this.containerCardHTML(c)).join('');

        // Bind card actions
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                this.containerAction(id, action);
            });
        });
    }

    containerName(c) {
        if (c.Names && c.Names.length) {
            return c.Names[0].replace(/^\//, '');
        }
        return c.Id.substring(0, 12);
    }

    containerCardHTML(c) {
        const name = this.containerName(c);
        const state = c.State || 'unknown';
        const image = c.Image || '';
        const shortId = c.Id.substring(0, 12);
        const isRunning = state === 'running';

        // Format ports
        const ports = (c.Ports || [])
            .filter(p => p.PublicPort)
            .map(p => `${p.PublicPort}:${p.PrivatePort}`)
            .slice(0, 3);

        const portsHtml = ports.map(p => `<span class="port-tag">${this.escapeHtml(p)}</span>`).join('');

        // Compose project label
        const composeProject = c.Labels && c.Labels['com.docker.compose.project'];
        const composeTag = composeProject
            ? `<span class="meta-item"><span>compose:</span>${this.escapeHtml(composeProject)}</span>`
            : '';

        return `
            <div class="container-card">
                <div class="container-status ${state}"></div>
                <div class="container-info">
                    <div class="container-name" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</div>
                    <div class="container-meta">
                        <span class="container-image" title="${this.escapeHtml(image)}">${this.escapeHtml(image)}</span>
                        <span class="container-state ${state}">${state}</span>
                        ${composeTag}
                    </div>
                </div>
                <div class="container-ports">${portsHtml}</div>
                <div class="container-actions">
                    ${isRunning ? `
                        <button class="action-btn" data-action="stop" data-id="${shortId}" title="Stop">Stop</button>
                        <button class="action-btn" data-action="restart" data-id="${shortId}" title="Restart">Restart</button>
                    ` : `
                        <button class="action-btn start" data-action="start" data-id="${shortId}" title="Start">Start</button>
                    `}
                    <button class="action-btn" data-action="logs" data-id="${shortId}" title="Logs">Logs</button>
                    <button class="action-btn" data-action="inspect" data-id="${shortId}" title="Inspect">Inspect</button>
                    <button class="action-btn danger" data-action="remove" data-id="${shortId}" title="Remove">Remove</button>
                </div>
            </div>
        `;
    }

    async containerAction(id, action) {
        try {
            switch (action) {
                case 'start':
                    await this.api(`/containers/${id}/start`, { method: 'POST' });
                    this.toast(`Container ${id} started`, 'success');
                    break;
                case 'stop':
                    await this.api(`/containers/${id}/stop`, { method: 'POST' });
                    this.toast(`Container ${id} stopped`, 'success');
                    break;
                case 'restart':
                    await this.api(`/containers/${id}/restart`, { method: 'POST' });
                    this.toast(`Container ${id} restarted`, 'success');
                    break;
                case 'remove':
                    this.showConfirm(
                        'Remove Container',
                        `Remove container ${id}? This cannot be undone.`,
                        async () => {
                            // Force stop if running
                            try { await this.api(`/containers/${id}/stop`, { method: 'POST' }); } catch {}
                            await this.api(`/containers/${id}?force=true`, { method: 'DELETE' });
                            this.toast(`Container ${id} removed`, 'success');
                            this.refreshAll();
                        }
                    );
                    return;
                case 'logs':
                    this.openLogDrawer(id);
                    return;
                case 'inspect':
                    this.openInspectDrawer('container', id);
                    return;
            }
            setTimeout(() => this.refreshAll(), 500);
        } catch (err) {
            this.toast(`Failed: ${err.message}`, 'error');
        }
    }

    // ========================================
    // Log Drawer
    // ========================================

    async openLogDrawer(containerId) {
        this.closeLogDrawer();

        const container = this.containers.find(c => c.Id.startsWith(containerId));
        const name = container ? this.containerName(container) : containerId;

        document.getElementById('log-container-name').textContent = `Logs — ${name}`;
        document.getElementById('log-output').textContent = '';
        document.getElementById('log-drawer').classList.remove('hidden');

        // Adjust main padding
        document.querySelector('main').style.paddingBottom = '45vh';

        this.logAbortController = new AbortController();

        try {
            const resp = await fetch(
                `${this.apiUrl}/containers/${containerId}/logs?stdout=true&stderr=true&tail=200&follow=true&timestamps=true`,
                { signal: this.logAbortController.signal }
            );

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            const output = document.getElementById('log-output');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                let text = decoder.decode(value, { stream: true });
                // Docker multiplexed stream: strip 8-byte header frames
                text = this.stripDockerStreamHeaders(text);

                output.textContent += text;

                // Auto-scroll if follow is enabled
                if (document.getElementById('log-follow').checked) {
                    output.scrollTop = output.scrollHeight;
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                document.getElementById('log-output').textContent += `\n[Error: ${err.message}]`;
            }
        }
    }

    stripDockerStreamHeaders(text) {
        // Docker multiplexed stream has 8-byte headers
        // This is a best-effort cleanup for text display
        return text.replace(/[\x00-\x08]/g, '');
    }

    closeLogDrawer() {
        if (this.logAbortController) {
            this.logAbortController.abort();
            this.logAbortController = null;
        }
        document.getElementById('log-drawer').classList.add('hidden');
        document.querySelector('main').style.paddingBottom = '';
    }

    // ========================================
    // Inspect Drawer
    // ========================================

    async openInspectDrawer(type, id) {
        this.closeInspectDrawer();

        let endpoint;
        switch (type) {
            case 'container': endpoint = `/containers/${id}/json`; break;
            case 'image': endpoint = `/images/${id}/json`; break;
            case 'volume': endpoint = `/volumes/${id}`; break;
            case 'network': endpoint = `/networks/${id}`; break;
        }

        document.getElementById('inspect-title').textContent = `Inspect — ${id}`;
        document.getElementById('inspect-output').textContent = 'Loading...';
        document.getElementById('inspect-drawer').classList.remove('hidden');
        document.querySelector('main').style.paddingBottom = '45vh';

        try {
            const data = await this.api(endpoint);
            document.getElementById('inspect-output').textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            document.getElementById('inspect-output').textContent = `Error: ${err.message}`;
        }
    }

    closeInspectDrawer() {
        document.getElementById('inspect-drawer').classList.add('hidden');
        document.querySelector('main').style.paddingBottom = '';
    }

    // ========================================
    // Images
    // ========================================

    renderImages() {
        const list = document.getElementById('image-list');

        if (!this.images.length) {
            list.innerHTML = '<div class="empty-state"><p>No images found</p></div>';
            return;
        }

        const sorted = [...this.images].sort((a, b) => {
            const aName = this.imageName(a);
            const bName = this.imageName(b);
            return aName.localeCompare(bName);
        });

        list.innerHTML = sorted.map(img => {
            const name = this.imageName(img);
            const size = this.formatBytes(img.Size);
            const created = this.timeAgo(img.Created);
            const shortId = (img.Id || '').replace('sha256:', '').substring(0, 12);

            return `
                <div class="image-card">
                    <div class="image-info">
                        <div class="image-name" title="${this.escapeHtml(name)}">${this.escapeHtml(name)}</div>
                        <div class="image-meta">
                            <span class="meta-item"><span>ID:</span>${shortId}</span>
                            <span class="meta-item"><span>Created:</span>${created}</span>
                        </div>
                    </div>
                    <span class="image-size">${size}</span>
                    <div class="container-actions">
                        <button class="action-btn" data-action="inspect-image" data-id="${this.escapeHtml(img.Id)}" title="Inspect">Inspect</button>
                        <button class="action-btn danger" data-action="remove-image" data-id="${this.escapeHtml(img.Id)}" title="Remove">Remove</button>
                    </div>
                </div>
            `;
        }).join('');

        // Bind actions
        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'inspect-image') {
                    this.openInspectDrawer('image', id);
                } else if (action === 'remove-image') {
                    this.showConfirm('Remove Image', `Remove image ${id.substring(0, 19)}...?`, async () => {
                        try {
                            await this.api(`/images/${id}?force=true`, { method: 'DELETE' });
                            this.toast('Image removed', 'success');
                            this.refreshAll();
                        } catch (err) {
                            this.toast(`Failed: ${err.message}`, 'error');
                        }
                    });
                }
            });
        });
    }

    imageName(img) {
        if (img.RepoTags && img.RepoTags.length && img.RepoTags[0] !== '<none>:<none>') {
            return img.RepoTags[0];
        }
        if (img.RepoDigests && img.RepoDigests.length) {
            const d = img.RepoDigests[0];
            const name = d.split('@')[0];
            return `${name}@${(img.Id || '').replace('sha256:', '').substring(0, 12)}`;
        }
        return (img.Id || '').replace('sha256:', '').substring(0, 12);
    }

    // ========================================
    // Volumes
    // ========================================

    renderVolumes() {
        const list = document.getElementById('volume-list');

        if (!this.volumes.length) {
            list.innerHTML = '<div class="empty-state"><p>No volumes found</p></div>';
            return;
        }

        list.innerHTML = this.volumes.map(vol => {
            const name = vol.Name || 'unnamed';
            const driver = vol.Driver || 'local';
            const mountpoint = vol.Mountpoint || '';
            const shortName = name.length > 40 ? name.substring(0, 37) + '...' : name;

            return `
                <div class="volume-card">
                    <div class="volume-info">
                        <div class="volume-name" title="${this.escapeHtml(name)}">${this.escapeHtml(shortName)}</div>
                        <div class="volume-meta">
                            <span class="meta-item"><span>Driver:</span>${this.escapeHtml(driver)}</span>
                            <span class="meta-item"><span>Mount:</span>${this.escapeHtml(mountpoint)}</span>
                        </div>
                    </div>
                    <div class="container-actions">
                        <button class="action-btn" data-action="inspect-vol" data-id="${this.escapeHtml(name)}" title="Inspect">Inspect</button>
                        <button class="action-btn danger" data-action="remove-vol" data-id="${this.escapeHtml(name)}" title="Remove">Remove</button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'inspect-vol') {
                    this.openInspectDrawer('volume', id);
                } else if (action === 'remove-vol') {
                    this.showConfirm('Remove Volume', `Remove volume ${id}? Data will be lost.`, async () => {
                        try {
                            await this.api(`/volumes/${id}`, { method: 'DELETE' });
                            this.toast('Volume removed', 'success');
                            this.refreshAll();
                        } catch (err) {
                            this.toast(`Failed: ${err.message}`, 'error');
                        }
                    });
                }
            });
        });
    }

    // ========================================
    // Networks
    // ========================================

    renderNetworks() {
        const list = document.getElementById('network-list');

        if (!this.networks.length) {
            list.innerHTML = '<div class="empty-state"><p>No networks found</p></div>';
            return;
        }

        const sorted = [...this.networks].sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));

        list.innerHTML = sorted.map(net => {
            const name = net.Name || 'unnamed';
            const driver = net.Driver || '';
            const scope = net.Scope || '';
            const shortId = (net.Id || '').substring(0, 12);
            const containers = Object.keys(net.Containers || {}).length;

            return `
                <div class="network-card">
                    <div class="network-info">
                        <div class="network-name">${this.escapeHtml(name)}</div>
                        <div class="network-meta">
                            <span class="meta-item"><span>ID:</span>${shortId}</span>
                            <span class="meta-item"><span>Scope:</span>${this.escapeHtml(scope)}</span>
                            <span class="meta-item"><span>Containers:</span>${containers}</span>
                        </div>
                    </div>
                    <span class="network-driver">${this.escapeHtml(driver)}</span>
                    <div class="container-actions">
                        <button class="action-btn" data-action="inspect-net" data-id="${this.escapeHtml(net.Id)}" title="Inspect">Inspect</button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openInspectDrawer('network', btn.dataset.id);
            });
        });
    }

    // ========================================
    // Pull Image
    // ========================================

    showPullModal() {
        document.getElementById('pull-modal').classList.add('active');
        document.getElementById('pull-image-name').value = '';
        document.getElementById('pull-image-name').focus();
        document.getElementById('pull-progress').classList.add('hidden');
    }

    hidePullModal() {
        document.getElementById('pull-modal').classList.remove('active');
    }

    async pullImage() {
        const nameInput = document.getElementById('pull-image-name');
        const name = nameInput.value.trim();
        if (!name) return;

        const progress = document.getElementById('pull-progress');
        const progressFill = document.getElementById('pull-progress-fill');
        const status = document.getElementById('pull-status');

        progress.classList.remove('hidden');
        progressFill.style.width = '10%';
        status.textContent = `Pulling ${name}...`;

        try {
            const resp = await fetch(`${this.apiUrl}/images/create?fromImage=${encodeURIComponent(name)}`, {
                method: 'POST',
                signal: AbortSignal.timeout(300000), // 5 min timeout
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let progress_pct = 10;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value, { stream: true });
                const lines = text.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.status) {
                            status.textContent = obj.status + (obj.id ? ` (${obj.id})` : '');
                        }
                        if (obj.progressDetail && obj.progressDetail.total) {
                            progress_pct = Math.min(95, (obj.progressDetail.current / obj.progressDetail.total) * 100);
                        }
                        if (obj.error) throw new Error(obj.error);
                    } catch (e) {
                        if (e.message && !e.message.includes('JSON')) throw e;
                    }
                }

                progressFill.style.width = `${progress_pct}%`;
            }

            progressFill.style.width = '100%';
            status.textContent = 'Pull complete!';
            this.toast(`Pulled ${name}`, 'success');

            setTimeout(() => {
                this.hidePullModal();
                this.refreshAll();
            }, 1000);

        } catch (err) {
            status.textContent = `Error: ${err.message}`;
            this.toast(`Pull failed: ${err.message}`, 'error');
        }
    }

    // ========================================
    // Prune
    // ========================================

    async pruneImages() {
        this.showConfirm('Prune Images', 'Remove all unused images? This frees disk space.', async () => {
            try {
                const result = await this.api('/images/prune', { method: 'POST' });
                const freed = result.SpaceReclaimed ? this.formatBytes(result.SpaceReclaimed) : '0 B';
                this.toast(`Pruned images — freed ${freed}`, 'success');
                this.refreshAll();
            } catch (err) {
                this.toast(`Failed: ${err.message}`, 'error');
            }
        });
    }

    async pruneVolumes() {
        this.showConfirm('Prune Volumes', 'Remove all unused volumes? Data will be lost.', async () => {
            try {
                const result = await this.api('/volumes/prune', { method: 'POST' });
                const freed = result.SpaceReclaimed ? this.formatBytes(result.SpaceReclaimed) : '0 B';
                this.toast(`Pruned volumes — freed ${freed}`, 'success');
                this.refreshAll();
            } catch (err) {
                this.toast(`Failed: ${err.message}`, 'error');
            }
        });
    }

    // ========================================
    // Confirm Modal
    // ========================================

    showConfirm(title, message, onConfirm) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('confirm-modal').classList.add('active');

        const okBtn = document.getElementById('confirm-ok');
        const newBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newBtn, okBtn);
        newBtn.id = 'confirm-ok';

        newBtn.addEventListener('click', async () => {
            this.hideConfirmModal();
            await onConfirm();
        });
    }

    hideConfirmModal() {
        document.getElementById('confirm-modal').classList.remove('active');
    }

    // ========================================
    // Toast Notifications
    // ========================================

    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ========================================
    // Utilities
    // ========================================

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
    }

    timeAgo(timestamp) {
        if (!timestamp) return 'unknown';
        const seconds = Math.floor(Date.now() / 1000 - timestamp);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
        return `${Math.floor(seconds / 2592000)}mo ago`;
    }
}

// Initialize
const app = new Hangar();
